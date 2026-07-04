// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Owned} from "./Owned.sol";
import {TegataRegistry} from "./TegataRegistry.sol";

/// @title SettlementAnchor — anchors independently verified HSP settlements on-chain
/// @notice HSP verification (mandate / receipt / attestations → ACCEPT) is a pure
///         off-chain function run by the relying party with a pinned adapter address
///         ("verify the settlement, not the promise"). This contract does NOT re-run
///         HSP verification in Solidity; it anchors the verifier's decision, signed by
///         a designated SettlementAttestor key, and advances the invoice lifecycle in
///         TegataRegistry only for ACCEPT decisions. The full evidence bundle stays
///         off-chain in the compliance packet; its hash is anchored here.
/// @dev    HSP settlement legs run on the hackathon sandbox (hashkey-testnet, 133);
///         `settlementChainId` records that provenance explicitly on mainnet.
contract SettlementAnchor is Owned {
    enum Leg {
        Funding,
        Repayment
    }

    struct SettlementEvidence {
        uint256 invoiceId;
        uint8 leg; // Leg enum
        bytes32 paymentId; // HSP paymentId == mandateHash
        bool accepted; // HSPVerifier outcomeClass == ACCEPT
        bytes32 evidenceHash; // keccak256 of the (mandate, receipt, attestations, decision) JSON
        uint32 settlementChainId; // chain the HSP leg settled on (sandbox: 133)
        address payer; // Transfer.from == mandate signer
        address payee; // Transfer.to
        uint256 amount; // stablecoin base units
        uint64 verifiedAt; // unix time the off-chain verifier ran
    }

    struct AnchorRecord {
        SettlementEvidence evidence;
        uint64 anchoredAt;
    }

    bytes32 public constant EVIDENCE_TYPEHASH = keccak256(
        "SettlementEvidence(uint256 invoiceId,uint8 leg,bytes32 paymentId,bool accepted,bytes32 evidenceHash,uint32 settlementChainId,address payer,address payee,uint256 amount,uint64 verifiedAt)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    TegataRegistry public immutable registry;
    address public attestor;

    mapping(bytes32 => AnchorRecord) internal _anchors; // paymentId → record

    error InvalidSignature();
    error AlreadyAnchored(bytes32 paymentId);
    error InvalidParams();

    event AttestorConfigured(address indexed attestor);
    event SettlementAnchored(
        bytes32 indexed paymentId,
        uint256 indexed invoiceId,
        Leg leg,
        bool accepted,
        bytes32 evidenceHash,
        uint32 settlementChainId
    );

    constructor(TegataRegistry _registry, address _attestor) {
        if (_attestor == address(0)) revert ZeroAddress();
        registry = _registry;
        attestor = _attestor;
        emit AttestorConfigured(_attestor);
    }

    function setAttestor(address _attestor) external onlyOwner {
        if (_attestor == address(0)) revert ZeroAddress();
        attestor = _attestor;
        emit AttestorConfigured(_attestor);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes("TegataSettlementAnchor")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function hashEvidence(SettlementEvidence calldata ev) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                EVIDENCE_TYPEHASH,
                ev.invoiceId,
                ev.leg,
                ev.paymentId,
                ev.accepted,
                ev.evidenceHash,
                ev.settlementChainId,
                ev.payer,
                ev.payee,
                ev.amount,
                ev.verifiedAt
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    /// @notice Anchor an attestor-signed settlement evidence record. ACCEPT decisions
    ///         advance the invoice lifecycle; non-ACCEPT decisions are recorded only.
    function anchorSettlement(SettlementEvidence calldata ev, bytes calldata signature) external {
        if (ev.paymentId == bytes32(0) || ev.leg > uint8(Leg.Repayment)) revert InvalidParams();
        if (_anchors[ev.paymentId].anchoredAt != 0) revert AlreadyAnchored(ev.paymentId);

        bytes32 digest = hashEvidence(ev);
        if (_recover(digest, signature) != attestor) revert InvalidSignature();

        _anchors[ev.paymentId] = AnchorRecord({evidence: ev, anchoredAt: uint64(block.timestamp)});
        emit SettlementAnchored(
            ev.paymentId, ev.invoiceId, Leg(ev.leg), ev.accepted, ev.evidenceHash, ev.settlementChainId
        );

        if (ev.accepted) {
            if (Leg(ev.leg) == Leg.Funding) {
                registry.markFunded(ev.invoiceId, ev.payer, ev.payee, ev.amount, ev.paymentId);
            } else {
                registry.markRepaid(ev.invoiceId, ev.payee, ev.paymentId);
            }
        }
    }

    function getAnchor(bytes32 paymentId) external view returns (AnchorRecord memory rec) {
        rec = _anchors[paymentId];
        if (rec.anchoredAt == 0) revert InvalidParams();
    }

    function isAnchored(bytes32 paymentId) external view returns (bool) {
        return _anchors[paymentId].anchoredAt != 0;
    }

    function _recover(bytes32 digest, bytes calldata signature) internal pure returns (address) {
        if (signature.length != 65) revert InvalidSignature();
        bytes32 r = bytes32(signature[0:32]);
        bytes32 s = bytes32(signature[32:64]);
        uint8 v = uint8(signature[64]);
        // EIP-2: reject malleable s values
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            revert InvalidSignature();
        }
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }
}
