// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISpotPool, IOperatorPermissionsRegistry} from "../../src/interfaces/IDreamDex.sol";

contract LocalERC20 is ERC20 {
    uint8 private immutable _decimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address receiver, uint256 amount) external {
        _mint(receiver, amount);
    }
}

contract LocalOperatorRegistry is IOperatorPermissionsRegistry {
    mapping(
        address owner => mapping(address pool => mapping(address operator => mapping(bytes4 selector => bool)))
    ) public approved;

    function setOperatorApprovalForPool(address pool, address operator, bytes4[] calldata selectors, bool approved_)
        external
    {
        for (uint256 i; i < selectors.length; ++i) {
            approved[msg.sender][pool][operator][selectors[i]] = approved_;
        }
    }

    function isApproved(address owner, address pool, address operator, bytes4 selector) external view returns (bool) {
        return approved[owner][pool][operator][selector];
    }
}

contract LocalSpotPool is ISpotPool {
    using SafeERC20 for IERC20;

    bytes4 private constant PLACE_ORDER_FOR_SELECTOR = 0x80054449;
    bytes4 private constant CANCEL_ORDER_FOR_SELECTOR = 0xe37b444b;

    event OrderPlaced(
        uint128 indexed orderId,
        address indexed owner,
        bool isBid,
        uint8 orderType,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs
    );
    event OrderCancelled(uint128 indexed orderId, address indexed owner);

    LocalOperatorRegistry public immutable registry;
    address public immutable base;
    address public immutable quote;
    uint8 public immutable baseDecimals;
    address public immutable seeder;

    mapping(address => mapping(address => uint256)) public balances;
    mapping(address => bool) public manualMode;
    mapping(uint128 => Order) private _orders;
    mapping(address => uint128[]) private _ownerOrders;
    BookLevel[] private _bids;
    BookLevel[] private _asks;
    uint128 private _nextOrderId = 1;

    constructor(address base_, address quote_, uint8 baseDecimals_, LocalOperatorRegistry registry_) {
        base = base_;
        quote = quote_;
        baseDecimals = baseDecimals_;
        registry = registry_;
        seeder = msg.sender;
        _bids.push(BookLevel(1_999e18, 100e18));
        _asks.push(BookLevel(2_001e18, 100e18));
    }

    function setBook(uint256 bid, uint256 ask) external {
        delete _bids;
        delete _asks;
        if (bid != 0) _bids.push(BookLevel(bid, 100e18));
        if (ask != 0) _asks.push(BookLevel(ask, 100e18));
    }

    function seedBalance(address owner, address token, uint256 amount) external {
        require(msg.sender == seeder, "only seeder");
        balances[owner][token] += amount;
    }

    function deposit(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender][token] += amount;
    }

    function withdraw(address token, uint256 amount) external {
        require(balances[msg.sender][token] >= amount, "insufficient");
        balances[msg.sender][token] -= amount;
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    function setManualVaultMode(bool enabled) external {
        manualMode[msg.sender] = enabled;
    }

    function placeOrderFor(
        address owner,
        bool isBid,
        uint64 userData,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8,
        address,
        uint96
    ) external payable returns (bool success, uint128 orderId) {
        require(
            registry.isApproved(owner, address(this), msg.sender, PLACE_ORDER_FOR_SELECTOR), "operator not approved"
        );
        require(manualMode[owner], "manual mode disabled");
        if (price == 0 || quantity == 0 || orderType != 3) return (false, 0);
        if (isBid && _asks.length != 0 && price >= _asks[0].price) return (false, 0);
        if (!isBid && _bids.length != 0 && price <= _bids[0].price) return (false, 0);

        address lockedToken = isBid ? quote : base;
        uint256 locked = isBid ? (price * quantity) / (10 ** baseDecimals) : quantity;
        if (balances[owner][lockedToken] < locked) return (false, 0);
        balances[owner][lockedToken] -= locked;

        orderId = _nextOrderId++;
        _orders[orderId] = Order(orderId, isBid, owner, userData, price, quantity, quantity, expireTimestampNs);
        _ownerOrders[owner].push(orderId);
        emit OrderPlaced(orderId, owner, isBid, orderType, price, quantity, expireTimestampNs);
        return (true, orderId);
    }

    function cancelOrderFor(address owner, uint128 orderId) external {
        require(
            registry.isApproved(owner, address(this), msg.sender, CANCEL_ORDER_FOR_SELECTOR), "operator not approved"
        );
        _cancel(owner, orderId);
    }

    function cancelOrder(uint128 orderId) external {
        _cancel(msg.sender, orderId);
    }

    function getPoolParams() external view returns (address, address, uint256, uint256, uint256, uint256, uint256) {
        return (base, quote, 0, 0, 1e14, 1e15, 1e14);
    }

    function getWithdrawableBalance(address owner, address token) external view returns (uint256) {
        return balances[owner][token];
    }

    function getBookLevels(bool isBid, uint64 numLevels) external view returns (BookLevel[] memory levels) {
        BookLevel[] storage source = isBid ? _bids : _asks;
        uint256 length = source.length < numLevels ? source.length : numLevels;
        levels = new BookLevel[](length);
        for (uint256 i; i < length; ++i) {
            levels[i] = source[i];
        }
    }

    function getOwnOpenOrders() external view returns (uint128[] memory ids) {
        uint128[] storage all = _ownerOrders[msg.sender];
        uint256 count;
        for (uint256 i; i < all.length; ++i) {
            if (_orders[all[i]].quantityRemaining != 0) ++count;
        }
        ids = new uint128[](count);
        uint256 cursor;
        for (uint256 i; i < all.length; ++i) {
            if (_orders[all[i]].quantityRemaining != 0) ids[cursor++] = all[i];
        }
    }

    function getOrder(uint128 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    function _cancel(address owner, uint128 orderId) internal {
        Order storage order = _orders[orderId];
        require(order.owner == owner, "not owner");
        uint256 remaining = order.quantityRemaining;
        require(remaining != 0, "closed");
        address lockedToken = order.isBid ? quote : base;
        uint256 unlocked = order.isBid ? (order.price * remaining) / (10 ** baseDecimals) : remaining;
        balances[owner][lockedToken] += unlocked;
        order.quantityRemaining = 0;
        emit OrderCancelled(orderId, owner);
    }
}
