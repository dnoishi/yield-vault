// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISpotPool, IOperatorPermissionsRegistry} from "./interfaces/IDreamDex.sol";

/// @notice USDso ERC-4626 whose capital is market-made on one DreamDEX SpotPool.
/// @dev The hot operator has permissions only in DreamDEX's registry and no role here.
contract YieldVault is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant RISK_HANDLER_ROLE = keccak256("RISK_HANDLER_ROLE");

    bytes4 public constant PLACE_ORDER_FOR_SELECTOR = 0x80054449;
    bytes4 public constant CANCEL_ORDER_FOR_SELECTOR = 0xe37b444b;
    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;

    ISpotPool public immutable pool;
    IOperatorPermissionsRegistry public immutable operatorRegistry;
    address public immutable baseToken;
    uint8 public immutable baseDecimals;

    address public operator;
    address public feeRecipient;
    uint16 public baseHaircutBps;
    uint16 public minIdleBps;
    uint16 public managementFeeBps;
    uint16 public performanceFeeBps;
    uint256 public maxTotalAssets;
    bool public allowlistEnabled;
    mapping(address => bool) public allowlisted;

    uint64 public lastFeeAccrual;
    uint256 public highWaterMark;
    bytes32 public lastHaltReason;

    struct WithdrawalRequest {
        address receiver;
        uint256 assets;
        uint64 requestedAt;
        bool processed;
    }

    uint256 public nextRequestId;
    uint256 public nextRequestToProcess;
    uint256 public queuedLiabilities;
    mapping(uint256 => WithdrawalRequest) public withdrawalRequests;

    event CapitalAllocated(uint256 assets);
    event CapitalRecalled(uint256 assets);
    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event EmergencyHalt(bytes32 indexed reason);
    event WithdrawalRequested(
        uint256 indexed requestId, address indexed owner, address indexed receiver, uint256 shares, uint256 assets
    );
    event WithdrawalProcessed(uint256 indexed requestId, address indexed receiver, uint256 assets);
    event FeesAccrued(uint256 managementAssets, uint256 performanceAssets, uint256 feeShares);

    error InvalidPoolAsset();
    error InvalidBps();
    error InsufficientIdleLiquidity();
    error QueueHasPriority();
    error NotAuthorizedToHalt();
    error NothingToProcess();
    error ZeroAddress();

    constructor(
        IERC20 asset_,
        ISpotPool pool_,
        IOperatorPermissionsRegistry operatorRegistry_,
        uint8 baseDecimals_,
        address admin_,
        address guardian_,
        address keeper_,
        address riskHandler_,
        address feeRecipient_,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) ERC4626(asset_) {
        if (
            address(pool_) == address(0) || address(operatorRegistry_) == address(0) || admin_ == address(0)
                || guardian_ == address(0) || keeper_ == address(0) || feeRecipient_ == address(0)
        ) revert ZeroAddress();

        (address poolBase, address poolQuote,,,,,) = pool_.getPoolParams();
        if (poolQuote != address(asset_)) revert InvalidPoolAsset();

        pool = pool_;
        operatorRegistry = operatorRegistry_;
        baseToken = poolBase;
        baseDecimals = baseDecimals_;
        feeRecipient = feeRecipient_;
        baseHaircutBps = 100;
        minIdleBps = 2_000;
        maxTotalAssets = type(uint256).max;
        lastFeeAccrual = uint64(block.timestamp);
        highWaterMark = 1e18;

        _grantRole(DEFAULT_ADMIN_ROLE, admin_);
        _grantRole(GUARDIAN_ROLE, guardian_);
        _grantRole(KEEPER_ROLE, keeper_);
        if (riskHandler_ != address(0)) _grantRole(RISK_HANDLER_ROLE, riskHandler_);

        asset_.forceApprove(address(pool_), type(uint256).max);
    }

    /// @notice Net assets attributable to live shares, excluding fixed queue claims.
    function totalAssets() public view override returns (uint256) {
        uint256 gross = grossManagedAssets();
        return gross > queuedLiabilities ? gross - queuedLiabilities : 0;
    }

    function grossManagedAssets() public view returns (uint256 gross) {
        uint256 mid = currentMidRaw();
        gross = IERC20(asset()).balanceOf(address(this));
        gross += pool.getWithdrawableBalance(address(this), asset());

        uint256 freeBase = pool.getWithdrawableBalance(address(this), baseToken);
        if (mid != 0 && freeBase != 0) gross += _markedBase(freeBase, mid);

        uint128[] memory ids = pool.getOwnOpenOrders();
        for (uint256 i; i < ids.length; ++i) {
            ISpotPool.Order memory order = pool.getOrder(ids[i]);
            if (order.owner != address(this) || order.quantityRemaining == 0) continue;
            if (order.isBid) {
                gross += Math.mulDiv(order.price, order.quantityRemaining, 10 ** baseDecimals);
            } else if (mid != 0) {
                gross += _markedBase(order.quantityRemaining, mid);
            }
        }
    }

    function currentMidRaw() public view returns (uint256) {
        ISpotPool.BookLevel[] memory bids = pool.getBookLevels(true, 1);
        ISpotPool.BookLevel[] memory asks = pool.getBookLevels(false, 1);
        if (bids.length == 0 || asks.length == 0) return 0;
        return (bids[0].price + asks[0].price) / 2;
    }

    function availableIdle() public view returns (uint256) {
        uint256 idle = IERC20(asset()).balanceOf(address(this));
        return idle > queuedLiabilities ? idle - queuedLiabilities : 0;
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        if (paused() || (allowlistEnabled && !allowlisted[receiver])) return 0;
        uint256 managed = totalAssets();
        return managed >= maxTotalAssets ? 0 : maxTotalAssets - managed;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return convertToShares(maxDeposit(receiver));
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        if (paused() || queuedLiabilities != 0) return 0;
        return Math.min(super.maxWithdraw(owner), availableIdle());
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        if (paused() || queuedLiabilities != 0) return 0;
        return Math.min(super.maxRedeem(owner), convertToShares(availableIdle()));
    }

    function deposit(uint256 assets, address receiver) public override nonReentrant whenNotPaused returns (uint256) {
        accrueFees();
        return super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver) public override nonReentrant whenNotPaused returns (uint256) {
        accrueFees();
        return super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        if (queuedLiabilities != 0) revert QueueHasPriority();
        accrueFees();
        if (assets > availableIdle()) revert InsufficientIdleLiquidity();
        return super.withdraw(assets, receiver, owner);
    }

    function redeem(uint256 shares, address receiver, address owner)
        public
        override
        nonReentrant
        whenNotPaused
        returns (uint256)
    {
        if (queuedLiabilities != 0) revert QueueHasPriority();
        accrueFees();
        if (previewRedeem(shares) > availableIdle()) revert InsufficientIdleLiquidity();
        return super.redeem(shares, receiver, owner);
    }

    function requestRedeem(uint256 shares, address receiver)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 requestId, uint256 assets)
    {
        if (receiver == address(0)) revert ZeroAddress();
        accrueFees();
        assets = previewRedeem(shares);
        _burn(msg.sender, shares);
        requestId = nextRequestId++;
        withdrawalRequests[requestId] = WithdrawalRequest({
            receiver: receiver, assets: assets, requestedAt: uint64(block.timestamp), processed: false
        });
        queuedLiabilities += assets;
        emit WithdrawalRequested(requestId, msg.sender, receiver, shares, assets);
    }

    function processQueue(uint256 maxRequests) external nonReentrant onlyRole(KEEPER_ROLE) {
        if (maxRequests == 0) revert NothingToProcess();
        uint256 processed;
        while (processed < maxRequests && nextRequestToProcess < nextRequestId) {
            uint256 requestId = nextRequestToProcess;
            WithdrawalRequest storage request = withdrawalRequests[requestId];
            uint256 idle = IERC20(asset()).balanceOf(address(this));
            if (idle < request.assets) {
                uint256 withdrawable = pool.getWithdrawableBalance(address(this), asset());
                uint256 needed = request.assets - idle;
                if (withdrawable != 0) pool.withdraw(asset(), Math.min(needed, withdrawable));
                idle = IERC20(asset()).balanceOf(address(this));
            }
            if (idle < request.assets) break;

            request.processed = true;
            queuedLiabilities -= request.assets;
            nextRequestToProcess = requestId + 1;
            IERC20(asset()).safeTransfer(request.receiver, request.assets);
            emit WithdrawalProcessed(requestId, request.receiver, request.assets);
            ++processed;
        }
    }

    function allocate(uint256 assets) external nonReentrant onlyRole(KEEPER_ROLE) whenNotPaused {
        uint256 idle = availableIdle();
        uint256 requiredIdle = Math.mulDiv(grossManagedAssets(), minIdleBps, BPS);
        if (assets > idle || idle - assets < requiredIdle) revert InsufficientIdleLiquidity();
        pool.deposit(asset(), assets);
        emit CapitalAllocated(assets);
    }

    function recall(uint256 assets) external nonReentrant onlyRole(KEEPER_ROLE) {
        pool.withdraw(asset(), assets);
        emit CapitalRecalled(assets);
    }

    function enableManualVaultMode() external onlyRole(DEFAULT_ADMIN_ROLE) {
        pool.setManualVaultMode(true);
    }

    function setOperator(address newOperator, bool approved) external onlyRole(DEFAULT_ADMIN_ROLE) {
        address previous = operator;
        if (previous != address(0) && previous != newOperator) _setOperatorApproval(previous, false);
        if (approved) {
            if (newOperator == address(0)) revert ZeroAddress();
            operator = newOperator;
            _setOperatorApproval(newOperator, true);
        } else {
            if (newOperator != address(0)) _setOperatorApproval(newOperator, false);
            operator = address(0);
        }
        emit OperatorUpdated(previous, operator);
    }

    function cancelAllOrders() external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && !hasRole(KEEPER_ROLE, msg.sender)) {
            revert NotAuthorizedToHalt();
        }
        _cancelAllOrders();
    }

    function emergencyHalt(bytes32 reason) external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && !hasRole(RISK_HANDLER_ROLE, msg.sender)) {
            revert NotAuthorizedToHalt();
        }
        if (!paused()) _pause();
        lastHaltReason = reason;
        if (operator != address(0)) {
            try operatorRegistry.setOperatorApprovalForPool(address(pool), operator, _operatorSelectors(), false) {}
                catch {}
        }
        _cancelAllOrders();
        emit EmergencyHalt(reason);
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setRiskConfig(uint16 haircutBps, uint16 idleBps, uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (haircutBps > BPS || idleBps > BPS) revert InvalidBps();
        baseHaircutBps = haircutBps;
        minIdleBps = idleBps;
        maxTotalAssets = cap;
    }

    function setFeeConfig(uint16 managementBps, uint16 performanceBps, address recipient)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (managementBps > 1_000 || performanceBps > 3_000) revert InvalidBps();
        if (recipient == address(0)) revert ZeroAddress();
        accrueFees();
        managementFeeBps = managementBps;
        performanceFeeBps = performanceBps;
        feeRecipient = recipient;
    }

    function setAllowlist(bool enabled, address[] calldata accounts, bool approved)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        allowlistEnabled = enabled;
        for (uint256 i; i < accounts.length; ++i) {
            allowlisted[accounts[i]] = approved;
        }
    }

    function accrueFees() public {
        uint256 supply = totalSupply();
        uint256 managed = totalAssets();
        uint256 elapsed = block.timestamp - lastFeeAccrual;
        lastFeeAccrual = uint64(block.timestamp);
        if (supply == 0 || managed == 0) {
            highWaterMark = 1e18;
            return;
        }

        uint256 managementAssets = Math.mulDiv(managed, uint256(managementFeeBps) * elapsed, BPS * YEAR);
        uint256 feeShares = _feeShares(managementAssets, managed, supply);
        if (feeShares != 0) _mint(feeRecipient, feeShares);

        uint256 pps = Math.mulDiv(totalAssets(), 1e18, totalSupply());
        uint256 performanceAssets;
        if (pps > highWaterMark) {
            uint256 gains = Math.mulDiv(pps - highWaterMark, totalSupply(), 1e18);
            performanceAssets = Math.mulDiv(gains, performanceFeeBps, BPS);
            uint256 performanceShares = _feeShares(performanceAssets, totalAssets(), totalSupply());
            if (performanceShares != 0) {
                _mint(feeRecipient, performanceShares);
                feeShares += performanceShares;
            }
            highWaterMark = Math.mulDiv(totalAssets(), 1e18, totalSupply());
        }
        if (feeShares != 0) emit FeesAccrued(managementAssets, performanceAssets, feeShares);
    }

    function _markedBase(uint256 quantity, uint256 mid) internal view returns (uint256) {
        uint256 quoteValue = Math.mulDiv(mid, quantity, 10 ** baseDecimals);
        return Math.mulDiv(quoteValue, BPS - baseHaircutBps, BPS);
    }

    function _feeShares(uint256 feeAssets, uint256 managed, uint256 supply) internal pure returns (uint256) {
        if (feeAssets == 0 || feeAssets >= managed) return 0;
        return Math.mulDiv(feeAssets, supply, managed - feeAssets);
    }

    function _setOperatorApproval(address target, bool approved) internal {
        operatorRegistry.setOperatorApprovalForPool(address(pool), target, _operatorSelectors(), approved);
    }

    function _operatorSelectors() internal pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](2);
        selectors[0] = PLACE_ORDER_FOR_SELECTOR;
        selectors[1] = CANCEL_ORDER_FOR_SELECTOR;
    }

    function _cancelAllOrders() internal {
        uint128[] memory ids = pool.getOwnOpenOrders();
        for (uint256 i; i < ids.length; ++i) {
            try pool.cancelOrder(ids[i]) {} catch {}
        }
    }
}
