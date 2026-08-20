// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {RiskHandler} from "../src/RiskHandler.sol";

/// @notice Schedules or executes a timelocked RiskHandler threshold update.
contract ConfigureRisk is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK_ADDRESS")));
        RiskHandler handler = RiskHandler(payable(vm.envAddress("RISK_HANDLER_ADDRESS")));
        uint16 maxSpreadBps = uint16(vm.envUint("MAX_SPREAD_BPS"));
        uint16 maxMoveBps = uint16(vm.envUint("MAX_MOVE_BPS"));
        bool execute = vm.envOr("EXECUTE_TIMELOCK", false);
        bytes memory payload = abi.encodeCall(RiskHandler.setThresholds, (maxSpreadBps, maxMoveBps));
        bytes32 salt = keccak256(abi.encode("CLOB_YIELD_RISK_THRESHOLDS", address(handler), maxSpreadBps, maxMoveBps));

        vm.startBroadcast(privateKey);
        if (execute) {
            timelock.execute(address(handler), 0, payload, bytes32(0), salt);
            console2.log("Risk thresholds updated");
        } else {
            uint256 delay = timelock.getMinDelay();
            timelock.schedule(address(handler), 0, payload, bytes32(0), salt, delay);
            console2.log("Risk threshold update scheduled with delay:", delay);
        }
        vm.stopBroadcast();
        console2.log("maxSpreadBps:", maxSpreadBps);
        console2.log("maxMoveBps:", maxMoveBps);
    }
}
