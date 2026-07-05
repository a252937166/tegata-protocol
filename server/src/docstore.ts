import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { repoRoot } from './public-config.ts';
import type { InvoiceFields, RiskReport } from './ai.ts';

/**
 * Off-chain document store: maps invoiceHash -> parsed fields + risk report +
 * the original document text. This is the ONLY place documents live — the
 * chain sees hashes exclusively. Persisted to disk so seeded demo invoices
 * survive restarts.
 */
export interface DocRecord {
  fields: InvoiceFields;
  risk: RiskReport;
  documentText: string;
  riskReportHash: `0x${string}`;
}

const dataDir = resolve(repoRoot, 'server', 'data');
const dataPath = resolve(dataDir, 'docs.json');

let store: Record<string, DocRecord> = {};

function reload() {
  if (!existsSync(dataPath)) return;
  try {
    store = JSON.parse(readFileSync(dataPath, 'utf8'));
  } catch {
    /* keep current */
  }
}
reload();

export function putDoc(invoiceHash: `0x${string}`, rec: DocRecord) {
  reload(); // merge with what other processes may have written
  store[invoiceHash.toLowerCase()] = rec;
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(dataPath, JSON.stringify(store, null, 2));
}

export function getDoc(invoiceHash: `0x${string}`): DocRecord | undefined {
  const key = invoiceHash.toLowerCase();
  if (!store[key]) reload(); // read-through: another process may have added it
  return store[key];
}
