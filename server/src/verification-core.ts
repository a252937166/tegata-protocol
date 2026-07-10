/**
 * The single verification core shared by every surface that claims a check
 * passed: the auditor CLI (verify-packet.ts), the HTTP API (/api/verify/:id)
 * and — through the API — every PASS mark and hanko stamp in the web app.
 * Nothing in the UI is allowed to hardcode a verdict; it renders this report.
 *
 * The check list is a closed semantic loop, layered:
 *   1. structure   — schema, leg cardinality, unique paymentIds
 *   2. trust roots — pinned adapter/issuer/chain/contract addresses
 *   3. settlement  — per leg: HSP verifier re-run, decision equality,
 *                    attestations, commercial terms (amount/parties/token/
 *                    chain), adapter-signed receipt binding (decoded proof),
 *                    evidenceHash, full-field on-chain anchor, anchor event
 *   4. lifecycle   — registry terms/status/paymentIds + emitted events
 *
 * Zero-secret by design: depends only on public config, the public RPC and
 * the Coordinator's public read endpoints, so a clean clone can re-run it.
 */
import { decodeAbiParameters, parseAbiItem } from 'viem';
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
  /** set by the API's cache layer, never by the core itself */
  stale?: boolean;
  error?: string | null;
}

const KYC_MODE_LABELS = ['none', 'official-sbt', 'demo-attestor'] as const;
const ZERO32 = `0x${'0'.repeat(64)}`;
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';

const REGISTERED_EVENT = parseAbiItem(
  'event InvoiceRegistered(uint256 indexed id, address indexed borrower, bytes32 invoiceHash, uint256 faceAmount, uint64 dueDate, bytes32 riskReportHash, uint8 kycMode)',
);
const FUNDED_EVENT = parseAbiItem(
  'event InvoiceFunded(uint256 indexed id, address indexed lender, uint256 discountedAmount, bytes32 paymentId, uint8 lenderKycMode)',
);
const ANCHORED_EVENT = parseAbiItem(
  'event SettlementAnchored(bytes32 indexed paymentId, uint256 indexed invoiceId, uint8 leg, bool accepted, bytes32 evidenceHash, uint32 settlementChainId)',
);

const isHex = (v: unknown, bytes: number) =>
  typeof v === 'string' && new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`).test(v);
const isAddr = (v: unknown) => isHex(v, 20);
const isUintString = (v: unknown) => typeof v === 'string' && /^[0-9]+$/.test(v) && BigInt(v) > 0n;

/** Layer 1: strict runtime shape validation — external JSON is never trusted. */
function schemaErrors(p: CompliancePacket): string[] {
  const errs: string[] = [];
  const need = (ok: boolean, msg: string) => {
    if (!ok) errs.push(msg);
  };
  need(p.packetVersion === '1', 'packetVersion must be "1"');
  need(p.protocol === 'TEGATA Protocol', 'unexpected protocol tag');
  need(/^[0-9]+$/.test(p.invoice?.registryId ?? ''), 'registryId must be a decimal string');
  need(isHex(p.invoice?.invoiceHash, 32), 'invoiceHash must be bytes32');
  need(isHex(p.invoice?.riskReportHash, 32), 'riskReportHash must be bytes32');
  need(isUintString(p.invoice?.faceAmountBaseUnits), 'faceAmountBaseUnits must be a positive integer string');
  need(!Number.isNaN(Date.parse(p.invoice?.dueDate ?? '')), 'dueDate must be an ISO date');
  need(
    ['Registered', 'Funded', 'Repaid', 'Overdue', 'Cancelled'].includes(p.invoice?.status ?? ''),
    'status must be a known lifecycle value',
  );
  const bps = p.invoice?.riskReport?.discountBps;
  need(Number.isInteger(bps) && bps >= 0 && bps <= 10_000, 'discountBps must be 0..10000');
  need(isAddr(p.identity?.borrower), 'identity.borrower must be an address');
  need(isAddr(p.identity?.lender), 'identity.lender must be an address');
  need(isAddr(p.identity?.kycGateContract), 'identity.kycGateContract must be an address');
  const pins = p.hspSettlement?.pinnedTrustConfig as
    | { pinnedAdapterAddress?: string; pinnedIssuerAddress?: string; chainId?: number; stablecoin?: string }
    | undefined;
  need(isAddr(pins?.pinnedAdapterAddress), 'pinned adapter must be an address');
  need(isAddr(pins?.pinnedIssuerAddress), 'pinned issuer must be an address');
  need((pins?.chainId ?? 0) > 0, 'pinned chainId must be nonzero');
  need(Array.isArray(p.hspSettlement?.legs), 'legs must be an array');
  for (const [i, leg] of (p.hspSettlement?.legs ?? []).entries()) {
    need(leg.leg === 'funding' || leg.leg === 'repayment', `leg[${i}]: unknown leg kind "${leg.leg}"`);
    need(isHex(leg.paymentId, 32), `leg[${i}]: paymentId must be bytes32`);
    need(isHex(leg.evidenceHash, 32), `leg[${i}]: evidenceHash must be bytes32`);
    need((leg.settlementChain?.chainId ?? 0) > 0, `leg[${i}]: settlement chainId must be nonzero`);
    need(Array.isArray(leg.attestations), `leg[${i}]: attestations must be an array`);
    need(isAddr(leg.anchor?.contract), `leg[${i}]: anchor contract must be an address`);
  }
  need(isAddr(p.chainAnchors?.registry?.contract), 'registry anchor contract must be an address');
  need(isAddr(p.chainAnchors?.settlementAnchors?.contract), 'settlement anchor contract must be an address');
  return errs;
}

function mandateFacts(leg: SettlementLegPacket) {
  const body = (leg.mandate as { body?: unknown })?.body as
    | {
        signer?: { payload: string };
        recipient?: { payload: string };
        amount?: string;
        token?: string;
        chainId?: number;
      }
    | undefined;
  if (!body?.signer?.payload || !body?.recipient?.payload) return null;
  return {
    payer: payloadToAddress(body.signer.payload).toLowerCase(),
    payee: payloadToAddress(body.recipient.payload).toLowerCase(),
    amount: BigInt(body.amount ?? '0'),
    token: (body.token ?? '').toLowerCase(),
    chainId: body.chainId ?? 0,
  };
}

/** Decode the adapter-signed settlement proof: the receipt's own record of
 *  the exact on-chain transfer it observed. */
function decodeAdapterProof(proof: string) {
  try {
    const [from, to, token, amount, chainId, txHash, blockNumber] = decodeAbiParameters(
      [
        { type: 'address' },
        { type: 'address' },
        { type: 'address' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'uint256' },
      ],
      proof as `0x${string}`,
    );
    return { from, to, token, amount, chainId, txHash, blockNumber };
  } catch {
    return null;
  }
}

async function legChecks(leg: SettlementLegPacket, invoice: Invoice, invoiceId: bigint, riskDiscountBps: number) {
  const out: VerificationCheck[] = [];
  const L = leg.leg;

  // --- independent HSP verifier re-run under OUR pinned trust config.
  //     Issuer trust is enforced here: attestations signed by anything but
  //     the pinned issuer fail the capability check and the leg is rejected.
  let accepted = false;
  let freshDecision: unknown = null;
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
    freshDecision = decision;
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

  // --- the packet must embed the SAME decision the verifier produces today —
  //     a packet cannot carry a doctored decision next to valid raw evidence
  out.push({
    id: `${L}-decision-match`,
    label: `${L} leg: embedded decision equals fresh verifier decision`,
    pass: freshDecision !== null && keccakOfJson(freshDecision) === keccakOfJson(leg.verifierDecision),
  });

  out.push({
    id: `${L}-attestations`,
    label: `${L} leg: kyc + sanctions attestations embedded`,
    pass: (leg.attestations?.length ?? 0) >= 2,
    detail: `${leg.attestations?.length ?? 0} attestation(s)`,
  });

  // --- commercial terms: the settled mandate matches the invoice's terms —
  //     right parties, right token, right chain, and the amount the risk
  //     report quotes (discounted advance on funding, face on repayment)
  const facts = mandateFacts(leg);
  const expectedAmount =
    L === 'funding' ? discountedAmount(invoice.faceAmount, riskDiscountBps) : invoice.faceAmount;
  const expectedPayee = (L === 'funding' ? invoice.borrower : invoice.lender).toLowerCase();
  const expectedPayer = (L === 'funding' ? invoice.lender : invoice.borrower).toLowerCase();
  const commercialOk =
    !!facts &&
    facts.payee === expectedPayee &&
    facts.payer === expectedPayer &&
    facts.amount === expectedAmount &&
    facts.token === cfg.stablecoin.toLowerCase() &&
    facts.chainId === cfg.anchorChainId &&
    leg.settlementChain.chainId === cfg.anchorChainId &&
    leg.settlementChain.name === cfg.hspChainName;
  out.push({
    id: `${L}-commercial`,
    label: `${L} leg: mandate matches invoice terms (amount + parties + token + chain)`,
    pass: commercialOk,
    detail: facts
      ? `${facts.amount} base units ${facts.payer.slice(0, 10)}… → ${facts.payee.slice(0, 10)}… on chain ${facts.chainId} (expected ${expectedAmount})`
      : 'mandate body unreadable',
  });

  // --- the adapter-signed receipt must bind THIS mandate and record the
  //     exact transfer: decode its proof and cross-check every field
  const receipt = leg.receipt as { mandateHash?: string; outcome?: number; adapterProof?: string };
  const proof = receipt.adapterProof ? decodeAdapterProof(receipt.adapterProof) : null;
  const proofOk =
    !!facts &&
    !!proof &&
    (receipt.mandateHash ?? '').toLowerCase() === leg.paymentId.toLowerCase() &&
    receipt.outcome === 1 &&
    proof.from.toLowerCase() === facts.payer &&
    proof.to.toLowerCase() === facts.payee &&
    proof.token.toLowerCase() === facts.token &&
    proof.amount === facts.amount &&
    Number(proof.chainId) === cfg.anchorChainId &&
    (!leg.settlementTxHash || leg.settlementTxHash.toLowerCase() === proof.txHash.toLowerCase());
  out.push({
    id: `${L}-receipt-binding`,
    label: `${L} leg: adapter-signed proof binds the exact transfer (from/to/token/amount/chain/tx)`,
    pass: proofOk,
    detail: proof ? `settlement tx ${proof.txHash.slice(0, 18)}… block ${proof.blockNumber}` : 'proof undecodable',
  });

  // --- evidenceHash re-derived from the embedded triple + decision
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

  // --- the attestor-signed record anchored on-chain matches EVERY field of
  //     what we just verified — not only the hash
  let anchorOk = false;
  let anchorDetail = '';
  try {
    const anchor = (await publicClient.readContract({
      address: cfg.contracts.SettlementAnchor,
      abi: SettlementAnchorAbi,
      functionName: 'getAnchor',
      args: [leg.paymentId],
    })) as {
      evidence: {
        invoiceId: bigint;
        leg: number;
        paymentId: string;
        accepted: boolean;
        evidenceHash: string;
        settlementChainId: number;
        payer: string;
        payee: string;
        amount: bigint;
        verifiedAt: bigint;
      };
      anchoredAt: bigint;
    };
    const ev = anchor.evidence;
    anchorOk =
      !!facts &&
      ev.invoiceId === invoiceId &&
      ev.leg === (L === 'funding' ? 0 : 1) &&
      ev.paymentId.toLowerCase() === leg.paymentId.toLowerCase() &&
      ev.accepted &&
      ev.evidenceHash === recomputed &&
      Number(ev.settlementChainId) === cfg.anchorChainId &&
      ev.payer.toLowerCase() === facts.payer &&
      ev.payee.toLowerCase() === facts.payee &&
      ev.amount === facts.amount &&
      ev.verifiedAt > 0n;
    anchorDetail = `anchoredAt=${new Date(Number(anchor.anchoredAt) * 1000).toISOString()}`;
  } catch (e) {
    anchorDetail = (e as Error).message;
  }
  out.push({
    id: `${L}-anchor`,
    label: `${L} leg: on-chain anchor matches all fields (id/leg/payment/parties/amount/chain/hash)`,
    pass: anchorOk,
    detail: anchorDetail,
  });

  // --- the anchor tx named by the packet actually emitted the event
  let eventOk = false;
  let eventDetail = '';
  try {
    const logs = await publicClient.getLogs({
      address: cfg.contracts.SettlementAnchor,
      event: ANCHORED_EVENT,
      args: { paymentId: leg.paymentId },
      fromBlock: cfg.deployBlock,
    });
    const log = logs[0];
    eventOk =
      !!log &&
      log.transactionHash.toLowerCase() === (leg.anchor.txHash ?? '').toLowerCase() &&
      log.args.invoiceId === invoiceId &&
      log.args.leg === (L === 'funding' ? 0 : 1) &&
      log.args.accepted === true &&
      (log.args.evidenceHash ?? '').toLowerCase() === recomputed.toLowerCase();
    eventDetail = log ? `event in tx ${log.transactionHash.slice(0, 18)}…` : 'no SettlementAnchored event found';
  } catch (e) {
    eventDetail = (e as Error).message;
  }
  out.push({
    id: `${L}-anchor-event`,
    label: `${L} leg: SettlementAnchored event emitted in the packet's anchor tx`,
    pass: eventOk,
    detail: eventDetail,
  });

  return out;
}

/**
 * Re-derive every claim in a compliance packet from primary sources.
 * A full (repaid) lifecycle currently produces 34 checks.
 */
export async function verifyPacket(packet: CompliancePacket): Promise<VerificationReport> {
  const checks: VerificationCheck[] = [];

  // ---- layer 1: structure -------------------------------------------------
  const errs = schemaErrors(packet);
  checks.push({
    id: 'schema-valid',
    label: 'packet passes strict runtime schema validation',
    pass: errs.length === 0,
    detail: errs.length ? errs.slice(0, 3).join('; ') : undefined,
  });

  const legs = packet.hspSettlement.legs ?? [];
  const fundingLegs = legs.filter((l) => l.leg === 'funding');
  const repaymentLegs = legs.filter((l) => l.leg === 'repayment');
  const status = packet.invoice.status;

  checks.push({
    id: 'funding-leg-exactly-once',
    label: 'exactly one funding leg (when funded)',
    pass: ['Funded', 'Repaid'].includes(status) ? fundingLegs.length === 1 : fundingLegs.length === 0,
    detail: `${fundingLegs.length} funding leg(s), status ${status}`,
  });
  checks.push({
    id: 'repayment-leg-cardinality',
    label: 'repayment leg present exactly when status is Repaid',
    pass: status === 'Repaid' ? repaymentLegs.length === 1 : repaymentLegs.length === 0,
    detail: `${repaymentLegs.length} repayment leg(s), status ${status}`,
  });
  checks.push({
    id: 'unique-payment-ids',
    label: 'no duplicate paymentIds across legs',
    pass: new Set(legs.map((l) => l.paymentId.toLowerCase())).size === legs.length,
  });

  // ---- layer 2: pinned trust roots ---------------------------------------
  const pins = packet.hspSettlement.pinnedTrustConfig as {
    pinnedAdapterAddress: string;
    pinnedIssuerAddress?: string;
    chainId?: number;
    stablecoin?: string;
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
  checks.push({
    id: 'pin-chain-token',
    label: 'packet pinned chain + settlement token match our config',
    pass:
      pins.chainId === cfg.anchorChainId && (pins.stablecoin ?? '').toLowerCase() === cfg.stablecoin.toLowerCase(),
  });
  checks.push({
    id: 'contract-addresses',
    label: 'packet contract addresses match the published deployment',
    pass:
      packet.identity.kycGateContract.toLowerCase() === cfg.contracts.KycGate.toLowerCase() &&
      packet.chainAnchors.registry.contract.toLowerCase() === cfg.contracts.TegataRegistry.toLowerCase() &&
      packet.chainAnchors.settlementAnchors.contract.toLowerCase() ===
        cfg.contracts.SettlementAnchor.toLowerCase() &&
      packet.chainAnchors.registry.chainId === cfg.anchorChainId &&
      packet.chainAnchors.settlementAnchors.chainId === cfg.anchorChainId,
  });

  // ---- layer 3: settlement legs -------------------------------------------
  const invoiceId = BigInt(packet.invoice.registryId);
  const invoice = await getInvoice(invoiceId);
  const discountBps = packet.invoice.riskReport.discountBps;
  for (const leg of legs) {
    if (leg.leg !== 'funding' && leg.leg !== 'repayment') continue; // schema check already failed it
    checks.push(...(await legChecks(leg, invoice, invoiceId, discountBps)));
  }

  // ---- layer 4: registry lifecycle ----------------------------------------
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
    pass: STATUS_LABELS[invoice.status] === status,
    detail: STATUS_LABELS[invoice.status],
  });
  checks.push({
    id: 'invoice-terms',
    label: 'face amount, due date, borrower and lender match registry',
    pass:
      BigInt(packet.invoice.faceAmountBaseUnits) === invoice.faceAmount &&
      Math.floor(Date.parse(packet.invoice.dueDate) / 1000) === Number(invoice.dueDate) &&
      packet.identity.borrower.toLowerCase() === invoice.borrower.toLowerCase() &&
      (invoice.lender === ZERO_ADDR ||
        packet.identity.lender.toLowerCase() === invoice.lender.toLowerCase()),
  });

  // paymentIds: strict, no fallback — cardinality checks above guarantee the
  // legs this compares against actually exist for the claimed status
  checks.push({
    id: 'payment-id-funding',
    label: 'funding paymentId matches registry',
    pass: ['Funded', 'Repaid'].includes(status)
      ? fundingLegs.length === 1 && invoice.fundingPaymentId === fundingLegs[0].paymentId
      : invoice.fundingPaymentId === ZERO32,
  });
  checks.push({
    id: 'payment-id-repayment',
    label: 'repayment paymentId matches registry',
    pass:
      status === 'Repaid'
        ? repaymentLegs.length === 1 && invoice.repaymentPaymentId === repaymentLegs[0].paymentId
        : invoice.repaymentPaymentId === ZERO32,
  });

  // ---- layer 4b: emitted events (historical facts, not current state) -----
  try {
    const regLogs = await publicClient.getLogs({
      address: cfg.contracts.TegataRegistry,
      event: REGISTERED_EVENT,
      args: { id: invoiceId },
      fromBlock: cfg.deployBlock,
    });
    const r = regLogs[0];
    checks.push({
      id: 'register-event',
      label: 'InvoiceRegistered event matches packet (tx, borrower, hashes, historical KYC mode)',
      pass:
        !!r &&
        r.transactionHash.toLowerCase() === packet.chainAnchors.registry.registerTxHash.toLowerCase() &&
        (r.args.borrower ?? '').toLowerCase() === packet.identity.borrower.toLowerCase() &&
        (r.args.invoiceHash ?? '').toLowerCase() === packet.invoice.invoiceHash.toLowerCase() &&
        r.args.faceAmount === BigInt(packet.invoice.faceAmountBaseUnits) &&
        (r.args.riskReportHash ?? '').toLowerCase() === packet.invoice.riskReportHash.toLowerCase() &&
        KYC_MODE_LABELS[r.args.kycMode ?? 0] === packet.identity.borrowerKycMode,
      detail: r ? `kycMode at registration: ${KYC_MODE_LABELS[r.args.kycMode ?? 0]}` : 'event not found',
    });
  } catch (e) {
    checks.push({ id: 'register-event', label: 'InvoiceRegistered event matches packet', pass: false, detail: (e as Error).message });
  }

  if (fundingLegs.length === 1) {
    try {
      const fLogs = await publicClient.getLogs({
        address: cfg.contracts.TegataRegistry,
        event: FUNDED_EVENT,
        args: { id: invoiceId },
        fromBlock: cfg.deployBlock,
      });
      const f = fLogs[0];
      const facts = mandateFacts(fundingLegs[0]);
      checks.push({
        id: 'funded-event',
        label: 'InvoiceFunded event matches packet (lender, amount, paymentId, historical KYC mode)',
        pass:
          !!f &&
          !!facts &&
          (f.args.lender ?? '').toLowerCase() === facts.payer &&
          f.args.discountedAmount === facts.amount &&
          (f.args.paymentId ?? '').toLowerCase() === fundingLegs[0].paymentId.toLowerCase() &&
          f.transactionHash.toLowerCase() === (fundingLegs[0].anchor.txHash ?? '').toLowerCase() &&
          KYC_MODE_LABELS[f.args.lenderKycMode ?? 0] === packet.identity.lenderKycMode,
        detail: f ? `lender kycMode at funding: ${KYC_MODE_LABELS[f.args.lenderKycMode ?? 0]}` : 'event not found',
      });
    } catch (e) {
      checks.push({ id: 'funded-event', label: 'InvoiceFunded event matches packet', pass: false, detail: (e as Error).message });
    }
  }

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
