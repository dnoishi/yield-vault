// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {YieldVault} from "../src/YieldVault.sol";

/// @notice Schedules (or executes after the delay) manual-vault and operator setup.
contract SetupMarket is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        YieldVault vault = YieldVault(vm.envAddress("VAULT_ADDRESS"));
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK_ADDRESS")));
        address operator = vm.envAddress("OPERATOR_ADDRESS");
        bool execute = vm.envOr("EXECUTE_TIMELOCK", false);
        bytes32 salt = keccak256(abi.encode("CLOB_YIELD_VAULT_SETUP", address(vault), operator));

        address[] memory targets = new address[](2);
        targets[0] = address(vault);
        targets[1] = address(vault);
        uint256[] memory values = new uint256[](2);
        bytes[] memory payloads = new bytes[](2);
        payloads[0] = abi.encodeCall(YieldVault.enableManualVaultMode, ());
        payloads[1] = abi.encodeCall(YieldVault.setOperator, (operator, true));

        vm.startBroadcast(privateKey);
        if (execute) {
            timelock.executeBatch(targets, values, payloads, bytes32(0), salt);
            console2.log("Market setup executed");
        } else {
            uint256 delay = timelock.getMinDelay();
            timelock.scheduleBatch(targets, values, payloads, bytes32(0), salt, delay);
            console2.log("Market setup scheduled with delay:", delay);
        }
        vm.stopBroadcast();
    }
}
