// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KycGate} from "../src/KycGate.sol";
import {TegataRegistry} from "../src/TegataRegistry.sol";
import {SettlementAnchor} from "../src/SettlementAnchor.sol";

contract SettlementAnchorTest is Test {
    KycGate gate;
    TegataRegistry registry;
    SettlementAnchor anchor;

    uint256 attestorPk;
    address attestor;

    address borrower = makeAddr("borrower");
    address lender = makeAddr("lender");

    uint256 invoiceId;
    uint32 constant SANDBOX_CHAIN_ID = 133; // hashkey-testnet (HSP sandbox)

    function setUp() public {
        (attestor, attestorPk) = makeAddrAndKey("attestor");

        gate = new KycGate(1);
        registry = new TegataRegistry(gate);
        anchor = new SettlementAnchor(registry, attestor);
        registry.setAnchor(address(anchor));

        gate.setDemoAttestation(borrower, true, "demo borrower");
        gate.setDemoAttestation(lender, true, "demo lender");

        vm.prank(borrower);
        invoiceId = registry.registerInvoice(
            keccak256("invoice-pdf"), 1_000_000_000, uint64(block.timestamp + 30 days), keccak256("risk")
        );
    }

    function _evidence(SettlementAnchor.Leg leg, bytes32 paymentId, bool accepted)
        internal
        view
        returns (SettlementAnchor.SettlementEvidence memory ev)
    {
        bool funding = leg == SettlementAnchor.Leg.Funding;
        ev = SettlementAnchor.SettlementEvidence({
            invoiceId: invoiceId,
            leg: uint8(leg),
            paymentId: paymentId,
            accepted: accepted,
            evidenceHash: keccak256("mandate+receipt+attestations+decision"),
            settlementChainId: SANDBOX_CHAIN_ID,
            payer: funding ? lender : borrower,
            payee: funding ? borrower : lender,
            amount: funding ? 970_000_000 : 1_000_000_000,
            verifiedAt: uint64(block.timestamp)
        });
    }

    function _sign(SettlementAnchor.SettlementEvidence memory ev, uint256 pk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = anchor.hashEvidence(ev);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_AnchorFunding_AdvancesRegistry() public {
        SettlementAnchor.SettlementEvidence memory ev =
            _evidence(SettlementAnchor.Leg.Funding, keccak256("pay-1"), true);
        anchor.anchorSettlement(ev, _sign(ev, attestorPk));

        assertTrue(anchor.isAnchored(keccak256("pay-1")));
        TegataRegistry.Invoice memory inv = registry.getInvoice(invoiceId);
        assertEq(uint8(inv.status), uint8(TegataRegistry.Status.Funded));
        assertEq(inv.lender, lender);
        assertEq(inv.fundingPaymentId, keccak256("pay-1"));
    }

    function test_FullLifecycle_FundingThenRepayment() public {
        SettlementAnchor.SettlementEvidence memory fund =
            _evidence(SettlementAnchor.Leg.Funding, keccak256("pay-1"), true);
        anchor.anchorSettlement(fund, _sign(fund, attestorPk));

        SettlementAnchor.SettlementEvidence memory repay =
            _evidence(SettlementAnchor.Leg.Repayment, keccak256("pay-2"), true);
        anchor.anchorSettlement(repay, _sign(repay, attestorPk));

        assertEq(uint8(registry.getInvoice(invoiceId).status), uint8(TegataRegistry.Status.Repaid));
    }

    function test_RejectedDecision_AnchoredButNoLifecycleChange() public {
        SettlementAnchor.SettlementEvidence memory ev =
            _evidence(SettlementAnchor.Leg.Funding, keccak256("pay-bad"), false);
        anchor.anchorSettlement(ev, _sign(ev, attestorPk));

        assertTrue(anchor.isAnchored(keccak256("pay-bad")));
        assertEq(uint8(registry.getInvoice(invoiceId).status), uint8(TegataRegistry.Status.Registered));
    }

    function test_WrongSigner_Reverts() public {
        (, uint256 evilPk) = makeAddrAndKey("evil");
        SettlementAnchor.SettlementEvidence memory ev =
            _evidence(SettlementAnchor.Leg.Funding, keccak256("pay-1"), true);
        bytes memory sig = _sign(ev, evilPk);
        vm.expectRevert(SettlementAnchor.InvalidSignature.selector);
        anchor.anchorSettlement(ev, sig);
    }

    function test_TamperedEvidence_Reverts() public {
        SettlementAnchor.SettlementEvidence memory ev =
            _evidence(SettlementAnchor.Leg.Funding, keccak256("pay-1"), true);
        bytes memory sig = _sign(ev, attestorPk);
        ev.amount = ev.amount + 1; // tamper after signing
        vm.expectRevert(SettlementAnchor.InvalidSignature.selector);
        anchor.anchorSettlement(ev, sig);
    }

    function test_DoubleAnchor_Reverts() public {
        SettlementAnchor.SettlementEvidence memory ev =
            _evidence(SettlementAnchor.Leg.Funding, keccak256("pay-1"), true);
        bytes memory sig = _sign(ev, attestorPk);
        anchor.anchorSettlement(ev, sig);
        vm.expectRevert(abi.encodeWithSelector(SettlementAnchor.AlreadyAnchored.selector, keccak256("pay-1")));
        anchor.anchorSettlement(ev, sig);
    }

    function test_SetAttestor_OnlyOwner() public {
        vm.prank(borrower);
        vm.expectRevert();
        anchor.setAttestor(borrower);

        (address newAttestor, uint256 newPk) = makeAddrAndKey("attestor-2");
        anchor.setAttestor(newAttestor);

        SettlementAnchor.SettlementEvidence memory ev =
            _evidence(SettlementAnchor.Leg.Funding, keccak256("pay-1"), true);
        bytes memory oldSig = _sign(ev, attestorPk);
        bytes memory newSig = _sign(ev, newPk);
        vm.expectRevert(SettlementAnchor.InvalidSignature.selector);
        anchor.anchorSettlement(ev, oldSig); // old key rejected

        anchor.anchorSettlement(ev, newSig); // new key accepted
        assertTrue(anchor.isAnchored(keccak256("pay-1")));
    }
}
