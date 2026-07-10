import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseAbiItem } from 'viem';
import { cfg, repoRoot, hspExplorerUrl } from './config.ts';
import { getInvoice, publicClient } from './contracts.ts';
import { fetchPaymentSnapshot, verifyIndependently } from './hsp.ts';
import { keccakOfJson } from './canonical.ts';
import { getDoc } from './docstore.ts';
import { setPacketHash } from './contracts.ts';
import { buildPacket, type SettlementLegPacket, type CompliancePacket } from './packet.ts';

const ANCHORED_EVENT = parseAbiItem(
  'event SettlementAnchored(bytes32 indexed paymentId, uint256 indexed invoiceId, uint8 leg, bool accepted, bytes32 evidenceHash, uint32 settlementChainId)',
);
const REGISTERED_EVENT = parseAbiItem(
  'event InvoiceRegistered(uint256 indexed id, address indexed borrower, bytes32 invoiceHash, uint256 faceAmount, uint64 dueDate, bytes32 riskReportHash, uint8 kycMode)',
);
const FUNDED_EVENT = parseAbiItem(
  'event InvoiceFunded(uint256 indexed id, address indexed lender, uint256 discountedAmount, bytes32 paymentId, uint8 lenderKycMode)',
);
const KYC_MODE_LABELS = ['none', 'official-sbt', 'demo-attestor'] as const;

async function findAnchorTx(paymentId: `0x${string}`): Promise<string> {
  const logs = await publicClient.getLogs({
    address: cfg.contracts.SettlementAnchor,
    event: ANCHORED_EVENT,
    args: { paymentId },
    fromBlock: cfg.deployBlock,
  });
  return logs[0]?.transactionHash ?? '';
}

async function findRegisterTx(invoiceId: bigint): Promise<string> {
  const logs = await publicClient.getLogs({
    address: cfg.contracts.TegataRegistry,
    event: REGISTERED_EVENT,
    args: { id: invoiceId },
    fromBlock: cfg.deployBlock,
  });
  return logs[0]?.transactionHash ?? '';
}

async function legFromChain(
  leg: 'funding' | 'repayment',
  paymentId: `0x${string}`,
): Promise<SettlementLegPacket> {
  const snapshot = await fetchPaymentSnapshot(paymentId);
  const { decision, receipt } = await verifyIndependently(snapshot);
  const evidenceHash = keccakOfJson({
    mandate: snapshot.mandate,
    receipt,
    attestations: snapshot.attestations ?? [],
    decision,
  });
  return {
    leg,
    paymentId,
    settlementChain: { name: cfg.hspChainName, chainId: (snapshot.mandate.body as { chainId: number }).chainId },
    mandate: snapshot.mandate,
    receipt,
    attestations: snapshot.attestations ?? [],
    verifierDecision: decision,
    evidenceHash,
    anchor: {
      chainId: cfg.anchorChainId,
      txHash: await findAnchorTx(paymentId),
      contract: cfg.contracts.SettlementAnchor,
    },
    hspExplorerUrl: hspExplorerUrl(paymentId),
  };
}

const ZERO32 = `0x${'0'.repeat(64)}` as const;

/**
 * Rebuild the compliance packet for any invoice from primary sources: chain
 * state, the Coordinator's stored triples (re-verified locally), and the
 * off-chain document store. Optionally re-anchors the packet hash.
 */
export async function buildPacketForInvoice(
  invoiceId: bigint,
  opts: { anchorHash?: boolean } = {},
): Promise<{ packet: CompliancePacket; packetHash: `0x${string}` }> {
  const invoice = await getInvoice(invoiceId);
  const doc = getDoc(invoice.invoiceHash);
  if (!doc) throw new Error(`no document record for invoice ${invoiceId}`);

  const legs: SettlementLegPacket[] = [];
  if (invoice.fundingPaymentId !== ZERO32) legs.push(await legFromChain('funding', invoice.fundingPaymentId));
  if (invoice.repaymentPaymentId !== ZERO32) legs.push(await legFromChain('repayment', invoice.repaymentPaymentId));

  // KYC modes are HISTORICAL facts — read them from the events emitted at
  // registration/funding time, never from current gate state (an attestation
  // revoked or upgraded later must not change a rebuilt packet's hash)
  const [regLogs, fundLogs] = await Promise.all([
    publicClient.getLogs({
      address: cfg.contracts.TegataRegistry,
      event: REGISTERED_EVENT,
      args: { id: invoiceId },
      fromBlock: cfg.deployBlock,
    }),
    publicClient.getLogs({
      address: cfg.contracts.TegataRegistry,
      event: FUNDED_EVENT,
      args: { id: invoiceId },
      fromBlock: cfg.deployBlock,
    }),
  ]);
  const borrowerKycMode = KYC_MODE_LABELS[regLogs[0]?.args.kycMode ?? 0];
  const lenderKycMode = KYC_MODE_LABELS[fundLogs[0]?.args.lenderKycMode ?? 0];

  const { packet, packetHash } = buildPacket({
    invoiceId,
    invoice,
    fields: doc.fields,
    risk: doc.risk,
    borrowerKycMode,
    lenderKycMode,
    registerTxHash: regLogs[0]?.transactionHash ?? (await findRegisterTx(invoiceId)),
    legs,
  });

  if (opts.anchorHash && invoice.packetHash !== packetHash) {
    await setPacketHash(invoiceId, packetHash);
  }

  const outDir = resolve(repoRoot, 'packets');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, `tegata-${invoiceId}.json`), JSON.stringify(packet, null, 2));
  return { packet, packetHash };
}
