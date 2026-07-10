/**
 * Demo-SME auto-replenishment: keeps the pool of open (Registered) receivables
 * stocked so the live lender flow always has invoices to discount. Runs at
 * API startup, on an interval, and after every successful funding.
 */
import { cfg } from './config.ts';
import { keccakOfBytes, keccakOfJson } from './canonical.ts';
import { parseInvoice, assessRisk, dueDateFrom } from './ai.ts';
import { registerInvoice, getInvoice, nextInvoiceId, STATUS_LABELS } from './contracts.ts';
import { putDoc, getDoc } from './docstore.ts';

const TEMPLATES = [
  {
    prefix: 'SMW',
    seller: 'Sakura Metal Works K.K. (Yokohama)',
    payer: 'Yamato Retail Holdings Co., Ltd.',
    description: 'Precision-machined shelving brackets',
    amount: '1.20',
    termDays: 30,
    paymentTerms: 'NET-30, formerly settled by promissory note (yakusoku tegata)',
  },
  {
    prefix: 'KGF',
    seller: 'Kanda Godo Foods LLC (Tokyo)',
    payer: 'Hoshikawa Department Stores Inc.',
    description: 'Seasonal wagashi assortment',
    amount: '0.80',
    termDays: 60,
    paymentTerms: 'NET-60 rolling settlement',
  },
  {
    prefix: 'NPR',
    seller: 'Naniwa Precision Robotics K.K. (Osaka)',
    payer: 'Kansai Logistics Partners Co., Ltd.',
    description: 'Conveyor actuator maintenance kits',
    amount: '2.00',
    termDays: 45,
    paymentTerms: 'NET-45, replacing paper tegata workflow',
  },
  {
    prefix: 'HKD',
    seller: 'Hokusei Denki Seisakusho K.K. (Sapporo)',
    payer: 'Tsugaru Agri Machinery Co., Ltd.',
    description: 'Control cabinet wiring harnesses, winter lot',
    amount: '1.50',
    termDays: 90,
    paymentTerms: 'NET-90 seasonal terms, formerly tegata-settled',
  },
] as const;

let templateCursor = 0;
let running = false;

async function countOpenInvoices(): Promise<number> {
  const next = await nextInvoiceId();
  let open = 0;
  for (let i = 1n; i < next; i++) {
    try {
      const inv = await getInvoice(i);
      if (STATUS_LABELS[inv.status] === 'Registered' && getDoc(inv.invoiceHash)) open++;
    } catch {
      /* skip */
    }
  }
  return open;
}

async function issueOne(): Promise<void> {
  const t = TEMPLATES[templateCursor++ % TEMPLATES.length];
  const doc = {
    documentType: 'invoice',
    invoiceNumber: `${t.prefix}-2026-${String(Date.now()).slice(-6)}`,
    seller: t.seller,
    payer: t.payer,
    description: t.description,
    amount: t.amount,
    currency: 'USDC',
    issueDate: new Date().toISOString().slice(0, 10),
    termDays: t.termDays,
    paymentTerms: t.paymentTerms,
    note: 'Demo document for the TEGATA Protocol hackathon build. Not a real receivable.',
  };
  const text = JSON.stringify(doc, null, 2);
  const invoiceHash = keccakOfBytes(Buffer.from(text));
  const fields = await parseInvoice(text);
  const risk = await assessRisk(fields);
  const riskReportHash = keccakOfJson(risk);
  putDoc(invoiceHash, { fields, risk, documentText: text, riskReportHash });
  const dueDate = dueDateFrom(fields); // term runs from the invoice's issue date
  const reg = await registerInvoice(cfg.borrowerKey, {
    invoiceHash,
    faceAmount: BigInt(fields.amountBaseUnits),
    dueDate,
    riskReportHash,
  });
  console.log(`[replenish] issued Tegata #${reg.id} (${fields.invoiceNumber}, grade ${risk.grade})`);
}

/** Top the open pool up to `min`. Re-entrancy-guarded; failures are logged only. */
export async function ensureOpenInvoices(min = 3): Promise<void> {
  if (running) return;
  running = true;
  try {
    const open = await countOpenInvoices();
    for (let i = open; i < min; i++) await issueOne();
  } catch (e) {
    console.error('[replenish] failed:', (e as Error).message);
  } finally {
    running = false;
  }
}

export function startReplenishLoop(min = 3, intervalMs = 90_000): void {
  void ensureOpenInvoices(min);
  setInterval(() => void ensureOpenInvoices(min), intervalMs).unref();
}
