/**
 * One-off: backfill the document store from an existing packet file (for
 * invoices created before the store existed). The original document bytes are
 * not retained — only their hash lives on-chain — so the text is a marker.
 *
 *   npx tsx src/backfill-doc.ts ../packets/tegata-3.json
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { putDoc } from './docstore.ts';
import type { CompliancePacket } from './packet.ts';

const [p] = process.argv.slice(2);
const packet = JSON.parse(readFileSync(resolve(p), 'utf8')) as CompliancePacket;
putDoc(packet.invoice.invoiceHash, {
  fields: packet.invoice.parsedFields,
  risk: packet.invoice.riskReport,
  documentText: '(demo document generated at runtime; only its keccak256 hash is anchored on-chain)',
  riskReportHash: packet.invoice.riskReportHash,
});
console.log(`backfilled doc for invoice #${packet.invoice.registryId} (${packet.invoice.invoiceHash})`);
