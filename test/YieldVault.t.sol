// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {MockERC20, MockSpotPool, MockOperatorRegistry} from "./mocks/MockDreamDex.sol";

contract YieldVaultTest is Test {
    MockERC20 internal usdso;
    MockERC20 internal weth;
    MockSpotPool internal pool;
    MockOperatorRegistry internal registry;
    YieldVault internal vault;

    address internal user = makeAddr("user");
    address internal operator = makeAddr("operator");
    uint256 internal constant ONE = 1e18;

    function setUp() public {
        usdso = new MockERC20("USDso", "USDso", 18);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pool = new MockSpotPool(address(weth), address(usdso), 18);
        registry = new MockOperatorRegistry();
        pool.setBook(1_999e18, 2_001e18);

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
            "DreamDEX WETH Yield Vault",
            "yvWETH"
        );

        usdso.mint(user, 10_000e18);
        vm.prank(user);
        usdso.approve(address(vault), type(uint256).max);
    }

    function testNavIncludesIdlePoolBalancesAndOrders() public {
        _deposit(1_000e18);
        vault.allocate(500e18);
        weth.mint(address(pool), ONE);
        pool.seedBalance(address(vault), address(weth), ONE);

        assertEq(vault.totalAssets(), 2_980e18, "base marked with 1% haircut");

        pool.addOrder(address(vault), true, 1_900e18, 0.1e18);
        pool.addOrder(address(vault), false, 2_100e18, 0.2e18);
        assertEq(vault.totalAssets(), 2_980e18, "locking principal must not change NAV");
    }

    function testQueueBurnsSharesAndProcessesFifo() public {
        _deposit(1_000e18);
        vault.allocate(800e18);

        vm.prank(user);
        (uint256 id, uint256 assets) = vault.requestRedeem(500e18, user);
        assertEq(id, 0);
        assertEq(assets, 500e18);
        assertEq(vault.balanceOf(user), 500e18);
        assertEq(vault.queuedLiabilities(), 500e18);
        assertEq(vault.totalAssets(), 500e18);

        uint256 before = usdso.balanceOf(user);
        vault.processQueue(1);
        assertEq(usdso.balanceOf(user) - before, 500e18);
        assertEq(vault.queuedLiabilities(), 0);
        (,,, bool processed) = vault.withdrawalRequests(id);
        assertTrue(processed);
    }

    function testPauseBlocksDepositsAndRedeemsAndCancelsOrders() public {
        _deposit(1_000e18);
        vault.allocate(500e18);
        pool.addOrder(address(vault), true, 1_900e18, 0.1e18);
        vault.setOperator(operator, true);

        vault.emergencyHalt(keccak256("test"));
        assertTrue(vault.paused());
        assertFalse(registry.approved(address(pool), operator, vault.PLACE_ORDER_FOR_SELECTOR()));

        vm.prank(address(vault));
        uint128[] memory open = pool.getOwnOpenOrders();
        assertEq(open.length, 0);

        vm.startPrank(user);
        vm.expectRevert();
        vault.deposit(ONE, user);
        vm.expectRevert();
        vault.redeem(ONE, user, user);
        vm.stopPrank();
    }

    function testOperatorCannotRecallOrWithdrawVaultFunds() public {
        _deposit(1_000e18);
        vault.allocate(500e18);
        vault.setOperator(operator, true);

        vm.prank(operator);
        vm.expectRevert();
        vault.recall(ONE);

        vm.prank(operator);
        vm.expectRevert("insufficient");
        pool.withdraw(address(usdso), ONE);
    }

    function testPerformanceFeeUsesHighWaterMark() public {
        _deposit(1_000e18);
        vault.setFeeConfig(0, 2_000, address(this));
        usdso.mint(address(vault), 100e18);

        vault.accrueFees();
        assertGt(vault.balanceOf(address(this)), 18e18);
        assertGt(vault.highWaterMark(), ONE);

        uint256 feeShares = vault.balanceOf(address(this));
        vault.accrueFees();
        assertEq(vault.balanceOf(address(this)), feeShares, "no fee below a new high");
    }

    function testOneSidedBookConservativelyMarksBaseAtZero() public {
        _deposit(1_000e18);
        weth.mint(address(pool), ONE);
        pool.seedBalance(address(vault), address(weth), ONE);
        pool.setBook(2_000e18, 0);
        assertEq(vault.totalAssets(), 1_000e18);
    }

    function testFuzzDepositRedeemAccounting(uint96 amount) public {
        uint256 assets = bound(uint256(amount), 1e9, 5_000e18);
        vm.prank(user);
        uint256 shares = vault.deposit(assets, user);
        assertApproxEqAbs(vault.totalAssets(), assets, 1);

        vm.prank(user);
        uint256 redeemed = vault.redeem(shares, user, user);
        assertApproxEqAbs(redeemed, assets, 1);
        assertEq(vault.totalSupply(), 0);
    }

    function _deposit(uint256 assets) internal {
        vm.prank(user);
        vault.deposit(assets, user);
    }
}
