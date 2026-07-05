/**
 * Key-less browser-wallet payment relay, mirroring the official @hsp/mcp
 * prepare -> external-sign -> submit architecture:
 *
 *   prepare: build the UNSIGNED compliant mandate + the ERC-20 settlement tx
 *            in standard wallet-RPC shapes (eth_signTypedData_v4 /
 *            eth_sendTransaction). No key is held, nothing is signed here.
 *   submit:  verify the returned signature actually recovers to the payer,
 *            fetch compliance attestations for the payer from the issuer,
 *            register the mandate (Bearer key stays server-side), ask the
 *            Coordinator to observe the payer-broadcast settlement tx.
 *
 * The judge's wallet is the mandate signer AND the settling account —
 * exactly HSP's wallet-settling trust model.
 */
import {
  encodeAbiParameters,
  decodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  keccak256,
  recoverAddress,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { cfg } from './config.ts';
import { resolveChain, type ChainName } from './hsp.ts';
import { chainDomain } from '../../../hsp/packages/core/src/chains/index.ts';
import { requiredCapabilitiesHash } from '../../../hsp/packages/core/src/derivations.ts';
import { eip712EoaSigner } from '../../../hsp/packages/core/src/profiles/signer/eip712-eoa.ts';
import { mandateTypedData } from '../../../hsp/packages/sdk/src/signer.ts';
import { KYC_FULL, SANCTIONS } from '../../../hsp/packages/core/src/policy/compliance.ts';

const ERC20_TRANSFER = [
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

export const COMPLIANCE_CAP_IDS = [KYC_FULL.id, SANCTIONS.id] as Hex[];

function chain() {
  return resolveChain(cfg.hspChainName as ChainName);
}

export interface PreparedPayment {
  paymentId: Hex;
  mandateBody: Record<string, unknown>;
  requiredCapabilities: Hex[];
  toSign: [
    { id: 'mandate'; method: 'eth_signTypedData_v4'; params: { address: Address; typedData: unknown } },
    { id: 'settlement'; method: 'eth_sendTransaction'; params: { tx: Record<string, unknown> } },
  ];
}

export function preparePayment(p: { payer: Address; to: Address; amount: bigint }): PreparedPayment {
  const c = chain();
  const payer = getAddress(p.payer);
  const to = getAddress(p.to);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const body = {
    nonce: toHex(keccak256(toHex(`${payer}:${to}:${p.amount}:${deadline}`))).slice(0, 66) as Hex,
    signer: {
      profileId: eip712EoaSigner.profileIdHash,
      payload: encodeAbiParameters([{ type: 'address' }], [payer]),
    },
    recipient: { kind: 0, payload: encodeAbiParameters([{ type: 'address' }], [to]) },
    token: getAddress(c.stablecoin.address),
    amount: p.amount.toString(),
    chainId: c.chainId,
    deadline,
    requiredCapabilitiesHash: requiredCapabilitiesHash(COMPLIANCE_CAP_IDS),
  };
  const typedData = mandateTypedData(chainDomain(c), body as never);
  const paymentId = hashTypedData(typedData as Parameters<typeof hashTypedData>[0]);
  const data = encodeFunctionData({ abi: ERC20_TRANSFER, functionName: 'transfer', args: [to, p.amount] });
  return {
    paymentId,
    mandateBody: body as Record<string, unknown>,
    requiredCapabilities: COMPLIANCE_CAP_IDS,
    toSign: [
      { id: 'mandate', method: 'eth_signTypedData_v4', params: { address: payer, typedData } },
      {
        id: 'settlement',
        method: 'eth_sendTransaction',
        params: { tx: { from: payer, to: body.token, data, value: '0x0', chainId: c.chainId } },
      },
    ],
  };
}

function normalizeV(sig: Hex): Hex {
  const bytes = sig.slice(2);
  if (bytes.length !== 130) return sig;
  const v = parseInt(bytes.slice(128), 16);
  if (v === 0 || v === 1) return (`0x${bytes.slice(0, 128)}${(v + 27).toString(16)}`) as Hex;
  return sig;
}

async function fetchAttestationsFor(subject: Address) {
  const base = cfg.issuerUrl.replace(/\/$/, '');
  const out: unknown[] = [];
  for (const tag of ['kyc', 'sanctions'] as const) {
    const path = tag === 'sanctions' ? '/attest/sanctions' : '/attest/kyc';
    const body = tag === 'sanctions' ? { subject } : { subject, level: 'full' };
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`issuer ${tag} failed: HTTP ${res.status}`);
    out.push(((await res.json()) as { attestation: unknown }).attestation);
  }
  return out;
}

async function coordinator(method: string, path: string, body?: unknown) {
  const res = await fetch(`${cfg.coordinatorUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.apiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

export async function submitPayment(p: {
  paymentId: Hex;
  mandateBody: Record<string, unknown>;
  mandateSignature: Hex;
  txHash: Hex;
}): Promise<{ paymentId: Hex; status: string }> {
  const c = chain();
  // 1) tamper check: the body must reproduce the paymentId
  const typedData = mandateTypedData(chainDomain(c), p.mandateBody as never);
  const recomputed = hashTypedData(typedData as Parameters<typeof hashTypedData>[0]);
  if (recomputed.toLowerCase() !== p.paymentId.toLowerCase()) {
    throw new Error('mandateBody does not reproduce paymentId — refusing');
  }
  // 2) the signature must recover to the payer inside the mandate
  const payer = getAddress(
    decodeAbiParameters([{ type: 'address' }], (p.mandateBody as { signer: { payload: Hex } }).signer.payload)[0] as Address,
  );
  const sig = normalizeV(p.mandateSignature);
  const recovered = await recoverAddress({ hash: p.paymentId, signature: sig });
  if (getAddress(recovered) !== payer) {
    throw new Error(`mandate signature recovers to ${recovered}, expected payer ${payer}`);
  }
  // 3) register (write key stays here), with fresh compliance attestations
  const attestations = await fetchAttestationsFor(payer);
  const mandate = { body: p.mandateBody, signerProof: sig, requiredCapabilities: COMPLIANCE_CAP_IDS };
  const reg = await coordinator('POST', '/payments', { chain: c.name, mandate, attestations });
  if (reg.status !== 200 && reg.status !== 201) {
    throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.json)}`);
  }
  // 4) observe the payer-broadcast settlement (202 = still confirming, retry)
  for (let i = 0; i < 30; i++) {
    const obs = await coordinator('POST', `/payments/${p.paymentId}/observe`, { txHash: p.txHash });
    if (obs.status === 200) break;
    if (obs.status !== 202) throw new Error(`observe failed: ${obs.status} ${JSON.stringify(obs.json)}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  // 5) read back terminal status
  for (let i = 0; i < 30; i++) {
    const snap = await coordinator('GET', `/payments/${p.paymentId}`);
    const s = (snap.json as { status?: string })?.status ?? 'UNKNOWN';
    if (s === 'SETTLED' || s === 'FAILED' || s === 'DISPUTED') return { paymentId: p.paymentId, status: s };
    await new Promise((r) => setTimeout(r, 2000));
  }
  return { paymentId: p.paymentId, status: 'TIMEOUT' };
}
