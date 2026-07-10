/**
 * Independent local verification of a compliance packet — the auditor's tool.
 *
 * Re-derives every claim in a compliance-packet.json WITHOUT trusting the
 * TEGATA backend: re-runs the HSP verifier over each embedded (mandate,
 * receipt, attestations) triple against OUR OWN pinned trust config, checks
 * the settled amounts and parties against the invoice's commercial terms,
 * recomputes every hash and compares each with the on-chain records.
 *
 * This is a thin CLI over verification-core.ts — the exact same check list
 * that backs /api/verify/:id and every PASS mark shown in the web app.
 *
 *   npx tsx src/verify-packet.ts ../packets/sample-compliance-packet.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CompliancePacket } from './packet.ts';
import { verifyPacket } from './verification-core.ts';

const [packetPath] = process.argv.slice(2);
if (!packetPath) throw new Error('usage: tsx src/verify-packet.ts <compliance-packet.json>');

const packet = JSON.parse(readFileSync(resolve(packetPath), 'utf8')) as CompliancePacket;

console.log(`=== independent local verification: Tegata #${packet.invoice.registryId} ===\n`);
const report = await verifyPacket(packet);
for (const c of report.checks) {
  console.log(` ${c.pass ? 'PASS' : 'FAIL'}  ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
}
console.log(
  `\n=== ${report.passed}/${report.total} checks passed at block ${report.blockNumber} (${report.verifiedAt}) ===`,
);
console.log(
  report.allPass
    ? '=== ALL CHECKS PASSED — the packet is cryptographically consistent ==='
    : `=== ${report.total - report.passed} CHECK(S) FAILED ===`,
);
process.exit(report.allPass ? 0 : 1);
