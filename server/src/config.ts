/**
 * Operator configuration = public config + SECRETS. Only server-side actors
 * (the API, settlement pipeline, e2e drivers) import this module; read-only /
 * verifier code paths import public-config.ts and need no environment at all.
 */
import { publicCfg, repoRoot, hspExplorerUrl, anchorTxUrl, mainnetDeployment } from './public-config.ts';

export { repoRoot, hspExplorerUrl, anchorTxUrl, mainnetDeployment };
export type { MainnetDeployment } from './public-config.ts';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env: ${name}`);
  return v;
}

export const cfg = {
  ...publicCfg,

  // write access to the Coordinator (Bearer key — never shipped to browsers)
  apiKey: req('HSP_API_KEY'),

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
