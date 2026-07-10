/**
 * TEGATA Protocol demo API — everything the web app needs, with the HSP write
 * key and all operator keys strictly server-side. Browsers only ever sign
 * with their own wallet.
 *
 *   npm run api        (PORT env, default 4033)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAddress, parseEther, type Address, type Hex } from 'viem';
import { cfg, repoRoot, hspExplorerUrl, mainnetDeployment } from './config.ts';
import {
  getInvoice,
  nextInvoiceId,
  checkKyc,
  setDemoAttestation,
  registerInvoice,
  walletFor,
  withOperatorLock,
  publicClient,
  STATUS_LABELS,
  type Invoice,
} from './contracts.ts';
import { parseInvoice, assessRisk, discountedAmount, validateInvoiceFields, dueDateFrom } from './ai.ts';
import { keccakOfBytes, keccakOfJson } from './canonical.ts';
import { putDoc, getDoc } from './docstore.ts';
import { preparePayment, submitPayment } from './hsp-relay.ts';
import { verifyAndAnchor, settleLeg } from './settle.ts';
import { buildPacketForInvoice } from './packet-service.ts';
import { verifyPacket, type VerificationReport } from './verification-core.ts';
import { ensureOpenInvoices, startReplenishLoop } from './replenish.ts';
import { privateKeyToAccount } from 'viem/accounts';

const PORT = Number(process.env.PORT ?? 4033);
const borrowerAccount = privateKeyToAccount(cfg.borrowerKey);

// ---------------------------------------------------------------- utilities

// Browser callers are same-origin in production (nginx proxies /api). The
// only cross-origin callers we serve are local dev builds.
const CORS_ALLOWLIST = new Set([
  'https://tegata.axiqo.xyz',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
type ResWithOrigin = ServerResponse & { reqOrigin?: string };

function json(res: ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const origin = (res as ResWithOrigin).reqOrigin;
  if (origin && CORS_ALLOWLIST.has(origin)) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-headers'] = 'content-type';
    headers['access-control-allow-methods'] = 'GET,POST,OPTIONS';
    headers['vary'] = 'origin';
  }
  res.writeHead(status, headers);
  res.end(s);
}

// ------------------------------------------------- showcase verification cache
// The web app's PASS marks all come from this: a real, periodically re-run
// execution of the shared verification core over the sample packet. The cache
// tracks failure and age explicitly — a stale or errored cache must NEVER be
// presented as a live PASS, so the report is stamped with stale/error and the
// UI downgrades accordingly.
const SHOWCASE_STALE_MS = 25 * 60_000; // refresh runs every 15 min
const showcaseCache = {
  report: null as VerificationReport | null,
  lastAttemptAt: null as string | null,
  lastSuccessAt: null as string | null,
  error: null as string | null,
};
function showcaseVerification(): VerificationReport | null {
  const r = showcaseCache.report;
  if (!r) return null;
  const stale =
    !showcaseCache.lastSuccessAt || Date.now() - Date.parse(showcaseCache.lastSuccessAt) > SHOWCASE_STALE_MS;
  return { ...r, stale, error: showcaseCache.error };
}
async function refreshShowcaseVerification() {
  showcaseCache.lastAttemptAt = new Date().toISOString();
  try {
    const sample = JSON.parse(
      readFileSync(resolve(repoRoot, 'packets', 'sample-compliance-packet.json'), 'utf8'),
    );
    showcaseCache.report = await verifyPacket(sample);
    showcaseCache.lastSuccessAt = new Date().toISOString();
    showcaseCache.error = null;
    console.log(
      `[verify] showcase #${showcaseCache.report.invoiceId}: ${showcaseCache.report.passed}/${showcaseCache.report.total} at block ${showcaseCache.report.blockNumber}`,
    );
  } catch (e) {
    showcaseCache.error = (e as Error).message;
    console.error('[verify] showcase verification failed:', showcaseCache.error);
  }
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

// Soft reservations: entering the funding step locks an invoice for that payer
// so two visitors can't race the same receivable (the second one's transfer
// would land on-chain but lose the markFunded race). The contract stays the
// source of truth; this only prevents wasted settlements at demo scale.
const RESERVATION_MS = 4 * 60_000;
const reservations = new Map<string, { payer: string; until: number }>();
function activeReservation(invoiceId: string) {
  const r = reservations.get(invoiceId);
  return r && r.until > Date.now() ? r : undefined;
}

// Every prepared paymentId is bound to (invoice, leg) server-side, so a
// mandate settled for invoice A can never be submitted to advance invoice B —
// even if both invoices happen to quote identical amounts and parties.
const PENDING_PAYMENT_MS = 60 * 60_000;
const pendingPayments = new Map<string, { invoiceId: string; leg: string; until: number }>();
function rememberPayment(paymentId: string, invoiceId: string, leg: string) {
  pendingPayments.set(paymentId.toLowerCase(), { invoiceId, leg, until: Date.now() + PENDING_PAYMENT_MS });
  if (pendingPayments.size > 5000) {
    for (const [k, v] of pendingPayments) if (v.until < Date.now()) pendingPayments.delete(k);
  }
}

// global faucet budget: treasury drips are capped per UTC day regardless of
// how many IPs ask (per-IP limiting alone doesn't bound total spend)
const FAUCET_DAILY_MAX = 60;
const faucetSpend = { day: '', n: 0 };
function faucetBudgetOk(): boolean {
  const day = new Date().toISOString().slice(0, 10);
  if (faucetSpend.day !== day) {
    faucetSpend.day = day;
    faucetSpend.n = 0;
  }
  return ++faucetSpend.n <= FAUCET_DAILY_MAX;
}

// naive per-IP rate limiter (protects operator keys + faucet relay)
const hits = new Map<string, { n: number; t: number }>();
function limited(req: IncomingMessage, route: string, max: number): boolean {
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? '?';
  const key = `${ip}:${route}`;
  const now = Date.now();
  const h = hits.get(key);
  if (!h || now - h.t > 3600_000) {
    hits.set(key, { n: 1, t: now });
    return false;
  }
  h.n++;
  return h.n > max;
}

async function enrich(id: bigint, inv: Invoice) {
  const doc = getDoc(inv.invoiceHash);
  return {
    id: id.toString(),
    ...inv,
    status: STATUS_LABELS[inv.status],
    fields: doc?.fields ?? null,
    risk: doc?.risk ?? null,
  };
}

// ---------------------------------------------------------------- routes

async function route(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') return json(res, 204, {});

  if (path === '/api/health') return json(res, 200, { ok: true, service: 'tegata-api' });

  if (path === '/api/config') {
    return json(res, 200, {
      chain: {
        id: cfg.anchorChainId,
        name: 'HashKey Chain Testnet',
        rpc: cfg.anchorRpc,
        explorer: cfg.anchorExplorer,
        nativeSymbol: 'HSK',
      },
      contracts: cfg.contracts,
      stablecoin: { address: cfg.stablecoin, symbol: 'USDC', decimals: 6 },
      hsp: {
        coordinatorUrl: cfg.coordinatorUrl,
        chainName: cfg.hspChainName,
        pinnedAdapterAddress: cfg.pinnedAdapterAddress,
        pinnedIssuerAddress: cfg.pinnedIssuerAddress,
      },
      demo: { borrower: borrowerAccount.address },
      mainnet: mainnetDeployment
        ? {
            deployed: true,
            chainId: mainnetDeployment.chainId,
            explorer: mainnetDeployment.explorer,
            contracts: mainnetDeployment.contracts,
            proof: mainnetDeployment.proof ?? null,
          }
        : { deployed: false, note: 'mainnet deployment pending — rehearsed on testnet, same bytecode' },
    });
  }

  if (path === '/api/invoices' && method === 'GET') {
    const next = await nextInvoiceId();
    const out = [];
    for (let i = 1n; i < next; i++) {
      try {
        const inv = await enrich(i, await getInvoice(i));
        const r = activeReservation(inv.id);
        out.push({ ...inv, reserved: Boolean(r), reservedBy: r?.payer ?? null });
      } catch {
        /* skip */
      }
    }
    return json(res, 200, { invoices: out.reverse() });
  }

  const invMatch = path.match(/^\/api\/invoices\/(\d+)$/);
  if (invMatch && method === 'GET') {
    const id = BigInt(invMatch[1]);
    return json(res, 200, { invoice: await enrich(id, await getInvoice(id)) });
  }

  if (path === '/api/kyc/check' && method === 'GET') {
    const address = getAddress(String(url.searchParams.get('address')));
    return json(res, 200, await checkKyc(address));
  }

  if (path === '/api/kyc/attest' && method === 'POST') {
    if (limited(req, 'kyc', 20)) return json(res, 429, { error: 'rate-limited' });
    const { address } = await readBody(req);
    const subject = getAddress(String(address));
    const existing = await checkKyc(subject);
    if (existing.ok) return json(res, 200, { ...existing, note: 'already attested' });
    const tx = await setDemoAttestation(subject, true, 'demo attestation issued via web (testnet only)');
    return json(res, 200, { ...(await checkKyc(subject)), txHash: tx });
  }

  if (path === '/api/faucet' && method === 'POST') {
    if (limited(req, 'faucet', 10)) return json(res, 429, { error: 'rate-limited' });
    const { address } = await readBody(req);
    const to = getAddress(String(address));
    // primary: relay to the HSP sandbox faucet
    try {
      const r = await fetch(`${cfg.coordinatorUrl}/faucet/faucet`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: to }),
        signal: AbortSignal.timeout(60_000),
      });
      const j = (await r.json()) as { ok?: boolean };
      if (j.ok) return json(res, 200, { source: 'hsp-sandbox-faucet', ...j });
    } catch {
      /* fall through to treasury */
    }
    // fallback: tiny drip from the demo treasury (testnet funds only).
    // The daily budget only meters TREASURY spend — sandbox-served requests
    // above never consume it.
    if (!faucetBudgetOk()) {
      return json(res, 429, { error: 'faucet-daily-budget-exhausted', detail: 'use the public HSP sandbox faucet directly' });
    }
    const drip = await withOperatorLock(async () => {
      const { client, account } = walletFor(cfg.attestorKey);
      const gasTx = await client.sendTransaction({ account, to, value: parseEther('0.005') });
      await publicClient.waitForTransactionReceipt({ hash: gasTx });
      const erc20 = [
        {
          name: 'transfer',
          type: 'function',
          stateMutability: 'nonpayable',
          inputs: [
            { type: 'address', name: 'to' },
            { type: 'uint256', name: 'amount' },
          ],
          outputs: [{ type: 'bool' }],
        },
      ] as const;
      const usdcTx = await client.writeContract({
        account,
        address: cfg.stablecoin,
        abi: erc20,
        functionName: 'transfer',
        args: [to, 2_000_000n],
      });
      await publicClient.waitForTransactionReceipt({ hash: usdcTx });
      return { gasTx, usdcTx };
    });
    return json(res, 200, { source: 'team-treasury-fallback', ...drip, sent: { gas: '0.005 HSK', usdc: '2' } });
  }

  // Borrower demo: AI-underwrite a document and register it as an open
  // receivable from the demo SME (judges trigger AI underwriting end-to-end).
  if (path === '/api/issue' && method === 'POST') {
    if (limited(req, 'issue', 6)) return json(res, 429, { error: 'rate-limited' });
    const { documentText } = await readBody(req);
    const text = String(documentText ?? '');
    if (!text || text.length > 20_000) return json(res, 400, { error: 'documentText required (max 20k chars)' });
    const invoiceHash = keccakOfBytes(Buffer.from(text));
    // quote binding: if this exact document was already underwritten (the
    // preview step keys the doc store by invoiceHash), register THAT quote —
    // the model is never re-run between what the user saw and what goes
    // on-chain, so preview grade/discount === registered grade/discount
    const existing = getDoc(invoiceHash);
    const fields = existing?.fields ?? (await parseInvoice(text));
    const risk = existing?.risk ?? (await assessRisk(fields));
    const invalid = validateInvoiceFields(fields);
    if (invalid) return json(res, 400, { error: invalid });
    const riskReportHash = keccakOfJson(risk);
    if (!existing) putDoc(invoiceHash, { fields, risk, documentText: text, riskReportHash });
    // the payment term runs from the invoice's issue date, not from now
    const dueDate = dueDateFrom(fields);
    if (dueDate <= BigInt(Math.floor(Date.now() / 1000) + 3600)) {
      return json(res, 400, {
        error: 'dueDate (issueDate + termDays) is in the past — use a recent issueDate or longer term',
      });
    }
    try {
      const reg = await registerInvoice(cfg.borrowerKey, {
        invoiceHash,
        faceAmount: BigInt(fields.amountBaseUnits),
        dueDate,
        riskReportHash,
      });
      return json(res, 200, {
        fields,
        risk,
        invoiceHash,
        riskReportHash,
        registerTx: reg.txHash,
        invoice: await enrich(reg.id, await getInvoice(reg.id)),
      });
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('DuplicateInvoice')) {
        return json(res, 409, { error: 'this exact document is already registered — change something (e.g. the invoice number) and try again' });
      }
      throw e;
    }
  }

  if (path === '/api/ai/underwrite' && method === 'POST') {
    if (limited(req, 'ai', 60)) return json(res, 429, { error: 'rate-limited' });
    const { documentText } = await readBody(req);
    const text = String(documentText ?? '');
    if (!text || text.length > 20_000) return json(res, 400, { error: 'documentText required (max 20k chars)' });
    const invoiceHash = keccakOfBytes(Buffer.from(text));
    // idempotent per document: the stored quote IS what /api/issue registers
    const existing = getDoc(invoiceHash);
    const fields = existing?.fields ?? (await parseInvoice(text));
    const risk = existing?.risk ?? (await assessRisk(fields));
    const invalid = validateInvoiceFields(fields);
    if (invalid) return json(res, 400, { error: invalid });
    const riskReportHash = keccakOfJson(risk);
    if (!existing) putDoc(invoiceHash, { fields, risk, documentText: text, riskReportHash });
    return json(res, 200, { fields, risk, invoiceHash, riskReportHash });
  }

  if (path === '/api/hsp/prepare' && method === 'POST') {
    if (limited(req, 'prepare', 60)) return json(res, 429, { error: 'rate-limited' });
    const body = await readBody(req);
    const payer = getAddress(String(body.payer));
    const invoiceId = BigInt(String(body.invoiceId));
    const leg = body.leg === 'repayment' ? 'repayment' : 'funding';
    const inv = await getInvoice(invoiceId);
    const doc = getDoc(inv.invoiceHash);
    const kyc = await checkKyc(payer);
    if (!kyc.ok) return json(res, 412, { error: 'kyc-required', detail: 'issue a demo KYC attestation first' });

    let to: Address;
    let amount: bigint;
    if (leg === 'funding') {
      if (STATUS_LABELS[inv.status] !== 'Registered') return json(res, 409, { error: `invoice is ${STATUS_LABELS[inv.status]}` });
      const r = activeReservation(invoiceId.toString());
      if (r && r.payer.toLowerCase() !== payer.toLowerCase()) {
        return json(res, 409, { error: 'reserved', detail: 'another visitor is funding this invoice right now — pick a different one' });
      }
      reservations.set(invoiceId.toString(), { payer, until: Date.now() + RESERVATION_MS });
      to = inv.borrower;
      amount = discountedAmount(inv.faceAmount, doc?.risk.discountBps ?? 200);
    } else {
      if (!['Funded', 'Overdue'].includes(STATUS_LABELS[inv.status]!)) {
        return json(res, 409, { error: `invoice is ${STATUS_LABELS[inv.status]}` });
      }
      to = inv.lender;
      amount = inv.faceAmount;
    }
    // fail before the wallet pops, not after the transfer lands
    const [usdcBal, gasBal] = await Promise.all([
      publicClient.readContract({
        address: cfg.stablecoin,
        abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const,
        functionName: 'balanceOf',
        args: [payer],
      }) as Promise<bigint>,
      publicClient.getBalance({ address: payer }),
    ]);
    if (usdcBal < amount) {
      return json(res, 412, {
        error: 'insufficient-usdc',
        detail: `this leg settles ${amount} base units but the wallet holds ${usdcBal} — use the faucet step first`,
      });
    }
    if (gasBal < parseEther('0.0003')) {
      return json(res, 412, { error: 'insufficient-gas', detail: 'not enough HSK for the settlement transaction — use the faucet step first' });
    }
    const prepared = preparePayment({ payer, to, amount });
    rememberPayment(prepared.paymentId, invoiceId.toString(), leg);
    return json(res, 200, { ...prepared, leg, invoiceId: invoiceId.toString(), to, amount: amount.toString() });
  }

  if (path === '/api/hsp/submit' && method === 'POST') {
    if (limited(req, 'submit', 60)) return json(res, 429, { error: 'rate-limited' });
    const body = await readBody(req);
    const invoiceId = BigInt(String(body.invoiceId));
    const leg = body.leg === 'repayment' ? 'repayment' : 'funding';
    const inv = await getInvoice(invoiceId);
    const expectedPayee = leg === 'funding' ? inv.borrower : inv.lender;

    // ---- commercial-terms binding -------------------------------------
    // The client's mandate is NEVER the source of truth for the deal terms.
    // Recompute the quote from trusted state (chain + underwriting record)
    // and refuse any mandate that does not match it exactly: a modified
    // client must not be able to underpay, pay the wrong party, use the
    // wrong token or settle on the wrong chain and still advance the
    // invoice lifecycle.
    const doc = getDoc(inv.invoiceHash);
    if (!doc) return json(res, 409, { error: 'missing-underwriting-record' });
    if (keccakOfJson(doc.risk) !== inv.riskReportHash) {
      return json(res, 409, { error: 'risk-report-hash-mismatch' });
    }
    const expectedAmount =
      leg === 'funding' ? discountedAmount(inv.faceAmount, doc.risk.discountBps) : inv.faceAmount;
    const mandate = body.mandateBody as {
      amount?: string;
      token?: string;
      chainId?: number;
      signer?: { payload: string };
      recipient?: { payload: string };
    };
    const hexTail = (p?: string) => (p ? `0x${p.slice(-40)}`.toLowerCase() : '');
    const mandatePayer = hexTail(mandate.signer?.payload);
    const mandatePayee = hexTail(mandate.recipient?.payload);
    if (BigInt(mandate.amount ?? '0') !== expectedAmount) {
      return json(res, 409, { error: 'commercial-amount-mismatch', expected: expectedAmount.toString() });
    }
    if ((mandate.token ?? '').toLowerCase() !== cfg.stablecoin.toLowerCase()) {
      return json(res, 409, { error: 'unexpected-settlement-token' });
    }
    if (mandate.chainId !== cfg.anchorChainId) {
      return json(res, 409, { error: 'unexpected-settlement-chain' });
    }
    if (mandatePayee !== expectedPayee.toLowerCase()) {
      return json(res, 409, { error: 'payee-does-not-match-invoice' });
    }
    if (leg === 'repayment' && mandatePayer !== inv.borrower.toLowerCase()) {
      return json(res, 409, { error: 'repayment-payer-must-be-borrower' });
    }
    if (leg === 'funding') {
      const r = activeReservation(invoiceId.toString());
      if (r && r.payer.toLowerCase() !== mandatePayer) {
        return json(res, 409, { error: 'payer-does-not-match-reservation' });
      }
    }
    // origin binding: the paymentId must be one WE prepared for THIS
    // invoice and leg — a mandate settled for invoice A can never advance
    // invoice B, even with identical amounts and parties
    const pending = pendingPayments.get(String(body.paymentId ?? '').toLowerCase());
    if (!pending || pending.invoiceId !== invoiceId.toString() || pending.leg !== leg || pending.until < Date.now()) {
      return json(res, 409, {
        error: 'unknown-payment',
        detail: 'paymentId was not prepared for this invoice/leg (or expired) — restart from prepare',
      });
    }
    // -------------------------------------------------------------------

    const settledRes = await submitPayment({
      paymentId: String(body.paymentId) as Hex,
      mandateBody: body.mandateBody as Record<string, unknown>,
      mandateSignature: String(body.mandateSignature) as Hex,
      txHash: String(body.txHash) as Hex,
    });
    if (settledRes.status !== 'SETTLED') {
      return json(res, 502, { error: 'not-settled', status: settledRes.status });
    }
    const legPacket = await verifyAndAnchor({
      leg,
      invoiceId,
      paymentId: settledRes.paymentId,
      expectedPayee,
      expectedAmount, // server-recomputed — never the client's number
      settlementTxHash: String(body.txHash),
    });
    const { packetHash } = await buildPacketForInvoice(invoiceId, { anchorHash: true });
    if (leg === 'funding') void ensureOpenInvoices(); // keep the pick list stocked
    return json(res, 200, {
      paymentId: settledRes.paymentId,
      status: 'SETTLED',
      decision: legPacket.verifierDecision,
      anchorTx: legPacket.anchor.txHash,
      hspExplorerUrl: legPacket.hspExplorerUrl,
      packetHash,
      invoice: await enrich(invoiceId, await getInvoice(invoiceId)),
    });
  }

  const repayMatch = path.match(/^\/api\/repay\/(\d+)$/);
  if (repayMatch && method === 'POST') {
    if (limited(req, 'repay', 20)) return json(res, 429, { error: 'rate-limited' });
    const invoiceId = BigInt(repayMatch[1]);
    const inv = await getInvoice(invoiceId);
    if (inv.borrower.toLowerCase() !== borrowerAccount.address.toLowerCase()) {
      return json(res, 403, { error: 'demo repayment only works for invoices issued by the demo SME' });
    }
    if (!['Funded', 'Overdue'].includes(STATUS_LABELS[inv.status]!)) {
      return json(res, 409, { error: `invoice is ${STATUS_LABELS[inv.status]}` });
    }
    const legPacket = await settleLeg({
      leg: 'repayment',
      invoiceId,
      payerKey: cfg.borrowerKey,
      payee: inv.lender,
      amount: inv.faceAmount,
    });
    const { packetHash } = await buildPacketForInvoice(invoiceId, { anchorHash: true });
    return json(res, 200, {
      paymentId: legPacket.paymentId,
      anchorTx: legPacket.anchor.txHash,
      hspExplorerUrl: legPacket.hspExplorerUrl,
      packetHash,
      invoice: await enrich(invoiceId, await getInvoice(invoiceId)),
    });
  }

  const packetMatch = path.match(/^\/api\/packet\/(\d+)$/);
  if (packetMatch && method === 'GET') {
    // ?anchor=1 re-anchors the freshly built hash (recovery after a failed
    // post-settlement rebuild); harmless when already current.
    const anchor = url.searchParams.get('anchor') === '1';
    const { packet, packetHash } = await buildPacketForInvoice(BigInt(packetMatch[1]), { anchorHash: anchor });
    return json(res, 200, { packet, packetHash });
  }

  const verifyMatch = path.match(/^\/api\/verify\/(\d+)$/);
  if (verifyMatch && method === 'POST') {
    if (limited(req, 'verify', 60)) return json(res, 429, { error: 'rate-limited' });
    const id = BigInt(verifyMatch[1]);
    // exact same check list as the auditor CLI — one verification core
    const { packet } = await buildPacketForInvoice(id);
    const report = await verifyPacket(packet);
    return json(res, 200, report);
  }

  if (path === '/api/showcase' && method === 'GET') {
    try {
      const sample = JSON.parse(
        readFileSync(resolve(repoRoot, 'packets', 'sample-compliance-packet.json'), 'utf8'),
      );
      const id = BigInt(sample.invoice.registryId);
      return json(res, 200, {
        packet: sample,
        invoice: await enrich(id, await getInvoice(id)),
        // last real run of the shared verification core over this packet —
        // the UI renders THIS report (incl. stale/error state); it never
        // asserts PASS on its own
        verification: showcaseVerification(),
        links: {
          hspExplorerFunding: sample.hspSettlement.legs[0]?.hspExplorerUrl ?? '',
          hspExplorerRepayment: sample.hspSettlement.legs[1]?.hspExplorerUrl ?? '',
          registry: `${cfg.anchorExplorer}/address/${cfg.contracts.TegataRegistry}`,
          anchor: `${cfg.anchorExplorer}/address/${cfg.contracts.SettlementAnchor}`,
        },
      });
    } catch {
      return json(res, 404, { error: 'no showcase packet yet' });
    }
  }

  if (path === '/api/readiness' && method === 'GET') {
    const out: Record<string, unknown> = {};
    try {
      out.chain = { ok: true, block: (await publicClient.getBlockNumber()).toString() };
    } catch (e) {
      out.chain = { ok: false, error: (e as Error).message };
    }
    try {
      const r = await fetch(`${cfg.coordinatorUrl}/chains`, { signal: AbortSignal.timeout(10_000) });
      out.coordinator = { ok: r.ok, status: r.status };
    } catch (e) {
      out.coordinator = { ok: false, error: (e as Error).message };
    }
    const sv = showcaseVerification();
    out.showcaseVerification = sv
      ? { ok: sv.allPass && !sv.stale && !sv.error, verifiedAt: sv.verifiedAt, stale: sv.stale }
      : { ok: false, error: showcaseCache.error ?? 'not yet computed' };
    const ok = [out.chain, out.coordinator, out.showcaseVerification].every(
      (c) => (c as { ok: boolean }).ok,
    );
    return json(res, ok ? 200 : 503, { ok, components: out });
  }

  return json(res, 404, { error: 'not found' });
}

createServer((req, res) => {
  (res as ResWithOrigin).reqOrigin = req.headers.origin;
  route(req, res).catch((e) => {
    console.error(`[api] ${req.method} ${req.url} failed:`, (e as Error).message);
    json(res, 500, { error: (e as Error).message });
  });
}).listen(PORT, () => {
  console.log(`tegata-api listening on :${PORT}`);
  console.log(`demo SME (borrower): ${borrowerAccount.address}`);
  // exactly ONE instance may replenish (chain state is shared; two writers
  // fork the off-chain document store) — set REPLENISH_DISABLED=1 on dev runs
  if (!process.env.REPLENISH_DISABLED) startReplenishLoop();
  // real verification behind every PASS mark the site shows (read-only)
  void refreshShowcaseVerification();
  setInterval(() => void refreshShowcaseVerification(), 15 * 60_000).unref();
});
