// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SomniaExtensions} from "@somnia-chain/reactivity-contracts/contracts/interfaces/SomniaExtensions.sol";
import {RiskHandler} from "../src/RiskHandler.sol";

/// @notice Timelocked creation of the recurring EpochTick risk subscription.
contract SubscribeRisk is Script {
    function run() external {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        TimelockController timelock = TimelockController(payable(vm.envAddress("TIMELOCK_ADDRESS")));
        RiskHandler handler = RiskHandler(payable(vm.envAddress("RISK_HANDLER_ADDRESS")));
        bool execute = vm.envOr("EXECUTE_TIMELOCK", false);
        uint64 gasLimit = uint64(vm.envOr("REACTIVITY_GAS_LIMIT", uint256(2_000_000)));
        uint64 maxFee = uint64(vm.envOr("REACTIVITY_MAX_FEE", uint256(20 gwei)));
        uint64 priorityFee = uint64(vm.envOr("REACTIVITY_PRIORITY_FEE", uint256(0)));
        SomniaExtensions.SubscriptionOptions memory options = SomniaExtensions.SubscriptionOptions({
            priorityFeePerGas: priorityFee, maxFeePerGas: maxFee, gasLimit: gasLimit
        });
        bytes memory payload = abi.encodeCall(RiskHandler.startSubscription, (options));
        bytes32 salt = keccak256(abi.encode("CLOB_YIELD_RISK_SUBSCRIPTION", address(handler)));

        vm.startBroadcast(privateKey);
        if (execute) {
            timelock.execute(address(handler), 0, payload, bytes32(0), salt);
            console2.log("Risk subscription created");
        } else {
            uint256 delay = timelock.getMinDelay();
            timelock.schedule(address(handler), 0, payload, bytes32(0), salt, delay);
            console2.log("Risk subscription scheduled with delay:", delay);
        }
        vm.stopBroadcast();
    }
}
