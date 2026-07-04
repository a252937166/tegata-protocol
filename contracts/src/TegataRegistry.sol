// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Owned} from "./Owned.sol";
import {KycGate} from "./KycGate.sol";

/// @title TegataRegistry — on-chain registry of invoice-backed credit records
/// @notice Each record represents a receivable (the credit function historically served
///         by Japan's paper promissory note, "tegata") registered by a KYC-gated SME.
///         Records are NOT transferable tokens and carry no public offering semantics:
///         only content hashes, amounts, dates and lifecycle status live on-chain.
///         Settlement legs are HSP payments; their paymentIds are written here by the
///         authorized SettlementAnchor after off-chain verification.
contract TegataRegistry is Owned {
    enum Status {
        None,
        Registered, // borrower registered the receivable
        Funded, // lender's HSP disbursement verified + anchored
        Repaid, // repayment HSP leg verified + anchored
        Overdue, // past dueDate while still Funded
        Cancelled // withdrawn by borrower before funding
    }

    struct Invoice {
        address borrower; // SME that owns the receivable
        address lender; // discounting counterparty (set on funding)
        bytes32 invoiceHash; // keccak256 of the off-chain invoice document
        bytes32 riskReportHash; // keccak256 of the AI risk report
        uint256 faceAmount; // face value, stablecoin base units (6 decimals)
        uint256 discountedAmount; // amount actually disbursed
        uint64 dueDate;
        uint64 createdAt;
        Status status;
        bytes32 fundingPaymentId; // HSP paymentId (mandateHash) of the disbursement leg
        bytes32 repaymentPaymentId; // HSP paymentId of the repayment leg
        bytes32 packetHash; // keccak256 of the exported compliance packet
    }

    KycGate public immutable kycGate;
    address public anchor; // SettlementAnchor allowed to mutate settlement state

    uint256 public nextId = 1;
    mapping(uint256 => Invoice) public invoices;
    mapping(bytes32 => uint256) public invoiceIdByHash;

    error NotAnchor();
    error InvoiceNotFound(uint256 id);
    error BadStatus(uint256 id, Status actual);
    error DuplicateInvoice(bytes32 invoiceHash);
    error InvalidParams();
    error PayeeMismatch(address expected, address actual);
    error NotBorrower();

    event AnchorConfigured(address indexed anchor);
    event InvoiceRegistered(
        uint256 indexed id,
        address indexed borrower,
        bytes32 invoiceHash,
        uint256 faceAmount,
        uint64 dueDate,
        bytes32 riskReportHash,
        KycGate.KycMode kycMode
    );
    event InvoiceFunded(
        uint256 indexed id, address indexed lender, uint256 discountedAmount, bytes32 paymentId, KycGate.KycMode lenderKycMode
    );
    event InvoiceRepaid(uint256 indexed id, bytes32 paymentId);
    event InvoiceOverdue(uint256 indexed id);
    event InvoiceCancelled(uint256 indexed id);
    event PacketHashSet(uint256 indexed id, bytes32 packetHash);

    modifier onlyAnchor() {
        if (msg.sender != anchor) revert NotAnchor();
        _;
    }

    constructor(KycGate _kycGate) {
        kycGate = _kycGate;
    }

    function setAnchor(address _anchor) external onlyOwner {
        if (_anchor == address(0)) revert ZeroAddress();
        anchor = _anchor;
        emit AnchorConfigured(_anchor);
    }

    /// @notice Register a receivable. Caller must pass the KYC gate.
    function registerInvoice(bytes32 invoiceHash, uint256 faceAmount, uint64 dueDate, bytes32 riskReportHash)
        external
        returns (uint256 id)
    {
        KycGate.KycMode mode = kycGate.requireKyc(msg.sender);
        if (invoiceHash == bytes32(0) || faceAmount == 0 || dueDate <= block.timestamp) revert InvalidParams();
        if (invoiceIdByHash[invoiceHash] != 0) revert DuplicateInvoice(invoiceHash);

        id = nextId++;
        invoices[id] = Invoice({
            borrower: msg.sender,
            lender: address(0),
            invoiceHash: invoiceHash,
            riskReportHash: riskReportHash,
            faceAmount: faceAmount,
            discountedAmount: 0,
            dueDate: dueDate,
            createdAt: uint64(block.timestamp),
            status: Status.Registered,
            fundingPaymentId: bytes32(0),
            repaymentPaymentId: bytes32(0),
            packetHash: bytes32(0)
        });
        invoiceIdByHash[invoiceHash] = id;
        emit InvoiceRegistered(id, msg.sender, invoiceHash, faceAmount, dueDate, riskReportHash, mode);
    }

    /// @notice Called by SettlementAnchor after the funding HSP leg verified ACCEPT.
    /// @param payee recipient of the verified HSP transfer — must equal the borrower.
    function markFunded(uint256 id, address lender, address payee, uint256 discountedAmount, bytes32 paymentId)
        external
        onlyAnchor
    {
        Invoice storage inv = _get(id);
        if (inv.status != Status.Registered) revert BadStatus(id, inv.status);
        if (payee != inv.borrower) revert PayeeMismatch(inv.borrower, payee);
        if (discountedAmount == 0 || discountedAmount > inv.faceAmount || paymentId == bytes32(0)) {
            revert InvalidParams();
        }
        KycGate.KycMode lenderMode = kycGate.requireKyc(lender);

        inv.lender = lender;
        inv.discountedAmount = discountedAmount;
        inv.fundingPaymentId = paymentId;
        inv.status = Status.Funded;
        emit InvoiceFunded(id, lender, discountedAmount, paymentId, lenderMode);
    }

    /// @notice Called by SettlementAnchor after the repayment HSP leg verified ACCEPT.
    /// @param payee recipient of the verified HSP transfer — must equal the lender.
    function markRepaid(uint256 id, address payee, bytes32 paymentId) external onlyAnchor {
        Invoice storage inv = _get(id);
        if (inv.status != Status.Funded && inv.status != Status.Overdue) revert BadStatus(id, inv.status);
        if (payee != inv.lender) revert PayeeMismatch(inv.lender, payee);
        if (paymentId == bytes32(0)) revert InvalidParams();

        inv.repaymentPaymentId = paymentId;
        inv.status = Status.Repaid;
        emit InvoiceRepaid(id, paymentId);
    }

    /// @notice Keeper-style poke: anyone may flag a funded invoice past its due date.
    function flagOverdue(uint256 id) external {
        Invoice storage inv = _get(id);
        if (inv.status != Status.Funded) revert BadStatus(id, inv.status);
        if (block.timestamp <= inv.dueDate) revert InvalidParams();
        inv.status = Status.Overdue;
        emit InvoiceOverdue(id);
    }

    /// @notice Borrower may withdraw an unfunded record.
    function cancel(uint256 id) external {
        Invoice storage inv = _get(id);
        if (msg.sender != inv.borrower) revert NotBorrower();
        if (inv.status != Status.Registered) revert BadStatus(id, inv.status);
        inv.status = Status.Cancelled;
        emit InvoiceCancelled(id);
    }

    /// @notice Operator writes the hash of the exported compliance packet (off-chain
    ///         evidence bundle: HSP mandate/receipt/attestations + verifier decision).
    function setPacketHash(uint256 id, bytes32 packetHash) external onlyOwner {
        Invoice storage inv = _get(id);
        if (packetHash == bytes32(0)) revert InvalidParams();
        inv.packetHash = packetHash;
        emit PacketHashSet(id, packetHash);
    }

    function getInvoice(uint256 id) external view returns (Invoice memory) {
        return _get(id);
    }

    function _get(uint256 id) internal view returns (Invoice storage inv) {
        inv = invoices[id];
        if (inv.status == Status.None) revert InvoiceNotFound(id);
    }
}
