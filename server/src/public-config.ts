/**
 * Public configuration — everything an INDEPENDENT VERIFIER needs and nothing
 * more: chain parameters, contract addresses and the out-of-band-pinned HSP
 * trust anchors, all read from the committed deployments/ files.
 *
 * No environment variables are required. No secrets exist here. The offline
 * packet verifier (verify-packet.ts) and every read-only code path depend on
 * THIS module only, so `git clone && npm install && npx tsx src/verify-packet.ts`
 * works with no setup — that is the point of the packet.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..');

/** Optional .env loader (repo root). Existing env wins; absence is fine. */
export function loadDotEnv() {
  const p = resolve(repoRoot, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, k, raw] = m;
    if (process.env[k] === undefined) process.env[k] = raw.replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

interface TestnetDeployment {
  chainId: number;
  rpc: string;
  explorer: string;
  deployBlock: number;
  contracts: { KycGate: `0x${string}`; TegataRegistry: `0x${string}`; SettlementAnchor: `0x${string}` };
  attestor: `0x${string}`;
  hsp: {
    chain: string;
    coordinatorUrl: string;
    stablecoin: `0x${string}`;
    pinnedAdapterAddress: `0x${string}`;
    pinnedIssuerAddress: `0x${string}`;
  };
}

export interface MainnetDeployment {
  chainId: number;
  rpc: string;
  explorer: string;
  contracts: { KycGate: `0x${string}`; TegataRegistry: `0x${string}`; SettlementAnchor: `0x${string}` };
  proof?: {
    sampleInvoiceId?: string;
    registerTxHash?: string;
    packetAnchorTxHash?: string;
    invoiceHash?: string;
    packetHash?: string;
  };
}

const deployment = JSON.parse(
  readFileSync(resolve(repoRoot, 'deployments', 'hashkey-testnet.json'), 'utf8'),
) as TestnetDeployment;

const mainnetPath = resolve(repoRoot, 'deployments', 'hashkey-mainnet.json');
/** Present once the mainnet proof deployment has run (scripts/deploy-mainnet.sh). */
export const mainnetDeployment: MainnetDeployment | null = existsSync(mainnetPath)
  ? (JSON.parse(readFileSync(mainnetPath, 'utf8')) as MainnetDeployment)
  : null;

export const publicCfg = {
  // HSP sandbox (public reads need no key)
  coordinatorUrl: process.env.HSP_COORDINATOR_URL ?? deployment.hsp.coordinatorUrl,
  issuerUrl: process.env.HSP_ISSUER_URL ?? `${deployment.hsp.coordinatorUrl}/issuer`,
  hspChainName: deployment.hsp.chain,
  /**
   * Adapter observation address and compliance issuer, pinned OUT-OF-BAND at
   * integration time and hardcoded in deployments/. Never re-fetched at
   * runtime — that would defeat independent verification.
   */
  pinnedAdapterAddress: deployment.hsp.pinnedAdapterAddress,
  pinnedIssuerAddress: deployment.hsp.pinnedIssuerAddress,
  stablecoin: deployment.hsp.stablecoin,

  // anchor chain (where our contracts live)
  anchorChainId: deployment.chainId,
  anchorRpc: process.env.ANCHOR_RPC ?? deployment.rpc,
  anchorExplorer: deployment.explorer,
  deployBlock: BigInt(deployment.deployBlock),
  contracts: deployment.contracts,
} as const;

export const hspExplorerUrl = (paymentId: string) => `${publicCfg.coordinatorUrl}/explorer?id=${paymentId}`;
export const anchorTxUrl = (tx: string) => `${publicCfg.anchorExplorer}/tx/${tx}`;
