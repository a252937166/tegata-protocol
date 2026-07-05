/**
 * Headless rehearsal of the judge's live-demo path (Mode B), simulating the
 * browser wallet with a throwaway local key. Exercises the REAL API server:
 *
 *   faucet -> demo KYC -> prepare -> wallet-sign (typed data + tx) -> submit
 *   -> verify+anchor -> demo repayment -> packet verify
 *
 *   npx tsx src/test-judge-flow.ts [apiBase]
 */
import { createWalletClient, hashTypedData, http, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { anchorChain } from './contracts.ts';

const api = process.argv[2] ?? 'http://127.0.0.1:4033';

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(j)}`);
  return j as Record<string, unknown>;
}

// 0) a fresh "judge" wallet — like a visitor who just installed MetaMask
const judgeKey = generatePrivateKey();
const judge = privateKeyToAccount(judgeKey);
console.log(`[0] judge wallet: ${judge.address}`);

// 1) claim test funds
const faucet = await call('POST', '/api/faucet', { address: judge.address });
console.log(`[1] faucet via ${faucet.source}`);
await new Promise((r) => setTimeout(r, 4000)); // let balances land

// 2) one-click demo KYC attestation
const kyc = await call('POST', '/api/kyc/attest', { address: judge.address });
console.log(`[2] KYC mode: ${kyc.modeLabel}`);

// 3) pick the newest open invoice
const { invoices } = (await call('GET', '/api/invoices')) as { invoices: { id: string; status: string }[] };
const open = invoices.find((i) => i.status === 'Registered');
if (!open) throw new Error('no Registered invoice to fund — run seed.ts');
console.log(`[3] funding Tegata #${open.id}`);

// 4) prepare -> sign typed data + broadcast settlement tx (the wallet's two ops)
const prepared = (await call('POST', '/api/hsp/prepare', {
  payer: judge.address,
  invoiceId: open.id,
  leg: 'funding',
})) as {
  paymentId: Hex;
  mandateBody: Record<string, unknown>;
  toSign: [
    { params: { typedData: Parameters<typeof hashTypedData>[0] } },
    { params: { tx: { to: Hex; data: Hex } } },
  ];
};
const typedData = prepared.toSign[0].params.typedData;
const digest = hashTypedData(typedData);
if (digest.toLowerCase() !== prepared.paymentId.toLowerCase()) {
  throw new Error('typed-data digest != paymentId — refusing to sign');
}
const mandateSignature = await judge.signTypedData(typedData as never);
const wallet = createWalletClient({ account: judge, chain: anchorChain, transport: http() });
const txHash = await wallet.sendTransaction({
  to: prepared.toSign[1].params.tx.to,
  data: prepared.toSign[1].params.tx.data,
  value: 0n,
});
console.log(`[4] mandate signed, settlement broadcast: ${txHash}`);

// 5) submit — server registers, observes, verifies, anchors
const submitted = (await call('POST', '/api/hsp/submit', {
  invoiceId: open.id,
  leg: 'funding',
  paymentId: prepared.paymentId,
  mandateBody: prepared.mandateBody,
  mandateSignature,
  txHash,
})) as { status: string; anchorTx: string; invoice: { status: string; lender: string } };
console.log(`[5] ${submitted.status}; anchored ${submitted.anchorTx}`);
console.log(`    invoice status: ${submitted.invoice.status}, lender = ${submitted.invoice.lender}`);
if (submitted.invoice.lender.toLowerCase() !== judge.address.toLowerCase()) throw new Error('lender mismatch');

// 6) demo SME auto-repays (the collections agent)
const repaid = (await call('POST', `/api/repay/${open.id}`)) as { invoice: { status: string } };
console.log(`[6] repayment settled; invoice status: ${repaid.invoice.status}`);

// 7) packet + verification checks
const verify = (await call('POST', `/api/verify/${open.id}`)) as {
  allPass: boolean;
  checks: { label: string; pass: boolean }[];
};
for (const c of verify.checks) console.log(`    ${c.pass ? 'PASS' : 'FAIL'}  ${c.label}`);
console.log(`[7] verification: ${verify.allPass ? 'ALL PASS' : 'FAILURES PRESENT'}`);
if (!verify.allPass) process.exit(1);
console.log('\n=== judge flow rehearsal complete ===');
