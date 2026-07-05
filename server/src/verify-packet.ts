/**
 * Offline compliance-packet verification — the auditor's tool.
 *
 * Takes a compliance-packet.json and re-derives every claim in it WITHOUT
 * trusting the TEGATA backend:
 *
 *   1. re-runs the HSP verifier over each embedded (mandate, receipt,
 *      attestations) triple against OUR OWN pinned trust config
 *   2. recomputes each leg's evidenceHash and compares it with the
 *      attestor-signed record anchored in SettlementAnchor on-chain
 *   3. recomputes the packet hash and compares it with TegataRegistry
 *   4. cross-checks invoice hash, risk hash, paymentIds and lifecycle status
 *
 *   npx tsx src/verify-packet.ts ../packets/tegata-3.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { publicCfg as cfg } from './public-config.ts';
import { keccakOfJson } from './canonical.ts';
import { verifyIndependently, type PaymentSnapshot } from './hsp.ts';
import { publicClient, SettlementAnchorAbi, getInvoice, STATUS_LABELS } from './contracts.ts';
import { packetHashOf, type CompliancePacket } from './packet.ts';

const [packetPath] = process.argv.slice(2);
if (!packetPath) throw new Error('usage: tsx src/verify-packet.ts <compliance-packet.json>');

const packet = JSON.parse(readFileSync(resolve(packetPath), 'utf8')) as CompliancePacket;
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log(`=== offline verification: Tegata #${packet.invoice.registryId} ===\n`);

// pins: we use OUR config's pins and surface any drift from what the packet claims
const pinMatch =
  packet.hspSettlement.pinnedTrustConfig.pinnedAdapterAddress.toLowerCase() ===
  cfg.pinnedAdapterAddress.toLowerCase();
check('packet pinned adapter matches our out-of-band pin', pinMatch);

// 1) re-run the HSP verifier over each leg
for (const leg of packet.hspSettlement.legs) {
  const snapshot: PaymentSnapshot = {
    paymentId: leg.paymentId,
    chain: leg.settlementChain.name,
    status: 'SETTLED',
    mandate: leg.mandate,
    receipts: [{ receipt: leg.receipt }],
    attestations: leg.attestations,
  };
  const { decision } = await verifyIndependently(snapshot);
  const accepted =
    Boolean((decision as { ok?: boolean }).ok) &&
    (decision as { outcomeClass?: string }).outcomeClass === 'ACCEPT';
  check(`${leg.leg} leg: HSP verifier re-run`, accepted, accepted ? 'ACCEPT' : JSON.stringify(decision));

  // 2) evidenceHash vs the on-chain anchor
  const recomputed = keccakOfJson({
    mandate: leg.mandate,
    receipt: leg.receipt,
    attestations: leg.attestations,
    decision: leg.verifierDecision,
  });
  check(`${leg.leg} leg: evidenceHash recomputed`, recomputed === leg.evidenceHash);
  const anchor = (await publicClient.readContract({
    address: cfg.contracts.SettlementAnchor,
    abi: SettlementAnchorAbi,
    functionName: 'getAnchor',
    args: [leg.paymentId],
  })) as { evidence: { evidenceHash: string; accepted: boolean; amount: bigint }; anchoredAt: bigint };
  check(
    `${leg.leg} leg: on-chain anchor matches`,
    anchor.evidence.evidenceHash === recomputed && anchor.evidence.accepted,
    `anchoredAt=${new Date(Number(anchor.anchoredAt) * 1000).toISOString()}`,
  );
}

// 3) packet hash vs TegataRegistry (deterministic projection — generatedAt excluded)
const invoice = await getInvoice(BigInt(packet.invoice.registryId));
const packetHash = packetHashOf(packet);
check('packetHash matches TegataRegistry', invoice.packetHash === packetHash, packetHash);

// 4) invoice cross-checks
check('invoiceHash matches registry', invoice.invoiceHash === packet.invoice.invoiceHash);
check('riskReportHash matches registry', invoice.riskReportHash === packet.invoice.riskReportHash);
check(
  'riskReportHash re-derived from embedded risk report',
  keccakOfJson(packet.invoice.riskReport) === packet.invoice.riskReportHash,
);
check(
  'lifecycle status matches registry',
  STATUS_LABELS[invoice.status] === packet.invoice.status,
  STATUS_LABELS[invoice.status],
);
check(
  'funding paymentId matches registry',
  invoice.fundingPaymentId === packet.hspSettlement.legs.find((l) => l.leg === 'funding')?.paymentId,
);
check(
  'repayment paymentId matches registry',
  invoice.repaymentPaymentId ===
    (packet.hspSettlement.legs.find((l) => l.leg === 'repayment')?.paymentId ?? invoice.repaymentPaymentId),
);

console.log(`\n=== ${failures === 0 ? 'ALL CHECKS PASSED — the packet is cryptographically consistent' : `${failures} CHECK(S) FAILED`} ===`);
process.exit(failures === 0 ? 0 : 1);
