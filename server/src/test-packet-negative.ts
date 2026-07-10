/**
 * Negative tests for the verification core: doctored packets must FAIL the
 * specific check that guards the doctored property. Each case deep-clones
 * the sample packet, applies one mutation, re-runs the FULL core and asserts
 * the expected check id flipped to FAIL.
 *
 *   npx tsx src/test-packet-negative.ts [path-to-packet.json]
 *
 * (Each run re-executes the HSP verifier and all chain reads, so the whole
 * suite takes a few minutes — it is an auditor's tool, not a unit test.)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CompliancePacket } from './packet.ts';
import { verifyPacket } from './verification-core.ts';

const packetPath = process.argv[2] ?? resolve(import.meta.dirname, '..', '..', 'packets', 'sample-compliance-packet.json');
const original = JSON.parse(readFileSync(packetPath, 'utf8')) as CompliancePacket;

type Mutation = { name: string; expectFail: string; mutate: (p: CompliancePacket) => void };

const funding = (p: CompliancePacket) => p.hspSettlement.legs.find((l) => l.leg === 'funding')!;
const repaymentIdx = (p: CompliancePacket) => p.hspSettlement.legs.findIndex((l) => l.leg === 'repayment');

const cases: Mutation[] = [
  {
    name: 'repayment leg deleted from a Repaid packet',
    expectFail: 'repayment-leg-cardinality',
    mutate: (p) => p.hspSettlement.legs.splice(repaymentIdx(p), 1),
  },
  {
    name: 'funding leg duplicated',
    expectFail: 'funding-leg-exactly-once',
    mutate: (p) => p.hspSettlement.legs.push(structuredClone(funding(p))),
  },
  {
    name: 'repayment paymentId set equal to funding paymentId',
    expectFail: 'unique-payment-ids',
    mutate: (p) => (p.hspSettlement.legs[repaymentIdx(p)].paymentId = funding(p).paymentId),
  },
  {
    name: 'unknown leg kind smuggled in',
    expectFail: 'schema-valid',
    mutate: (p) => {
      const extra = structuredClone(funding(p));
      (extra as { leg: string }).leg = 'refund';
      p.hspSettlement.legs.push(extra);
    },
  },
  {
    name: 'funding mandate amount inflated by 1 base unit',
    expectFail: 'funding-commercial',
    mutate: (p) => {
      const body = (funding(p).mandate as { body: { amount: string } }).body;
      body.amount = (BigInt(body.amount) + 1n).toString();
    },
  },
  {
    name: 'embedded verifier decision doctored',
    expectFail: 'funding-decision-match',
    mutate: (p) => (funding(p).verifierDecision = { ok: true, outcomeClass: 'ACCEPT', note: 'doctored' }),
  },
  {
    name: 'settlement chainId rewritten to mainnet',
    expectFail: 'funding-commercial',
    mutate: (p) => (funding(p).settlementChain.chainId = 177),
  },
  {
    name: 'outer settlementTxHash pointed at a different tx',
    expectFail: 'funding-receipt-binding',
    mutate: (p) => (funding(p).settlementTxHash = `0x${'ab'.repeat(32)}`),
  },
  {
    name: 'pinned issuer replaced',
    expectFail: 'pin-issuer',
    mutate: (p) =>
      ((p.hspSettlement.pinnedTrustConfig as { pinnedIssuerAddress: string }).pinnedIssuerAddress =
        '0x000000000000000000000000000000000000dEaD'),
  },
  {
    name: 'packet re-pointed at a different registry invoice',
    expectFail: 'invoice-hash',
    mutate: (p) => (p.invoice.registryId = '1'),
  },
];

let failures = 0;
for (const c of cases) {
  const doctored = structuredClone(original);
  c.mutate(doctored);
  const report = await verifyPacket(doctored);
  const target = report.checks.find((ch) => ch.id === c.expectFail);
  const ok = report.allPass === false && target !== undefined && target.pass === false;
  console.log(
    ` ${ok ? 'PASS' : 'FAIL'}  ${c.name} -> ${c.expectFail} ${target ? (target.pass ? 'unexpectedly PASSED' : 'correctly FAILED') : 'check missing'} (${report.passed}/${report.total})`,
  );
  if (!ok) failures++;
}

console.log(
  failures === 0
    ? `\nall ${cases.length} doctored packets correctly rejected by their guarding check`
    : `\n${failures} doctored packet(s) NOT caught — the core has a gap`,
);
process.exit(failures === 0 ? 0 : 1);
