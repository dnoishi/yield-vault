// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {LocalERC20, LocalOperatorRegistry, LocalSpotPool} from "./mocks/LocalDreamDex.sol";

contract LocalIntegrationTest is Test {
    LocalERC20 private usdso;
    LocalERC20 private weth;
    LocalOperatorRegistry private registry;
    LocalSpotPool private pool;
    YieldVault private vault;

    address private user = makeAddr("depositor");
    address private operator = makeAddr("operator");

    function setUp() public {
        usdso = new LocalERC20("Local USDso", "USDso", 18);
        weth = new LocalERC20("Local WETH", "WETH", 18);
        registry = new LocalOperatorRegistry();
        pool = new LocalSpotPool(address(weth), address(usdso), 18, registry);
        vault = new YieldVault(
            usdso,
            pool,
            registry,
            18,
            address(this),
            address(this),
            address(this),
            address(0),
            address(this),
            "Local Yield Vault",
            "yvUSDso"
        );

        vault.enableManualVaultMode();
        vault.setOperator(operator, true);
        usdso.mint(user, 1_000e18);
        vm.startPrank(user);
        usdso.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e18, user);
        vm.stopPrank();
        vault.allocate(700e18);

        weth.mint(address(pool), 1e18);
        pool.seedBalance(address(vault), address(weth), 1e18);
    }

    function testCompleteLocalLifecycle() public {
        uint256 navBefore = vault.totalAssets();

        vm.startPrank(operator);
        (bool bidOk, uint128 bidId) = pool.placeOrderFor(
            address(vault), true, 0, 1_990e18, 0.1e18, uint64(block.timestamp + 1 hours), 3, 0, address(0), 0
        );
        (bool askOk, uint128 askId) = pool.placeOrderFor(
            address(vault), false, 0, 2_010e18, 0.1e18, uint64(block.timestamp + 1 hours), 3, 0, address(0), 0
        );
        vm.stopPrank();

        assertTrue(bidOk && askOk);
        assertEq(vault.totalAssets(), navBefore, "resting principal must stay in NAV");

        vm.prank(address(vault));
        uint128[] memory open = pool.getOwnOpenOrders();
        assertEq(open.length, 2);

        vm.prank(operator);
        pool.cancelOrderFor(address(vault), bidId);

        vm.prank(user);
        (uint256 requestId, uint256 requestedAssets) = vault.requestRedeem(100e18, user);
        assertGt(requestedAssets, 0);
        vault.processQueue(1);
        (,,, bool processed) = vault.withdrawalRequests(requestId);
        assertTrue(processed);

        vault.emergencyHalt(keccak256("LOCAL_TEST"));
        assertTrue(vault.paused());
        assertFalse(registry.isApproved(address(vault), address(pool), operator, vault.PLACE_ORDER_FOR_SELECTOR()));

        vm.prank(address(vault));
        open = pool.getOwnOpenOrders();
        assertEq(open.length, 0);
        assertEq(pool.getOrder(askId).quantityRemaining, 0);
    }
}
