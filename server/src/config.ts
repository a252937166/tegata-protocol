import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, '..', '..');

/** Minimal .env loader (repo root), no external dependency. Existing env wins. */
function loadDotEnv() {
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

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
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

const mainnetPath = resolve(repoRoot, 'deployments', 'hashkey-mainnet.json');
/** Present once the mainnet proof deployment has run (scripts/deploy-mainnet.sh). */
export const mainnetDeployment: MainnetDeployment | null = existsSync(mainnetPath)
  ? (JSON.parse(readFileSync(mainnetPath, 'utf8')) as MainnetDeployment)
  : null;

const deployment = JSON.parse(
  readFileSync(resolve(repoRoot, 'deployments', 'hashkey-testnet.json'), 'utf8'),
) as {
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
};

export const cfg = {
  // HSP sandbox
  coordinatorUrl: process.env.HSP_COORDINATOR_URL ?? deployment.hsp.coordinatorUrl,
  issuerUrl: process.env.HSP_ISSUER_URL ?? `${deployment.hsp.coordinatorUrl}/issuer`,
  apiKey: req('HSP_API_KEY'),
  hspChainName: deployment.hsp.chain,
  /**
   * Adapter observation address, pinned OUT-OF-BAND (GET /chains at integration
   * time, then hardcoded in deployments/). Never re-fetched at runtime — that
   * would defeat independent verification.
   */
  pinnedAdapterAddress: deployment.hsp.pinnedAdapterAddress,
  /** Trusted compliance issuer (mock issuer of this sandbox), pinned like the adapter. */
  pinnedIssuerAddress: deployment.hsp.pinnedIssuerAddress,
  stablecoin: deployment.hsp.stablecoin,

  // anchor chain (where our contracts live)
  anchorChainId: deployment.chainId,
  anchorRpc: process.env.ANCHOR_RPC ?? deployment.rpc,
  anchorExplorer: deployment.explorer,
  deployBlock: BigInt(deployment.deployBlock),
  contracts: deployment.contracts,

  // demo wallets (testnet-only; small faucet amounts)
  borrowerKey: req('BORROWER_PRIVATE_KEY') as `0x${string}`,
  lenderKey: req('LENDER_PRIVATE_KEY') as `0x${string}`,
  attestorKey: req('ATTESTOR_PRIVATE_KEY') as `0x${string}`,

  // LLM underwriting backend (vendor-neutral; deterministic fallback when unset)
  llm: {
    baseUrl: process.env.LLM_BASE_URL ?? '',
    apiKey: process.env.LLM_API_KEY ?? '',
    model: process.env.LLM_MODEL ?? '',
  },
} as const;

export const hspExplorerUrl = (paymentId: string) =>
  `${cfg.coordinatorUrl}/explorer?id=${paymentId}`;
export const anchorTxUrl = (tx: string) => `${cfg.anchorExplorer}/tx/${tx}`;
