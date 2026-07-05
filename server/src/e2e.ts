/**
 * End-to-end lifecycle driver against HashKey Chain testnet + the HSP sandbox:
 *
 *   parse invoice (AI) -> risk report -> register on TegataRegistry
 *   -> lender funds via HSP compliant payment -> verify -> anchor (Funded)
 *   -> borrower repays via HSP compliant payment -> verify -> anchor (Repaid)
 *   -> build compliance packet -> packetHash on-chain -> write packets/*.json
 *
 *   npm run e2e
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
import { cfg, repoRoot, anchorTxUrl, hspExplorerUrl } from './config.ts';
import { keccakOfBytes, keccakOfJson } from './canonical.ts';
import { putDoc } from './docstore.ts';
import { parseInvoice, assessRisk, discountedAmount } from './ai.ts';
import {
  registerInvoice,
  getInvoice,
  checkKyc,
  setPacketHash,
  STATUS_LABELS,
} from './contracts.ts';
import { settleLeg } from './settle.ts';
import { buildPacket } from './packet.ts';

const borrower = privateKeyToAccount(cfg.borrowerKey);
const lender = privateKeyToAccount(cfg.lenderKey);

console.log('=== TEGATA Protocol e2e (hashkey-testnet + HSP sandbox) ===\n');

// 1) AI underwriting — each run issues a fresh invoice document (unique number),
// mirroring reality: one document, one hash, one registry record.
const docPath = resolve(repoRoot, 'server', 'fixtures', 'invoice-001.json');
const template = JSON.parse(readFileSync(docPath, 'utf8')) as Record<string, unknown>;
template.invoiceNumber = `SMW-2026-${String(Date.now()).slice(-6)}`;
const docBytes = Buffer.from(JSON.stringify(template, null, 2));
const invoiceHash = keccakOfBytes(docBytes);
const fields = await parseInvoice(docBytes.toString('utf8'));
const risk = await assessRisk(fields);
const riskReportHash = keccakOfJson(risk);
putDoc(invoiceHash, { fields, risk, documentText: docBytes.toString('utf8'), riskReportHash });
console.log(`[1] parsed by ${risk.engine}: ${fields.invoiceNumber}, face ${fields.amountBaseUnits} (${fields.currency})`);
console.log(`    risk grade ${risk.grade}, discount ${risk.discountBps} bps`);
console.log(`    invoiceHash    ${invoiceHash}`);
console.log(`    riskReportHash ${riskReportHash}`);

// 2) KYC gate check (both parties must pass before touching the registry)
const bKyc = await checkKyc(borrower.address);
const lKyc = await checkKyc(lender.address);
if (!bKyc.ok || !lKyc.ok) throw new Error('KYC gate not satisfied for demo wallets');
console.log(`[2] KYC: borrower=${bKyc.modeLabel}, lender=${lKyc.modeLabel}`);

// 3) register the receivable
const face = BigInt(fields.amountBaseUnits);
const dueDate = BigInt(Math.floor(Date.now() / 1000) + fields.termDays * 86_400);
const reg = await registerInvoice(cfg.borrowerKey, { invoiceHash, faceAmount: face, dueDate, riskReportHash });
console.log(`[3] registered Tegata #${reg.id}  tx ${anchorTxUrl(reg.txHash)}`);

// 4) funding leg: lender -> borrower, discounted amount, HSP compliant payment
const disbursed = discountedAmount(face, risk.discountBps);
console.log(`[4] funding ${disbursed} base units via HSP (compliant profile)...`);
const fundingLeg = await settleLeg({
  leg: 'funding',
  invoiceId: reg.id,
  payerKey: cfg.lenderKey,
  payee: borrower.address,
  amount: disbursed,
});
let inv = await getInvoice(reg.id);
console.log(`    paymentId ${fundingLeg.paymentId}`);
console.log(`    verified ACCEPT -> anchored ${anchorTxUrl(fundingLeg.anchor.txHash)}`);
console.log(`    registry status: ${STATUS_LABELS[inv.status]}`);

// 5) repayment leg: borrower -> lender, face amount
console.log(`[5] repaying ${face} base units via HSP (compliant profile)...`);
const repaymentLeg = await settleLeg({
  leg: 'repayment',
  invoiceId: reg.id,
  payerKey: cfg.borrowerKey,
  payee: lender.address,
  amount: face,
});
inv = await getInvoice(reg.id);
console.log(`    paymentId ${repaymentLeg.paymentId}`);
console.log(`    verified ACCEPT -> anchored ${anchorTxUrl(repaymentLeg.anchor.txHash)}`);
console.log(`    registry status: ${STATUS_LABELS[inv.status]}`);

// 6) compliance packet
const { packet, packetHash, json } = buildPacket({
  invoiceId: reg.id,
  invoice: inv,
  fields,
  risk,
  borrowerKycMode: bKyc.modeLabel!,
  lenderKycMode: lKyc.modeLabel!,
  registerTxHash: reg.txHash,
  legs: [fundingLeg, repaymentLeg],
});
const packetTx = await setPacketHash(reg.id, packetHash);
const outDir = resolve(repoRoot, 'packets');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, `tegata-${reg.id}.json`);
writeFileSync(outPath, JSON.stringify(packet, null, 2));
writeFileSync(resolve(outDir, 'sample-compliance-packet.json'), JSON.stringify(packet, null, 2));
console.log(`[6] compliance packet -> ${outPath}`);
console.log(`    packetHash ${packetHash} anchored: ${anchorTxUrl(packetTx)}`);
console.log(`    canonical bytes: ${json.length}`);

console.log('\n=== artifacts ===');
console.log(`Tegata id            ${reg.id}`);
console.log(`register tx          ${anchorTxUrl(reg.txHash)}`);
console.log(`funding paymentId    ${fundingLeg.paymentId}`);
console.log(`funding explorer     ${hspExplorerUrl(fundingLeg.paymentId)}`);
console.log(`funding anchor tx    ${anchorTxUrl(fundingLeg.anchor.txHash)}`);
console.log(`repayment paymentId  ${repaymentLeg.paymentId}`);
console.log(`repayment explorer   ${hspExplorerUrl(repaymentLeg.paymentId)}`);
console.log(`repayment anchor tx  ${anchorTxUrl(repaymentLeg.anchor.txHash)}`);
console.log(`packet hash          ${packetHash}`);
console.log(`final status         ${STATUS_LABELS[inv.status]}`);
