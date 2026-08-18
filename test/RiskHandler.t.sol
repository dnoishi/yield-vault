// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {RiskHandler} from "../src/RiskHandler.sol";
import {IYieldVaultRiskTarget} from "../src/interfaces/IDreamDex.sol";
import {MockERC20, MockSpotPool, MockOperatorRegistry} from "./mocks/MockDreamDex.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {
    ISomniaReactivityPrecompile
} from "@somnia-chain/reactivity-contracts/contracts/interfaces/ISomniaReactivityPrecompile.sol";

contract RiskHandlerTest is Test {
    MockERC20 internal usdso;
    MockERC20 internal weth;
    MockSpotPool internal pool;
    MockOperatorRegistry internal registry;
    YieldVault internal vault;
    RiskHandler internal handler;

    function setUp() public {
        usdso = new MockERC20("USDso", "USDso", 18);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pool = new MockSpotPool(address(weth), address(usdso), 18);
        registry = new MockOperatorRegistry();
        pool.setBook(1_999e18, 2_001e18);
        handler = new RiskHandler(pool, address(this), 100, 50);
        vault = new YieldVault(
            usdso,
            pool,
            registry,
            18,
            address(this),
            address(this),
            address(this),
            address(handler),
            address(this),
            "Yield Vault",
            "yvUSDso"
        );
        handler.bindVault(IYieldVaultRiskTarget(address(vault)));
    }

    function testEpochTickHaltsOnPriceMove() public {
        _epochTick();
        assertFalse(vault.paused());

        pool.setBook(2_019e18, 2_021e18);
        _epochTick();
        assertTrue(vault.paused());
        assertEq(vault.lastHaltReason(), handler.REASON_PRICE_MOVE());
    }

    function testHaltsOnExcessiveSpread() public {
        pool.setBook(1_900e18, 2_100e18);
        _epochTick();
        assertTrue(vault.paused());
        assertEq(vault.lastHaltReason(), handler.REASON_SPREAD());
    }

    function testRejectsNonPrecompileCallback() public {
        bytes32[] memory topics = _topics();
        vm.expectRevert();
        handler.onEvent(address(0x100), topics, "");
    }

    function testCanCreateAndStopEpochSubscription() public {
        vm.mockCall(
            address(0x100),
            abi.encodeWithSelector(ISomniaReactivityPrecompile.subscribe.selector),
            abi.encode(uint256(7))
        );
        vm.mockCall(
            address(0x100), abi.encodeWithSelector(ISomniaReactivityPrecompile.unsubscribe.selector, uint256(7)), ""
        );
        vm.deal(address(handler), 32 ether);
        SomniaExtensions.SubscriptionOptions memory options = SomniaExtensions.defaultSubscriptionOptions();

        uint256 id = handler.startSubscription(options);
        assertEq(id, 7);
        assertEq(handler.subscriptionId(), 7);
        handler.stopSubscription();
        assertEq(handler.subscriptionId(), 0);
    }

    function _epochTick() internal {
        vm.prank(address(0x100));
        handler.onEvent(address(0x100), _topics(), "");
    }

    function _topics() internal pure returns (bytes32[] memory topics) {
        topics = new bytes32[](1);
        topics[0] = ISomniaReactivityPrecompile.EpochTick.selector;
    }
}
