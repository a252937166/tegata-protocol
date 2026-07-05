/**
 * Bridge to the HSP SDK, which is distributed as a sibling repository for the
 * hackathon (not on npm): `git clone https://github.com/project-hsp/hsp` next
 * to this repo. All HSP imports go through this module so the path lives in
 * one place.
 */
export { HSPClient, HSPVerifier } from '../../../hsp/packages/sdk/src/index.ts';
export { resolveChain } from '../../../hsp/packages/core/src/chains/index.ts';
export type { ChainName } from '../../../hsp/packages/core/src/chains/index.ts';

import type { Address } from 'viem';
import { HSPVerifier } from '../../../hsp/packages/sdk/src/index.ts';
import { resolveChain, type ChainName } from '../../../hsp/packages/core/src/chains/index.ts';
import { KYC_FULL, SANCTIONS } from '../../../hsp/packages/core/src/policy/compliance.ts';
import { publicCfg as cfg } from './public-config.ts';

export interface PaymentSnapshot {
  paymentId: `0x${string}`;
  chain: string;
  status: string;
  mandate: any;
  receipts: { receipt: any }[];
  attestations?: any[];
  lastDecision?: any;
}

/** Fetch the (mandate, receipt, attestations) triple — public read, no key. */
export async function fetchPaymentSnapshot(paymentId: string): Promise<PaymentSnapshot> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${cfg.coordinatorUrl}/payments/${paymentId}`, {
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`GET /payments/${paymentId} -> ${res.status}`);
      return (await res.json()) as PaymentSnapshot;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

/**
 * Independent verification with a fully pinned trust config — the relying-party
 * step. ACCEPT here never depends on trusting the Coordinator's own status:
 * both the adapter observation address and the trusted compliance issuer are
 * pinned out-of-band, and the policy floor requires kyc + sanctions on every
 * payment we rely on.
 */
export async function verifyIndependently(snapshot: PaymentSnapshot) {
  if (!snapshot.receipts?.length) throw new Error('no admitted receipts yet');
  const chain = resolveChain(cfg.hspChainName as ChainName);
  const verifier = new HSPVerifier({
    chain,
    adapterAddress: cfg.pinnedAdapterAddress as Address,
    compliance: {
      trustedIssuers: [
        { family: 'attests:kyc:v1', issuerAddress: cfg.pinnedIssuerAddress as Address },
        { family: 'attests:sanctions:v1', issuerAddress: cfg.pinnedIssuerAddress as Address },
      ],
      policyRequiredCaps: [KYC_FULL, SANCTIONS],
    },
  });
  const receipt = snapshot.receipts[snapshot.receipts.length - 1]!.receipt;
  const decision = await verifier.verify(snapshot.mandate, receipt, snapshot.attestations ?? []);
  return { decision, receipt };
}

/** Decode a 32-byte-padded EVM address payload (mandate signer/recipient). */
export function payloadToAddress(payload: string): `0x${string}` {
  return (`0x${payload.slice(-40)}`) as `0x${string}`;
}
