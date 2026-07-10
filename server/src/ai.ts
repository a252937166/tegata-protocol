import { parseUnits, formatUnits } from 'viem';
import { cfg } from './config.ts';

/**
 * AI underwriting: invoice field extraction + risk assessment.
 *
 * Uses the configured autonomous underwriting model when LLM_* env vars are
 * set; otherwise falls back to a deterministic rule engine so the pipeline
 * stays reproducible without a model. Every output is tagged with its engine
 * and hashed on-chain (riskReportHash).
 *
 * Data boundary: invoice documents never go ON-CHAIN (hashes only). In LLM
 * mode the document text IS sent to the configured external model provider
 * for extraction/assessment — the demo uses synthetic documents only, and
 * the UI says so. Production hardening: private/VPC model + redaction.
 */

export interface InvoiceFields {
  invoiceNumber: string;
  sellerName: string;
  payerName: string;
  amountBaseUnits: string; // stablecoin base units (6 decimals), decimal string
  currency: string;
  issueDate: string; // ISO date
  termDays: number;
  extractionConfidence: number; // 0..1 — how confident the EXTRACTION is; says nothing about credit
}

export interface RiskReport {
  engine: 'llm' | 'deterministic-rules';
  grade: 'A' | 'B' | 'C';
  discountBps: number; // discount charged up-front, in basis points of face
  rationale: string;
  factors: Record<string, string>;
  assessedAt: string;
}

async function callLLM(prompt: string): Promise<string | null> {
  const { baseUrl, apiKey, model } = cfg.llm;
  if (!baseUrl || !apiKey || !model) return null;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        // reasoning models spend output tokens on thinking before the text
        // block — a small cap starves the answer entirely
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) {
      console.warn(`[ai] llm backend ${res.status} — falling back to rules`);
      return null;
    }
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
    };
    const text = data.content?.find((c) => c.type === 'text')?.text ?? null;
    if (!text) console.warn(`[ai] llm returned no text block (stop: ${data.stop_reason}) — falling back to rules`);
    return text;
  } catch (e) {
    console.warn(`[ai] llm backend unreachable (${(e as Error).name}) — falling back to rules`);
    return null;
  }
}

function extractJson(text: string): unknown | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

export async function parseInvoice(documentText: string): Promise<InvoiceFields> {
  const llmText = await callLLM(
    [
      'Extract structured fields from this invoice document. Reply with ONLY a JSON object:',
      '{"invoiceNumber": string, "sellerName": string, "payerName": string,',
      ' "amountBaseUnits": string (amount in stablecoin base units, 6 decimals — e.g. "5.00" => "5000000"),',
      ' "currency": string, "issueDate": "YYYY-MM-DD", "termDays": number,',
      ' "extractionConfidence": number 0..1 (confidence that the fields were read correctly — NOT a credit opinion)}',
      '',
      '--- DOCUMENT ---',
      documentText,
    ].join('\n'),
  );
  if (llmText) {
    const parsed = extractJson(llmText) as (Partial<InvoiceFields> & { confidence?: number }) | null;
    if (parsed?.amountBaseUnits && parsed.invoiceNumber) {
      return {
        invoiceNumber: String(parsed.invoiceNumber),
        sellerName: String(parsed.sellerName ?? 'unknown'),
        payerName: String(parsed.payerName ?? 'unknown'),
        amountBaseUnits: String(parsed.amountBaseUnits),
        currency: String(parsed.currency ?? 'USDC'),
        issueDate: String(parsed.issueDate ?? new Date().toISOString().slice(0, 10)),
        termDays: Number(parsed.termDays ?? 30),
        extractionConfidence: Math.min(1, Math.max(0, Number(parsed.extractionConfidence ?? parsed.confidence ?? 0.8))),
      };
    }
  }
  // deterministic fallback: fixtures are structured JSON documents
  const doc = extractJson(documentText) as Record<string, unknown> | null;
  if (!doc) throw new Error('cannot parse invoice document');
  // `amount` is ALWAYS human units ("5" and "5.00" both mean 5 USDC);
  // callers that already have base units must say so via `amountBaseUnits`.
  // parseUnits is exact — no float math, no magnitude ambiguity.
  const baseUnits =
    doc.amountBaseUnits !== undefined
      ? String(doc.amountBaseUnits)
      : parseUnits(String(doc.amount ?? '0'), 6).toString();
  return {
    invoiceNumber: String(doc.invoiceNumber ?? doc.invoice_no ?? 'INV-UNKNOWN'),
    sellerName: String(doc.seller ?? doc.sellerName ?? 'unknown'),
    payerName: String(doc.payer ?? doc.payerName ?? 'unknown'),
    amountBaseUnits: baseUnits,
    currency: String(doc.currency ?? 'USDC'),
    issueDate: String(doc.issueDate ?? new Date().toISOString().slice(0, 10)),
    termDays: Number(doc.termDays ?? 30),
    extractionConfidence: 0.99,
  };
}

export async function assessRisk(fields: InvoiceFields): Promise<RiskReport> {
  // never let the model interpret base units on its own — hand it the
  // human-readable value and say exactly how to refer to it
  const amountHuman = (Number(BigInt(fields.amountBaseUnits)) / 1e6).toFixed(2);
  const llmText = await callLLM(
    [
      'You are an autonomous receivables underwriter for invoice discounting.',
      'You have NO external credit data. Assess ONLY the structured facts provided',
      '(tenor, dates, field completeness and consistency). Never infer creditworthiness',
      'from a company name, brand, or country — treat every party as an unknown counterparty.',
      'Reply with ONLY a JSON object:',
      '{"grade": "A"|"B"|"C",',
      ' "discountBps": number (up-front discount charged on face value for the whole tenor, basis points, 100..800 — NOT an annualized rate),',
      ' "rationale": string (2-3 sentences, professional; explicitly note the assessment uses document-level signals only, with no external credit data),',
      ' "factors": {string: string}}',
      'Grade A = short tenor + complete, internally consistent document; C = long tenor or inconsistent data. Be conservative.',
      `The face value is exactly ${amountHuman} ${fields.currency} — a small demo-scale test amount.`,
      `Refer to it as "${amountHuman} ${fields.currency}" if you mention it; never reinterpret its magnitude.`,
      '',
      `Invoice: ${JSON.stringify({ ...fields, amountHuman: `${amountHuman} ${fields.currency}` })}`,
    ].join('\n'),
  );
  if (llmText) {
    const parsed = extractJson(llmText) as Partial<RiskReport> | null;
    if (parsed?.grade && parsed.discountBps) {
      return {
        engine: 'llm',
        grade: (['A', 'B', 'C'].includes(String(parsed.grade)) ? parsed.grade : 'B') as RiskReport['grade'],
        discountBps: Math.min(800, Math.max(100, Math.round(Number(parsed.discountBps)))),
        rationale: String(parsed.rationale ?? ''),
        factors: (parsed.factors as Record<string, string>) ?? {},
        assessedAt: new Date().toISOString(),
      };
    }
  }
  // deterministic fallback rules
  const amountHumanStr = formatUnits(BigInt(fields.amountBaseUnits), 6);
  const tenorRisk = fields.termDays <= 30 ? 0 : fields.termDays <= 60 ? 1 : 2;
  const sizeRisk = Number(amountHumanStr) <= 10_000 ? 0 : Number(amountHumanStr) <= 100_000 ? 1 : 2;
  const score = tenorRisk + sizeRisk;
  const grade: RiskReport['grade'] = score <= 1 ? 'A' : score <= 2 ? 'B' : 'C';
  const discountBps = 150 + score * 125;
  return {
    engine: 'deterministic-rules',
    grade,
    discountBps,
    rationale:
      `Tenor ${fields.termDays}d and face value ${amountHumanStr} ${fields.currency} imply ${grade}-grade risk ` +
      `under the fallback rule set; up-front discount ${(discountBps / 100).toFixed(2)}% of face for the whole tenor. ` +
      'Assessment uses document-level signals only — no external credit data.',
    factors: { tenorDays: String(fields.termDays), faceValue: `${amountHumanStr} ${fields.currency}` },
    assessedAt: new Date().toISOString(),
  };
}

// deal math lives with the packet definition (zero-secret import graph);
// re-exported here for callers that think of it as underwriting output
export { discountedAmount } from './packet.ts';

/** Reject nonsensical extractions before anything touches the chain. */
export function validateInvoiceFields(fields: InvoiceFields): string | null {
  if (!/^[0-9]+$/.test(fields.amountBaseUnits) || BigInt(fields.amountBaseUnits) <= 0n) {
    return 'amountBaseUnits must be a positive integer string';
  }
  if (BigInt(fields.amountBaseUnits) > 10_000_000_000_000n) {
    return 'amount exceeds the demo ceiling (10M USDC)';
  }
  if (!Number.isInteger(fields.termDays) || fields.termDays < 1 || fields.termDays > 365) {
    return 'termDays must be an integer between 1 and 365';
  }
  if (fields.currency !== 'USDC') {
    return 'this demo settles USDC-denominated invoices only (JPY invoices need an FX-attested flow — see KNOWN_LIMITATIONS)';
  }
  // fail-closed: a malformed issue date must be rejected, never silently
  // replaced — it would quietly change the financial meaning of the term
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.issueDate) || !Number.isFinite(Date.parse(`${fields.issueDate}T00:00:00Z`))) {
    return 'issueDate must be a valid YYYY-MM-DD date';
  }
  if (!fields.invoiceNumber?.trim()) return 'invoiceNumber must be non-empty';
  if (!fields.sellerName?.trim() || !fields.payerName?.trim()) return 'sellerName and payerName must be non-empty';
  const conf = fields.extractionConfidence ?? 0;
  if (!(conf >= 0 && conf <= 1)) return 'extractionConfidence must be within 0..1';
  return null;
}

/**
 * Financial semantics: the payment term runs from the invoice's ISSUE date,
 * not from whenever someone happened to click register. Callers must run
 * validateInvoiceFields first — this throws on unparseable dates.
 */
export function dueDateFrom(fields: InvoiceFields): bigint {
  const issueTs = Date.parse(`${fields.issueDate}T00:00:00Z`);
  if (!Number.isFinite(issueTs)) throw new Error('issueDate must be a valid YYYY-MM-DD date');
  return BigInt(Math.floor(issueTs / 1000) + fields.termDays * 86_400);
}
