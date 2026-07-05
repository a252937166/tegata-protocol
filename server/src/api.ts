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
import { parseInvoice, assessRisk, discountedAmount } from './ai.ts';
import { keccakOfBytes, keccakOfJson } from './canonical.ts';
import { putDoc, getDoc } from './docstore.ts';
import { preparePayment, submitPayment } from './hsp-relay.ts';
import { verifyAndAnchor, settleLeg } from './settle.ts';
import { buildPacketForInvoice } from './packet-service.ts';
import { ensureOpenInvoices, startReplenishLoop } from './replenish.ts';
import { privateKeyToAccount } from 'viem/accounts';

const PORT = Number(process.env.PORT ?? 4033);
const borrowerAccount = privateKeyToAccount(cfg.borrowerKey);

// ---------------------------------------------------------------- utilities

function json(res: ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(s);
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
    // fallback: tiny drip from the demo treasury (testnet funds only)
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
    const fields = await parseInvoice(text);
    const risk = await assessRisk(fields);
    const invoiceHash = keccakOfBytes(Buffer.from(text));
    const riskReportHash = keccakOfJson(risk);
    putDoc(invoiceHash, { fields, risk, documentText: text, riskReportHash });
    const dueDate = BigInt(Math.floor(Date.now() / 1000) + Math.max(1, fields.termDays) * 86_400);
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
    const fields = await parseInvoice(text);
    const risk = await assessRisk(fields);
    const invoiceHash = keccakOfBytes(Buffer.from(text));
    const riskReportHash = keccakOfJson(risk);
    putDoc(invoiceHash, { fields, risk, documentText: text, riskReportHash });
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
    const prepared = preparePayment({ payer, to, amount });
    return json(res, 200, { ...prepared, leg, invoiceId: invoiceId.toString(), to, amount: amount.toString() });
  }

  if (path === '/api/hsp/submit' && method === 'POST') {
    if (limited(req, 'submit', 60)) return json(res, 429, { error: 'rate-limited' });
    const body = await readBody(req);
    const invoiceId = BigInt(String(body.invoiceId));
    const leg = body.leg === 'repayment' ? 'repayment' : 'funding';
    const inv = await getInvoice(invoiceId);
    const expectedPayee = leg === 'funding' ? inv.borrower : inv.lender;

    const settledRes = await submitPayment({
      paymentId: String(body.paymentId) as Hex,
      mandateBody: body.mandateBody as Record<string, unknown>,
      mandateSignature: String(body.mandateSignature) as Hex,
      txHash: String(body.txHash) as Hex,
    });
    if (settledRes.status !== 'SETTLED') {
      return json(res, 502, { error: 'not-settled', status: settledRes.status });
    }
    const amount = BigInt((body.mandateBody as { amount: string }).amount);
    const legPacket = await verifyAndAnchor({
      leg,
      invoiceId,
      paymentId: settledRes.paymentId,
      expectedPayee,
      expectedAmount: amount,
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
    const inv = await getInvoice(id);
    const { packet, packetHash } = await buildPacketForInvoice(id);
    const checks = [
      {
        label: 'HSP verifier re-run on every settlement leg (pinned adapter + issuer)',
        pass: packet.hspSettlement.legs.every(
          (l) => (l.verifierDecision as { outcomeClass?: string }).outcomeClass === 'ACCEPT',
        ),
      },
      { label: 'packetHash matches TegataRegistry on-chain record', pass: inv.packetHash === packetHash },
      { label: 'invoiceHash matches registry', pass: inv.invoiceHash === packet.invoice.invoiceHash },
      {
        label: 'riskReportHash re-derived from embedded report matches registry',
        pass: keccakOfJson(packet.invoice.riskReport) === inv.riskReportHash,
      },
      {
        label: 'funding paymentId matches registry',
        pass:
          inv.fundingPaymentId ===
          (packet.hspSettlement.legs.find((l) => l.leg === 'funding')?.paymentId ?? inv.fundingPaymentId),
      },
      {
        label: 'repayment paymentId matches registry',
        pass:
          inv.repaymentPaymentId ===
          (packet.hspSettlement.legs.find((l) => l.leg === 'repayment')?.paymentId ?? inv.repaymentPaymentId),
      },
    ];
    return json(res, 200, { checks, allPass: checks.every((c) => c.pass), packetHash });
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

  return json(res, 404, { error: 'not found' });
}

createServer((req, res) => {
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
});
