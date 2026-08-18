// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {RiskHandler} from "../src/RiskHandler.sol";
import {ISpotPool, IOperatorPermissionsRegistry, IYieldVaultRiskTarget} from "../src/interfaces/IDreamDex.sol";

contract Deploy is Script {
    address internal constant SHANNON_WETH_POOL = 0xD180195da5459C7a0DEA188ed61216ec43682b50;
    address internal constant SHANNON_OPERATOR_REGISTRY = 0x15C7e8CE38F021c5b45d098AaD788f63090bF20A;
    address internal constant MAINNET_USDCE_POOL = 0x47fD2f18426f67106DBaC82F6d21D446c5F2120b;
    address internal constant MAINNET_OPERATOR_REGISTRY = 0xE7a190736B6024a4DbafadC04E283075877005ce;

    function run() external returns (TimelockController timelock, RiskHandler riskHandler, YieldVault vault) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(privateKey);
        bool mainnet = block.chainid == 5031;
        address poolAddress = vm.envOr("POOL_ADDRESS", mainnet ? MAINNET_USDCE_POOL : SHANNON_WETH_POOL);
        address registryAddress =
            vm.envOr("OPERATOR_REGISTRY", mainnet ? MAINNET_OPERATOR_REGISTRY : SHANNON_OPERATOR_REGISTRY);
        address guardian = vm.envOr("GUARDIAN_ADDRESS", deployer);
        address keeper = vm.envOr("KEEPER_ADDRESS", deployer);
        address feeRecipient = vm.envOr("FEE_RECIPIENT", deployer);
        address operator = vm.envOr("OPERATOR_ADDRESS", address(0));
        uint8 baseDecimals = uint8(vm.envOr("BASE_DECIMALS", uint256(mainnet ? 6 : 18)));
        uint256 delay = vm.envOr("TIMELOCK_DELAY", uint256(mainnet ? 2 days : 0));
        uint16 maxSpreadBps = uint16(vm.envOr("MAX_SPREAD_BPS", uint256(100)));
        uint16 maxMoveBps = uint16(vm.envOr("MAX_MOVE_BPS", uint256(100)));
        uint256 riskFunding = vm.envOr("RISK_HANDLER_FUNDING", uint256(0));

        ISpotPool spotPool = ISpotPool(poolAddress);
        (, address quoteToken,,,,,) = spotPool.getPoolParams();
        address[] memory proposers = new address[](1);
        proposers[0] = deployer;
        address[] memory executors = new address[](1);
        executors[0] = address(0);

        vm.startBroadcast(privateKey);
        timelock = new TimelockController(delay, proposers, executors, address(0));
        riskHandler = new RiskHandler(spotPool, deployer, maxSpreadBps, maxMoveBps);
        vault = new YieldVault(
            IERC20(quoteToken),
            spotPool,
            IOperatorPermissionsRegistry(registryAddress),
            baseDecimals,
            address(timelock),
            guardian,
            keeper,
            address(riskHandler),
            feeRecipient,
            "DreamDEX CLOB Yield Vault",
            "yvUSDso"
        );
        riskHandler.bindVault(IYieldVaultRiskTarget(address(vault)));
        riskHandler.transferOwnership(address(timelock));
        if (riskFunding != 0) {
            (bool funded,) = address(riskHandler).call{value: riskFunding}("");
            require(funded, "risk handler funding failed");
        }
        vm.stopBroadcast();

        if (block.chainid == 50312) {
            string memory objectKey = "shannon";
            vm.serializeAddress(objectKey, "asset", quoteToken);
            vm.serializeAddress(objectKey, "operatorRegistry", registryAddress);
            vm.serializeAddress(objectKey, "pool", poolAddress);
            vm.serializeAddress(objectKey, "timelock", address(timelock));
            vm.serializeAddress(objectKey, "riskHandler", address(riskHandler));
            vm.serializeAddress(objectKey, "operator", operator);
            vm.serializeUint(objectKey, "deployBlock", block.number);
            string memory json = vm.serializeAddress(objectKey, "vault", address(vault));
            vm.writeJson(json, "deployments/shannon.json");
        }

        console2.log("Timelock:", address(timelock));
        console2.log("RiskHandler:", address(riskHandler));
        console2.log("YieldVault:", address(vault));
        console2.log("Pool:", poolAddress);
        console2.log("Asset:", quoteToken);
    }
}
