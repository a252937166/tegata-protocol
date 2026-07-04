import { privateKeyToAccount } from 'viem/accounts';
import { cfg } from './config.ts';
import type { SettlementEvidence } from './contracts.ts';

/**
 * The SettlementAttestor: signs the off-chain verifier's decision as EIP-712
 * typed data. The struct layout MUST match SettlementAnchor.EVIDENCE_TYPEHASH.
 */
const EVIDENCE_TYPES = {
  SettlementEvidence: [
    { name: 'invoiceId', type: 'uint256' },
    { name: 'leg', type: 'uint8' },
    { name: 'paymentId', type: 'bytes32' },
    { name: 'accepted', type: 'bool' },
    { name: 'evidenceHash', type: 'bytes32' },
    { name: 'settlementChainId', type: 'uint32' },
    { name: 'payer', type: 'address' },
    { name: 'payee', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'verifiedAt', type: 'uint64' },
  ],
} as const;

export const attestorAccount = privateKeyToAccount(cfg.attestorKey);

export async function signEvidence(ev: SettlementEvidence): Promise<`0x${string}`> {
  return attestorAccount.signTypedData({
    domain: {
      name: 'TegataSettlementAnchor',
      version: '1',
      chainId: cfg.anchorChainId,
      verifyingContract: cfg.contracts.SettlementAnchor,
    },
    types: EVIDENCE_TYPES,
    primaryType: 'SettlementEvidence',
    message: {
      invoiceId: ev.invoiceId,
      leg: ev.leg,
      paymentId: ev.paymentId,
      accepted: ev.accepted,
      evidenceHash: ev.evidenceHash,
      settlementChainId: ev.settlementChainId,
      payer: ev.payer,
      payee: ev.payee,
      amount: ev.amount,
      verifiedAt: ev.verifiedAt,
    },
  });
}
