// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Owned} from "./Owned.sol";

/// @notice Minimal interface of HashKey Chain's official on-chain KYC SBT.
/// @dev https://docs.hashkeychain.net/docs/Build-on-HashKey-Chain/Tools/KYC
///      Levels: NONE=0, BASIC=1, ADVANCED=2, PREMIUM=3, ULTIMATE=4
///      Status: NONE=0, APPROVED=1, REVOKED=2
interface IKycSBT {
    function isHuman(address account) external view returns (bool, uint8);

    function getKycInfo(address account)
        external
        view
        returns (string memory ensName, uint8 level, uint8 status, uint256 createTime);
}

/// @title KycGate — dual-mode identity gate for TEGATA Protocol
/// @notice Prefers HashKey Chain's official KYC SBT registry. Where the registry is
///         not deployed or does not cover a subject (e.g. hackathon demo wallets on
///         mainnet), falls back to an explicit demo attestor allowlist. The mode used
///         for every check is reported on-chain so UIs can disclose "demo attestation
///         mode" honestly.
contract KycGate is Owned {
    enum KycMode {
        None, // not verified by any mode
        OfficialSBT, // verified against the official IKycSBT registry
        DemoAttestor // verified against the demo allowlist (disclosed in UI)
    }

    uint8 public constant KYC_STATUS_APPROVED = 1;

    IKycSBT public kycSBT; // address(0) = official registry not configured
    uint8 public minLevel; // minimum official KYC level required

    mapping(address => bool) public demoAttested;

    error NotKycVerified(address subject);

    event KycSBTConfigured(address indexed sbt, uint8 minLevel);
    event DemoAttestationSet(address indexed subject, bool approved, string note);

    constructor(uint8 _minLevel) {
        minLevel = _minLevel;
    }

    /// @notice Point the gate at the official KYC SBT registry (set 0x0 to disable).
    function setKycSBT(address sbt, uint8 _minLevel) external onlyOwner {
        kycSBT = IKycSBT(sbt);
        minLevel = _minLevel;
        emit KycSBTConfigured(sbt, _minLevel);
    }

    /// @notice Demo-mode fallback attestation, only for wallets the operator controls
    ///         or has verified off-chain. Every change is event-logged.
    function setDemoAttestation(address subject, bool approved, string calldata note) external onlyOwner {
        demoAttested[subject] = approved;
        emit DemoAttestationSet(subject, approved, note);
    }

    /// @notice Check a subject against official SBT first, then the demo allowlist.
    /// @return ok whether the subject passes the gate
    /// @return mode which mode satisfied the check (None if !ok)
    /// @return level official KYC level when mode == OfficialSBT, else 0
    function checkKyc(address subject) public view returns (bool ok, KycMode mode, uint8 level) {
        if (address(kycSBT) != address(0)) {
            try kycSBT.getKycInfo(subject) returns (string memory, uint8 lvl, uint8 status, uint256) {
                if (status == KYC_STATUS_APPROVED && lvl >= minLevel) {
                    return (true, KycMode.OfficialSBT, lvl);
                }
            } catch {
                // registry unreachable/misconfigured — fall through to demo mode
            }
        }
        if (demoAttested[subject]) {
            return (true, KycMode.DemoAttestor, 0);
        }
        return (false, KycMode.None, 0);
    }

    /// @notice Revert-on-failure variant for use by other contracts.
    function requireKyc(address subject) external view returns (KycMode mode) {
        bool ok;
        (ok, mode,) = checkKyc(subject);
        if (!ok) revert NotKycVerified(subject);
    }
}
