// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISpotPool, IOperatorPermissionsRegistry} from "../../src/interfaces/IDreamDex.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable _tokenDecimals;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockOperatorRegistry is IOperatorPermissionsRegistry {
    mapping(address pool => mapping(address operator => mapping(bytes4 selector => bool))) public approved;

    function setOperatorApprovalForPool(address pool, address operator, bytes4[] calldata selectors, bool isApproved)
        external
    {
        for (uint256 i; i < selectors.length; ++i) {
            approved[pool][operator][selectors[i]] = isApproved;
        }
    }
}

contract MockSpotPool is ISpotPool {
    using SafeERC20 for IERC20;

    address public immutable base;
    address public immutable quote;
    uint8 public immutable baseDecimals;
    mapping(address => mapping(address => uint256)) public balances;
    mapping(address => bool) public manualMode;
    mapping(uint128 => Order) private _orders;
    mapping(address => uint128[]) private _ownerOrders;
    BookLevel[] private _bids;
    BookLevel[] private _asks;
    uint128 private _nextOrderId = 1;

    constructor(address base_, address quote_, uint8 baseDecimals_) {
        base = base_;
        quote = quote_;
        baseDecimals = baseDecimals_;
    }

    function setBook(uint256 bid, uint256 ask) external {
        delete _bids;
        delete _asks;
        if (bid != 0) _bids.push(BookLevel(bid, 1 ether));
        if (ask != 0) _asks.push(BookLevel(ask, 1 ether));
    }

    function seedBalance(address owner, address token, uint256 amount) external {
        balances[owner][token] += amount;
    }

    function addOrder(address owner, bool isBid, uint256 price, uint256 quantity) external returns (uint128 id) {
        id = _nextOrderId++;
        address lockedToken = isBid ? quote : base;
        uint256 locked = isBid ? (price * quantity) / (10 ** baseDecimals) : quantity;
        require(balances[owner][lockedToken] >= locked, "insufficient mock balance");
        balances[owner][lockedToken] -= locked;
        _orders[id] = Order(id, isBid, owner, 0, price, quantity, quantity, 0);
        _ownerOrders[owner].push(id);
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

    function cancelOrder(uint128 orderId) external {
        Order storage order = _orders[orderId];
        require(order.owner == msg.sender, "not owner");
        uint256 remaining = order.quantityRemaining;
        require(remaining != 0, "closed");
        address lockedToken = order.isBid ? quote : base;
        uint256 unlocked = order.isBid ? (order.price * remaining) / (10 ** baseDecimals) : remaining;
        balances[msg.sender][lockedToken] += unlocked;
        order.quantityRemaining = 0;
    }

    function getPoolParams() external view returns (address, address, uint256, uint256, uint256, uint256, uint256) {
        return (base, quote, 0, 0, 1e14, 1, 1);
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
}
