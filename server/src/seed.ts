/**
 * Seed demo invoices (Registered, unfunded) from the demo SME so the live
 * lender flow always has something to fund.
 *
 *   npx tsx src/seed.ts
 */
import { cfg } from './config.ts';
import { keccakOfBytes, keccakOfJson } from './canonical.ts';
import { parseInvoice, assessRisk } from './ai.ts';
import { registerInvoice } from './contracts.ts';
import { putDoc } from './docstore.ts';

const SEEDS = [
  {
    invoiceNumber: `SMW-2026-${String(Date.now()).slice(-5)}A`,
    seller: 'Sakura Metal Works K.K. (Yokohama)',
    payer: 'Yamato Retail Holdings Co., Ltd.',
    description: 'Precision-machined shelving brackets — 2,500 units',
    amount: '1.20',
    currency: 'USDC',
    issueDate: '2026-07-02',
    termDays: 30,
    paymentTerms: 'NET-30, formerly settled by promissory note (yakusoku tegata)',
    note: 'Demo document for the TEGATA Protocol hackathon build. Not a real receivable.',
  },
  {
    invoiceNumber: `KGF-2026-${String(Date.now()).slice(-5)}B`,
    seller: 'Kanda Godo Foods LLC (Tokyo)',
    payer: 'Hoshikawa Department Stores Inc.',
    description: 'Seasonal wagashi assortment, summer catalogue',
    amount: '0.80',
    currency: 'USDC',
    issueDate: '2026-06-28',
    termDays: 60,
    paymentTerms: 'NET-60 rolling settlement',
    note: 'Demo document for the TEGATA Protocol hackathon build. Not a real receivable.',
  },
  {
    invoiceNumber: `NPR-2026-${String(Date.now()).slice(-5)}C`,
    seller: 'Naniwa Precision Robotics K.K. (Osaka)',
    payer: 'Kansai Logistics Partners Co., Ltd.',
    description: 'Conveyor actuator maintenance kits — lot 7',
    amount: '2.00',
    currency: 'USDC',
    issueDate: '2026-07-03',
    termDays: 45,
    paymentTerms: 'NET-45, replacing paper tegata workflow',
    note: 'Demo document for the TEGATA Protocol hackathon build. Not a real receivable.',
  },
];

for (const seed of SEEDS) {
  const text = JSON.stringify(seed, null, 2);
  const bytes = Buffer.from(text);
  const invoiceHash = keccakOfBytes(bytes);
  const fields = await parseInvoice(text);
  const risk = await assessRisk(fields);
  const riskReportHash = keccakOfJson(risk);
  putDoc(invoiceHash, { fields, risk, documentText: text, riskReportHash });
  const dueDate = BigInt(Math.floor(Date.now() / 1000) + fields.termDays * 86_400);
  const reg = await registerInvoice(cfg.borrowerKey, {
    invoiceHash,
    faceAmount: BigInt(fields.amountBaseUnits),
    dueDate,
    riskReportHash,
  });
  console.log(`seeded Tegata #${reg.id}: ${fields.invoiceNumber} face=${fields.amountBaseUnits} grade=${risk.grade}`);
}
