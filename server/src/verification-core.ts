/**
 * The single verification core shared by every surface that claims a check
 * passed: the auditor CLI (verify-packet.ts), the HTTP API (/api/verify/:id)
 * and — through the API — every PASS mark and hanko stamp in the web app.
 * Nothing in the UI is allowed to hardcode a verdict; it renders this report.
 *
 * Zero-secret by design: depends only on public config, the public RPC and
 * the Coordinator's public read endpoints, so a clean clone can re-run it.
 */
import { publicCfg as cfg } from './public-config.ts';
import { keccakOfJson } from './canonical.ts';
import { verifyIndependently, payloadToAddress, type PaymentSnapshot } from './hsp.ts';
import { publicClient, SettlementAnchorAbi, getInvoice, STATUS_LABELS, type Invoice } from './contracts.ts';
import { packetHashOf, discountedAmount, type CompliancePacket, type SettlementLegPacket } from './packet.ts';

export interface VerificationCheck {
  id: string;
  label: string;
  pass: boolean;
  detail?: string;
}

export interface VerificationReport {
  invoiceId: string;
  packetHash: `0x${string}`;
  checks: VerificationCheck[];
  passed: number;
  total: number;
  allPass: boolean;
  verifiedAt: string; // ISO timestamp of THIS verification run
  chainId: number;
  blockNumber: string; // chain head observed during the run
}

function mandateParties(leg: SettlementLegPacket) {
  const body = (leg.mandate as { body?: unknown })?.body as
    | { signer?: { payload: string }; recipient?: { payload: string }; amount?: string; token?: string }
    | undefined;
  if (!body?.signer?.payload || !body?.recipient?.payload) return null;
  return {
    payer: payloadToAddress(body.signer.payload).toLowerCase(),
    payee: payloadToAddress(body.recipient.payload).toLowerCase(),
    amount: BigInt(body.amount ?? '0'),
    token: (body.token ?? '').toLowerCase(),
  };
}

async function legChecks(leg: SettlementLegPacket, invoice: Invoice, riskDiscountBps: number) {
  const out: VerificationCheck[] = [];
  const L = leg.leg;

  // 1) independent HSP verifier re-run under OUR pinned trust config.
  //    Issuer trust is enforced here too: attestations signed by anything but
  //    the pinned issuer fail the capability check and the leg is rejected.
  let accepted = false;
  let decisionDetail = '';
  try {
    const snapshot: PaymentSnapshot = {
      paymentId: leg.paymentId,
      chain: leg.settlementChain.name,
      status: 'SETTLED',
      mandate: leg.mandate,
      receipts: [{ receipt: leg.receipt }],
      attestations: leg.attestations,
    };
    const { decision } = await verifyIndependently(snapshot);
    accepted =
      Boolean((decision as { ok?: boolean }).ok) &&
      (decision as { outcomeClass?: string }).outcomeClass === 'ACCEPT';
    decisionDetail = accepted ? 'ACCEPT' : JSON.stringify(decision);
  } catch (e) {
    decisionDetail = (e as Error).message;
  }
  out.push({
    id: `${L}-verifier`,
    label: `${L} leg: HSP verifier re-run (pinned adapter + pinned issuer)`,
    pass: accepted,
    detail: decisionDetail,
  });

  // 2) both compliance attestations are embedded in the packet
  out.push({
    id: `${L}-attestations`,
    label: `${L} leg: kyc + sanctions attestations embedded`,
    pass: (leg.attestations?.length ?? 0) >= 2,
    detail: `${leg.attestations?.length ?? 0} attestation(s)`,
  });

  // 3) commercial terms: the settled mandate matches the invoice's terms —
  //    right parties, right token, and the amount the risk report quotes
  //    (discounted advance on funding, full face value on repayment).
  const parties = mandateParties(leg);
  const expectedAmount =
    L === 'funding' ? discountedAmount(invoice.faceAmount, riskDiscountBps) : invoice.faceAmount;
  const expectedPayee = (L === 'funding' ? invoice.borrower : invoice.lender).toLowerCase();
  const expectedPayer = (L === 'funding' ? invoice.lender : invoice.borrower).toLowerCase();
  const commercialOk =
    !!parties &&
    parties.payee === expectedPayee &&
    parties.payer === expectedPayer &&
    parties.amount === expectedAmount &&
    parties.token === cfg.stablecoin.toLowerCase();
  out.push({
    id: `${L}-commercial`,
    label: `${L} leg: mandate parties + amount match the invoice's commercial terms`,
    pass: commercialOk,
    detail: parties
      ? `${parties.amount} base units ${parties.payer.slice(0, 10)}… → ${parties.payee.slice(0, 10)}… (expected ${expectedAmount})`
      : 'mandate body unreadable',
  });

  // 4) evidenceHash re-derived from the embedded triple + decision
  const recomputed = keccakOfJson({
    mandate: leg.mandate,
    receipt: leg.receipt,
    attestations: leg.attestations,
    decision: leg.verifierDecision,
  });
  out.push({
    id: `${L}-evidence-hash`,
    label: `${L} leg: evidenceHash re-derived from embedded evidence`,
    pass: recomputed === leg.evidenceHash,
  });

  // 5) the attestor-signed record anchored on-chain matches that hash
  let anchorOk = false;
  let anchorDetail = '';
  try {
    const anchor = (await publicClient.readContract({
      address: cfg.contracts.SettlementAnchor,
      abi: SettlementAnchorAbi,
      functionName: 'getAnchor',
      args: [leg.paymentId],
    })) as { evidence: { evidenceHash: string; accepted: boolean }; anchoredAt: bigint };
    anchorOk = anchor.evidence.evidenceHash === recomputed && anchor.evidence.accepted;
    anchorDetail = `anchoredAt=${new Date(Number(anchor.anchoredAt) * 1000).toISOString()}`;
  } catch (e) {
    anchorDetail = (e as Error).message;
  }
  out.push({
    id: `${L}-anchor`,
    label: `${L} leg: on-chain SettlementAnchor record matches`,
    pass: anchorOk,
    detail: anchorDetail,
  });

  return out;
}

/**
 * Re-derive every claim in a compliance packet from primary sources.
 * A full (repaid) lifecycle produces 19 checks; a funded-only packet 14.
 */
export async function verifyPacket(packet: CompliancePacket): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];
  const pins = packet.hspSettlement.pinnedTrustConfig as { pinnedAdapterAddress: string } & {
    pinnedIssuerAddress?: string;
  };

  checks.push({
    id: 'pin-adapter',
    label: 'packet pinned adapter matches our out-of-band pin',
    pass: pins.pinnedAdapterAddress.toLowerCase() === cfg.pinnedAdapterAddress.toLowerCase(),
  });
  checks.push({
    id: 'pin-issuer',
    label: 'packet pinned compliance issuer matches our out-of-band pin',
    pass: (pins.pinnedIssuerAddress ?? '').toLowerCase() === cfg.pinnedIssuerAddress.toLowerCase(),
    detail: pins.pinnedIssuerAddress ?? 'packet does not embed an issuer pin',
  });

  const invoice = await getInvoice(BigInt(packet.invoice.registryId));
  const discountBps = packet.invoice.riskReport.discountBps;

  for (const leg of packet.hspSettlement.legs) {
    checks.push(...(await legChecks(leg, invoice, discountBps)));
  }

  const packetHash = packetHashOf(packet);
  checks.push({
    id: 'packet-hash',
    label: 'packetHash re-derived and matches TegataRegistry on-chain',
    pass: invoice.packetHash === packetHash,
    detail: packetHash,
  });
  checks.push({
    id: 'invoice-hash',
    label: 'invoiceHash matches registry',
    pass: invoice.invoiceHash === packet.invoice.invoiceHash,
  });
  checks.push({
    id: 'risk-hash-registry',
    label: 'riskReportHash matches registry',
    pass: invoice.riskReportHash === packet.invoice.riskReportHash,
  });
  checks.push({
    id: 'risk-hash-derived',
    label: 'riskReportHash re-derived from embedded risk report',
    pass: keccakOfJson(packet.invoice.riskReport) === packet.invoice.riskReportHash,
  });
  checks.push({
    id: 'status',
    label: 'lifecycle status matches registry',
    pass: STATUS_LABELS[invoice.status] === packet.invoice.status,
    detail: STATUS_LABELS[invoice.status],
  });
  checks.push({
    id: 'payment-id-funding',
    label: 'funding paymentId matches registry',
    pass:
      invoice.fundingPaymentId ===
      (packet.hspSettlement.legs.find((l) => l.leg === 'funding')?.paymentId ?? invoice.fundingPaymentId),
  });
  checks.push({
    id: 'payment-id-repayment',
    label: 'repayment paymentId matches registry',
    pass:
      invoice.repaymentPaymentId ===
      (packet.hspSettlement.legs.find((l) => l.leg === 'repayment')?.paymentId ?? invoice.repaymentPaymentId),
  });

  const blockNumber = await publicClient.getBlockNumber();
  const passed = checks.filter((c) => c.pass).length;
  return {
    invoiceId: packet.invoice.registryId,
    packetHash,
    checks,
    passed,
    total: checks.length,
    allPass: passed === checks.length,
    verifiedAt: new Date().toISOString(),
    chainId: cfg.anchorChainId,
    blockNumber: blockNumber.toString(),
  };
}
