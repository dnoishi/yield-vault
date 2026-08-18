// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ISpotPool {
    struct BookLevel {
        uint256 price;
        uint256 quantity;
    }

    struct Order {
        uint128 orderId;
        bool isBid;
        address owner;
        uint64 userData;
        uint256 price;
        uint256 fullQuantity;
        uint256 quantityRemaining;
        uint64 expireTimestampNs;
    }

    function deposit(address token, uint256 amount) external;
    function withdraw(address token, uint256 amount) external;
    function setManualVaultMode(bool enabled) external;
    function cancelOrder(uint128 orderId) external;

    function getPoolParams()
        external
        view
        returns (
            address baseToken,
            address quoteToken,
            uint256 makerFeeBpsTimes1k,
            uint256 takerFeeBpsTimes1k,
            uint256 tickSize,
            uint256 minQuantity,
            uint256 lotSize
        );

    function getWithdrawableBalance(address owner, address token) external view returns (uint256);
    function getBookLevels(bool isBid, uint64 numLevels) external view returns (BookLevel[] memory);
    function getOwnOpenOrders() external view returns (uint128[] memory);
    function getOrder(uint128 orderId) external view returns (Order memory);
}

interface IOperatorPermissionsRegistry {
    function setOperatorApprovalForPool(address pool, address operator, bytes4[] calldata selectors, bool approved)
        external;
}

interface IYieldVaultRiskTarget {
    function emergencyHalt(bytes32 reason) external;
}
