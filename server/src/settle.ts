import type { Address } from 'viem';
import { cfg, hspExplorerUrl } from './config.ts';
import { HSPClient, resolveChain, type ChainName } from './hsp.ts';
import { fetchPaymentSnapshot, verifyIndependently, payloadToAddress } from './hsp.ts';
import { keccakOfJson } from './canonical.ts';
import { anchorSettlement, type SettlementEvidence } from './contracts.ts';
import { signEvidence } from './attestor.ts';
import type { SettlementLegPacket } from './packet.ts';

/**
 * One settlement leg, end to end:
 *   HSP compliant pay() from the payer wallet
 *   -> independent verification (pinned adapter)
 *   -> attestor-signed evidence
 *   -> on-chain anchor (advances the registry lifecycle on ACCEPT)
 */
export async function settleLeg(params: {
  leg: 'funding' | 'repayment';
  invoiceId: bigint;
  payerKey: `0x${string}`;
  payee: Address;
  amount: bigint;
}): Promise<SettlementLegPacket> {
  const chain = resolveChain(cfg.hspChainName as ChainName);
  const client = new HSPClient({
    coordinatorUrl: cfg.coordinatorUrl,
    apiKey: cfg.apiKey,
    signer: { kind: 'privateKey', privateKey: params.payerKey },
    chain,
    issuerUrl: cfg.issuerUrl,
  });

  // 1) pay — compliance capabilities signed into the mandate's required set
  const handle = await client.pay({
    to: params.payee,
    amount: params.amount,
    profile: { compliance: ['kyc', 'sanctions'] },
  });
  const settled = await handle.awaitSettled({ timeoutMs: 180_000 });
  if (settled.status !== 'SETTLED') {
    throw new Error(`${params.leg} leg not settled: ${settled.status} ${settled.lastDecision?.errorCode ?? ''}`);
  }

  return verifyAndAnchor({
    leg: params.leg,
    invoiceId: params.invoiceId,
    paymentId: handle.paymentId as `0x${string}`,
    expectedPayee: params.payee,
    expectedAmount: params.amount,
    settlementTxHash: handle.txHash,
  });
}

/**
 * The relying-party half, shared by the server-key path (settleLeg) and the
 * browser-wallet relay: independent verification -> attestor-signed evidence
 * -> on-chain anchor. Works for any settled paymentId.
 */
export async function verifyAndAnchor(params: {
  leg: 'funding' | 'repayment';
  invoiceId: bigint;
  paymentId: `0x${string}`;
  expectedPayee: Address;
  expectedAmount: bigint;
  settlementTxHash?: string;
}): Promise<SettlementLegPacket> {
  // independent verification — never trust the Coordinator's own "paid" flag
  const snapshot = await fetchPaymentSnapshot(params.paymentId);
  const { decision, receipt } = await verifyIndependently(snapshot);
  const accepted = Boolean((decision as { ok?: boolean }).ok) &&
    (decision as { outcomeClass?: string }).outcomeClass === 'ACCEPT';
  if (!accepted) {
    throw new Error(`${params.leg} leg verification failed: ${JSON.stringify(decision)}`);
  }

  // integrity cross-checks: what we verified is what we meant to pay
  const mandateBody = snapshot.mandate.body as {
    signer: { payload: string };
    recipient: { payload: string };
    amount: string;
    chainId: number;
  };
  const payer = payloadToAddress(mandateBody.signer.payload);
  const payee = payloadToAddress(mandateBody.recipient.payload);
  if (payee.toLowerCase() !== params.expectedPayee.toLowerCase()) throw new Error('payee mismatch');
  if (BigInt(mandateBody.amount) !== params.expectedAmount) throw new Error('amount mismatch');

  // attestor-signed evidence + on-chain anchor
  const evidenceHash = keccakOfJson({
    mandate: snapshot.mandate,
    receipt,
    attestations: snapshot.attestations ?? [],
    decision,
  });
  const evidence: SettlementEvidence = {
    invoiceId: params.invoiceId,
    leg: params.leg === 'funding' ? 0 : 1,
    paymentId: params.paymentId,
    accepted,
    evidenceHash,
    settlementChainId: mandateBody.chainId,
    payer,
    payee,
    amount: params.expectedAmount,
    verifiedAt: BigInt(Math.floor(Date.now() / 1000)),
  };
  const signature = await signEvidence(evidence);
  const anchorTx = await anchorSettlement(evidence, signature);

  return {
    leg: params.leg,
    paymentId: params.paymentId,
    settlementChain: { name: cfg.hspChainName, chainId: mandateBody.chainId },
    settlementTxHash: params.settlementTxHash,
    mandate: snapshot.mandate,
    receipt,
    attestations: snapshot.attestations ?? [],
    verifierDecision: decision,
    evidenceHash,
    anchor: { chainId: cfg.anchorChainId, txHash: anchorTx, contract: cfg.contracts.SettlementAnchor },
    hspExplorerUrl: hspExplorerUrl(params.paymentId),
  };
}
