// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {KycGate} from "../src/KycGate.sol";
import {TegataRegistry} from "../src/TegataRegistry.sol";
import {SettlementAnchor} from "../src/SettlementAnchor.sol";

/// @notice Deploys the TEGATA Protocol suite and wires the contracts together.
///
/// Env vars:
///   ATTESTOR_ADDRESS  (required) SettlementAttestor signing address
///   MIN_KYC_LEVEL     (optional, default 1) minimum official KYC level
///   KYC_SBT_ADDRESS   (optional) official HashKey Chain KYC SBT registry
///
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url hashkey_testnet --broadcast
///   forge script script/Deploy.s.sol --rpc-url hashkey_mainnet --broadcast
contract Deploy is Script {
    function run() external {
        address attestor = vm.envAddress("ATTESTOR_ADDRESS");
        uint8 minLevel = uint8(vm.envOr("MIN_KYC_LEVEL", uint256(1)));
        address kycSbt = vm.envOr("KYC_SBT_ADDRESS", address(0));

        vm.startBroadcast();

        KycGate gate = new KycGate(minLevel);
        TegataRegistry registry = new TegataRegistry(gate);
        SettlementAnchor anchor = new SettlementAnchor(registry, attestor);
        registry.setAnchor(address(anchor));

        if (kycSbt != address(0)) {
            gate.setKycSBT(kycSbt, minLevel);
        }

        vm.stopBroadcast();

        console.log("chainId:          ", block.chainid);
        console.log("KycGate:          ", address(gate));
        console.log("TegataRegistry:   ", address(registry));
        console.log("SettlementAnchor: ", address(anchor));
        console.log("attestor:         ", attestor);
    }
}
