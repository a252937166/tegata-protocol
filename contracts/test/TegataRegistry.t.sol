// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {KycGate} from "../src/KycGate.sol";
import {TegataRegistry} from "../src/TegataRegistry.sol";

contract TegataRegistryTest is Test {
    KycGate gate;
    TegataRegistry registry;

    address borrower = makeAddr("borrower");
    address lender = makeAddr("lender");
    address anchor = makeAddr("anchor");
    address rando = makeAddr("rando");

    bytes32 constant INVOICE_HASH = keccak256("invoice-pdf");
    bytes32 constant RISK_HASH = keccak256("risk-report");
    bytes32 constant PAYMENT_ID_FUND = keccak256("hsp-funding");
    bytes32 constant PAYMENT_ID_REPAY = keccak256("hsp-repayment");
    uint256 constant FACE = 1_000_000_000; // 1,000 USDC (6 dec)
    uint256 constant DISCOUNTED = 970_000_000; // 3% discount

    function setUp() public {
        gate = new KycGate(1);
        registry = new TegataRegistry(gate);
        registry.setAnchor(anchor);
        gate.setDemoAttestation(borrower, true, "demo borrower");
        gate.setDemoAttestation(lender, true, "demo lender");
    }

    function _register() internal returns (uint256 id) {
        vm.prank(borrower);
        id = registry.registerInvoice(INVOICE_HASH, FACE, uint64(block.timestamp + 30 days), RISK_HASH);
    }

    function test_Register_HappyPath() public {
        uint256 id = _register();
        TegataRegistry.Invoice memory inv = registry.getInvoice(id);
        assertEq(inv.borrower, borrower);
        assertEq(inv.faceAmount, FACE);
        assertEq(uint8(inv.status), uint8(TegataRegistry.Status.Registered));
        assertEq(registry.invoiceIdByHash(INVOICE_HASH), id);
    }

    function test_Register_RequiresKyc() public {
        vm.prank(rando);
        vm.expectRevert(abi.encodeWithSelector(KycGate.NotKycVerified.selector, rando));
        registry.registerInvoice(INVOICE_HASH, FACE, uint64(block.timestamp + 30 days), RISK_HASH);
    }

    function test_Register_RejectsDuplicateAndBadParams() public {
        _register();
        vm.startPrank(borrower);
        vm.expectRevert(abi.encodeWithSelector(TegataRegistry.DuplicateInvoice.selector, INVOICE_HASH));
        registry.registerInvoice(INVOICE_HASH, FACE, uint64(block.timestamp + 30 days), RISK_HASH);

        vm.expectRevert(TegataRegistry.InvalidParams.selector);
        registry.registerInvoice(keccak256("x"), 0, uint64(block.timestamp + 30 days), RISK_HASH);

        vm.expectRevert(TegataRegistry.InvalidParams.selector);
        registry.registerInvoice(keccak256("y"), FACE, uint64(block.timestamp), RISK_HASH);
        vm.stopPrank();
    }

    function test_MarkFunded_OnlyAnchor() public {
        uint256 id = _register();
        vm.prank(rando);
        vm.expectRevert(TegataRegistry.NotAnchor.selector);
        registry.markFunded(id, lender, borrower, DISCOUNTED, PAYMENT_ID_FUND);
    }

    function test_MarkFunded_HappyPath() public {
        uint256 id = _register();
        vm.prank(anchor);
        registry.markFunded(id, lender, borrower, DISCOUNTED, PAYMENT_ID_FUND);

        TegataRegistry.Invoice memory inv = registry.getInvoice(id);
        assertEq(inv.lender, lender);
        assertEq(inv.discountedAmount, DISCOUNTED);
        assertEq(inv.fundingPaymentId, PAYMENT_ID_FUND);
        assertEq(uint8(inv.status), uint8(TegataRegistry.Status.Funded));
    }

    function test_MarkFunded_ChecksPayeeLenderKycAmount() public {
        uint256 id = _register();

        vm.prank(anchor);
        vm.expectRevert(abi.encodeWithSelector(TegataRegistry.PayeeMismatch.selector, borrower, rando));
        registry.markFunded(id, lender, rando, DISCOUNTED, PAYMENT_ID_FUND);

        vm.prank(anchor);
        vm.expectRevert(abi.encodeWithSelector(KycGate.NotKycVerified.selector, rando));
        registry.markFunded(id, rando, borrower, DISCOUNTED, PAYMENT_ID_FUND);

        vm.prank(anchor);
        vm.expectRevert(TegataRegistry.InvalidParams.selector);
        registry.markFunded(id, lender, borrower, FACE + 1, PAYMENT_ID_FUND);
    }

    function test_Repay_FullLifecycle() public {
        uint256 id = _register();
        vm.startPrank(anchor);
        registry.markFunded(id, lender, borrower, DISCOUNTED, PAYMENT_ID_FUND);
        registry.markRepaid(id, lender, PAYMENT_ID_REPAY);
        vm.stopPrank();

        TegataRegistry.Invoice memory inv = registry.getInvoice(id);
        assertEq(uint8(inv.status), uint8(TegataRegistry.Status.Repaid));
        assertEq(inv.repaymentPaymentId, PAYMENT_ID_REPAY);
    }

    function test_Repay_PayeeMustBeLender() public {
        uint256 id = _register();
        vm.startPrank(anchor);
        registry.markFunded(id, lender, borrower, DISCOUNTED, PAYMENT_ID_FUND);
        vm.expectRevert(abi.encodeWithSelector(TegataRegistry.PayeeMismatch.selector, lender, rando));
        registry.markRepaid(id, rando, PAYMENT_ID_REPAY);
        vm.stopPrank();
    }

    function test_Overdue_ThenRepaid() public {
        uint256 id = _register();
        vm.prank(anchor);
        registry.markFunded(id, lender, borrower, DISCOUNTED, PAYMENT_ID_FUND);

        vm.expectRevert(TegataRegistry.InvalidParams.selector);
        registry.flagOverdue(id); // not yet due

        vm.warp(block.timestamp + 31 days);
        registry.flagOverdue(id);
        assertEq(uint8(registry.getInvoice(id).status), uint8(TegataRegistry.Status.Overdue));

        vm.prank(anchor);
        registry.markRepaid(id, lender, PAYMENT_ID_REPAY); // late repayment still closes
        assertEq(uint8(registry.getInvoice(id).status), uint8(TegataRegistry.Status.Repaid));
    }

    function test_Cancel_OnlyBorrowerWhileRegistered() public {
        uint256 id = _register();
        vm.prank(rando);
        vm.expectRevert(TegataRegistry.NotBorrower.selector);
        registry.cancel(id);

        vm.prank(borrower);
        registry.cancel(id);
        assertEq(uint8(registry.getInvoice(id).status), uint8(TegataRegistry.Status.Cancelled));

        vm.prank(anchor);
        vm.expectRevert(
            abi.encodeWithSelector(TegataRegistry.BadStatus.selector, id, TegataRegistry.Status.Cancelled)
        );
        registry.markFunded(id, lender, borrower, DISCOUNTED, PAYMENT_ID_FUND);
    }

    function test_SetPacketHash() public {
        uint256 id = _register();
        registry.setPacketHash(id, keccak256("packet"));
        assertEq(registry.getInvoice(id).packetHash, keccak256("packet"));

        vm.prank(rando);
        vm.expectRevert();
        registry.setPacketHash(id, keccak256("evil"));
    }

    function test_GetInvoice_UnknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(TegataRegistry.InvoiceNotFound.selector, 999));
        registry.getInvoice(999);
    }
}
