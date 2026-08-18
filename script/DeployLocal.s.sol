// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {RiskHandler} from "../src/RiskHandler.sol";
import {IYieldVaultRiskTarget} from "../src/interfaces/IDreamDex.sol";
import {LocalERC20, LocalOperatorRegistry, LocalSpotPool} from "../test/mocks/LocalDreamDex.sol";

contract DeployLocal is Script {
    uint256 internal constant DEFAULT_ADMIN_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address internal constant DEFAULT_OPERATOR = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function run() external returns (YieldVault vault) {
        require(block.chainid == 31337, "local deployment requires Anvil");
        uint256 adminKey = vm.envOr("PRIVATE_KEY", DEFAULT_ADMIN_KEY);
        address admin = vm.addr(adminKey);
        address operator = vm.envOr("OPERATOR_ADDRESS", DEFAULT_OPERATOR);

        address[] memory proposers = new address[](1);
        proposers[0] = admin;
        address[] memory executors = new address[](1);
        executors[0] = address(0);

        vm.startBroadcast(adminKey);
        LocalERC20 usdso = new LocalERC20("Local USDso", "USDso", 18);
        LocalERC20 weth = new LocalERC20("Local Wrapped Ether", "WETH", 18);
        LocalOperatorRegistry registry = new LocalOperatorRegistry();
        LocalSpotPool pool = new LocalSpotPool(address(weth), address(usdso), 18, registry);
        TimelockController timelock = new TimelockController(0, proposers, executors, address(0));
        RiskHandler risk = new RiskHandler(pool, admin, 100, 100);
        vault = new YieldVault(
            usdso,
            pool,
            registry,
            18,
            address(timelock),
            admin,
            admin,
            address(risk),
            admin,
            "Local DreamDEX CLOB Yield Vault",
            "yvUSDso"
        );
        risk.bindVault(IYieldVaultRiskTarget(address(vault)));
        risk.transferOwnership(address(timelock));

        address[] memory targets = new address[](2);
        targets[0] = address(vault);
        targets[1] = address(vault);
        uint256[] memory values = new uint256[](2);
        bytes[] memory payloads = new bytes[](2);
        payloads[0] = abi.encodeCall(YieldVault.enableManualVaultMode, ());
        payloads[1] = abi.encodeCall(YieldVault.setOperator, (operator, true));
        bytes32 salt = keccak256("LOCAL_MARKET_SETUP");
        timelock.scheduleBatch(targets, values, payloads, bytes32(0), salt, 0);
        timelock.executeBatch(targets, values, payloads, bytes32(0), salt);

        usdso.mint(admin, 1_000_000e18);
        usdso.approve(address(vault), type(uint256).max);
        vault.deposit(10_000e18, admin);
        vault.allocate(7_000e18);

        weth.mint(address(pool), 1e18);
        pool.seedBalance(address(vault), address(weth), 1e18);
        (bool funded,) = address(risk).call{value: 32 ether}("");
        require(funded, "risk funding failed");
        vm.stopBroadcast();

        string memory objectKey = "local";
        vm.serializeAddress(objectKey, "asset", address(usdso));
        vm.serializeAddress(objectKey, "baseToken", address(weth));
        vm.serializeAddress(objectKey, "operatorRegistry", address(registry));
        vm.serializeAddress(objectKey, "pool", address(pool));
        vm.serializeAddress(objectKey, "timelock", address(timelock));
        vm.serializeAddress(objectKey, "riskHandler", address(risk));
        vm.serializeAddress(objectKey, "operator", operator);
        string memory json = vm.serializeAddress(objectKey, "vault", address(vault));
        vm.writeJson(json, "deployments/local.json");

        console2.log("Local vault:", address(vault));
        console2.log("Local pool:", address(pool));
        console2.log("Local USDso:", address(usdso));
        console2.log("Operator:", operator);
    }
}
