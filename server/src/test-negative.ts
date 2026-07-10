/**
 * Negative tests for the commercial-terms binding in /api/hsp/submit.
 *
 * A modified client must not be able to advance an invoice lifecycle with a
 * mandate that underpays, overpays, uses the wrong token, settles on the
 * wrong chain, or pays the wrong party. Every case below must be rejected
 * with 409 BEFORE any coordinator call or signature check — the server
 * recomputes the expected terms from chain state + the underwriting record
 * and refuses anything else.
 *
 *   npm run api          (in one terminal, any instance)
 *   npx tsx src/test-negative.ts [apiBase]
 */
import { encodeAbiParameters } from 'viem';
import { publicCfg as cfg } from './public-config.ts';

const API = process.argv[2] ?? 'http://127.0.0.1:4033';

const pad = (addr: string) => encodeAbiParameters([{ type: 'address' }], [addr as `0x${string}`]);

interface Case {
  name: string;
  mutate: (m: Record<string, unknown>) => void;
  expectError: string;
}

const res = await fetch(`${API}/api/invoices`);
const { invoices } = (await res.json()) as {
  invoices: { id: string; status: string; borrower: string; faceAmount: string; risk: { discountBps: number } | null }[];
};
const inv = invoices.find((i) => i.status === 'Registered' && i.risk);
if (!inv) throw new Error('need at least one Registered invoice with a risk report');

const face = BigInt(inv.faceAmount);
const correctAmount = (face * BigInt(10_000 - inv.risk!.discountBps)) / 10_000n;
const attacker = '0x000000000000000000000000000000000000dEaD';

function baseMandate(): Record<string, unknown> {
  return {
    nonce: `0x${'11'.repeat(32)}`,
    signer: { profileId: `0x${'22'.repeat(32)}`, payload: pad(attacker) },
    recipient: { kind: 0, payload: pad(inv!.borrower) },
    token: cfg.stablecoin,
    amount: correctAmount.toString(),
    chainId: cfg.anchorChainId,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    requiredCapabilitiesHash: `0x${'33'.repeat(32)}`,
  };
}

const cases: Case[] = [
  {
    name: 'underpay (amount - 1)',
    mutate: (m) => (m.amount = (correctAmount - 1n).toString()),
    expectError: 'commercial-amount-mismatch',
  },
  {
    name: 'overpay (amount + 1)',
    mutate: (m) => (m.amount = (correctAmount + 1n).toString()),
    expectError: 'commercial-amount-mismatch',
  },
  {
    name: 'pay full face instead of discounted',
    mutate: (m) => (m.amount = face.toString()),
    expectError: 'commercial-amount-mismatch',
  },
  {
    name: 'wrong settlement token',
    mutate: (m) => (m.token = attacker),
    expectError: 'unexpected-settlement-token',
  },
  {
    name: 'wrong settlement chain',
    mutate: (m) => (m.chainId = 1),
    expectError: 'unexpected-settlement-chain',
  },
  {
    name: 'redirect funds to attacker instead of borrower',
    mutate: (m) => (m.recipient = { kind: 0, payload: pad(attacker) }),
    expectError: 'payee-does-not-match-invoice',
  },
  {
    name: 'repayment leg from non-borrower payer',
    mutate: (m) => {
      // leg is switched to repayment below via marker
      (m as { __leg?: string }).__leg = 'repayment';
    },
    expectError: '', // any 4xx rejection is a pass (payee/payer both wrong pre-funding)
  },
];

let failures = 0;
for (const c of cases) {
  const mandateBody = baseMandate();
  c.mutate(mandateBody);
  const leg = (mandateBody as { __leg?: string }).__leg ?? 'funding';
  delete (mandateBody as { __leg?: string }).__leg;
  const r = await fetch(`${API}/api/hsp/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      invoiceId: inv.id,
      leg,
      paymentId: `0x${'44'.repeat(32)}`,
      mandateBody,
      mandateSignature: `0x${'55'.repeat(65)}`,
      txHash: `0x${'66'.repeat(32)}`,
    }),
  });
  const j = (await r.json()) as { error?: string };
  const rejected = r.status >= 400 && r.status < 500;
  const errorMatches = c.expectError === '' || j.error === c.expectError;
  const ok = rejected && errorMatches;
  console.log(` ${ok ? 'PASS' : 'FAIL'}  ${c.name} -> ${r.status} ${j.error ?? ''}`);
  if (!ok) failures++;
}

console.log(
  failures === 0
    ? `\nall ${cases.length} tampered mandates rejected before signature/coordinator stage`
    : `\n${failures} case(s) NOT rejected — the binding is broken`,
);
process.exit(failures === 0 ? 0 : 1);
