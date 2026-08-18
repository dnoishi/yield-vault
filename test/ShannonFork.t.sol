// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {RiskHandler} from "../src/RiskHandler.sol";
import {ISpotPool, IOperatorPermissionsRegistry, IYieldVaultRiskTarget} from "../src/interfaces/IDreamDex.sol";

interface IOperatorCheck {
    function isOperatorAuthorized(address owner, address operator, bytes4 selector) external view returns (bool);
}

contract ShannonForkTest is Test {
    address private constant WETH_POOL = 0xD180195da5459C7a0DEA188ed61216ec43682b50;
    address private constant OPERATOR_REGISTRY = 0x15C7e8CE38F021c5b45d098AaD788f63090bF20A;

    function testShannonContractsAndEphemeralDeployment() public {
        if (!vm.envOr("RUN_SHANNON_FORK", false)) return;
        vm.createSelectFork(
            vm.envOr("SHANNON_RPC_URL", string("https://api.infra.testnet.somnia.network/"))
        );
        assertEq(block.chainid, 50312);
        assertGt(OPERATOR_REGISTRY.code.length, 0);
        assertGt(WETH_POOL.code.length, 0);

        ISpotPool pool = ISpotPool(WETH_POOL);
        (address base, address quote,,,,,) = pool.getPoolParams();
        assertEq(IERC20Metadata(base).symbol(), "WETH");
        assertEq(IERC20Metadata(base).decimals(), 18);
        assertEq(IERC20Metadata(quote).decimals(), 18);
        assertGt(pool.getBookLevels(true, 1).length, 0);
        assertGt(pool.getBookLevels(false, 1).length, 0);

        address operator = makeAddr("shannon-dry-run-operator");
        RiskHandler risk = new RiskHandler(pool, address(this), 100, 100);
        YieldVault vault = new YieldVault(
            IERC20(quote),
            pool,
            IOperatorPermissionsRegistry(OPERATOR_REGISTRY),
            18,
            address(this),
            address(this),
            address(this),
            address(risk),
            address(this),
            "Ephemeral Shannon Yield Vault",
            "yvUSDso"
        );
        risk.bindVault(IYieldVaultRiskTarget(address(vault)));
        vault.enableManualVaultMode();
        vault.setOperator(operator, true);

        assertTrue(
            IOperatorCheck(WETH_POOL).isOperatorAuthorized(address(vault), operator, vault.PLACE_ORDER_FOR_SELECTOR())
        );
        assertEq(
            vault.currentMidRaw(), (pool.getBookLevels(true, 1)[0].price + pool.getBookLevels(false, 1)[0].price) / 2
        );
    }
}
