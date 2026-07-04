# TEGATA Protocol

**HSP-verifiable invoice discounting for Japan's post-paper-tegata era.**

Japan is phasing out paper promissory notes (手形, *tegata*) and checks through policy and banking-infrastructure reform. SMEs still need the credit function behind tegata: delayed payment, receivables discounting, and trusted settlement. TEGATA Protocol rebuilds that workflow on [HashKey Chain](https://docs.hashkeychain.net/) — invoice records on-chain, KYC-gated counterparties, AI risk checks, and stablecoin settlement verified through [HSP](https://github.com/project-hsp/hsp) with offline-verifiable compliance packets.

> Every invoice-backed credit event produces a cryptographically verifiable HSP settlement packet.

Built for the HashKey Chain Horizon Hackathon · Japan 2026 (DeFi track).

## How it works

1. **Register** — a KYC-gated SME uploads an invoice; AI extracts fields and produces a risk report. Only hashes, amounts and dates go on-chain (`TegataRegistry`).
2. **Discount** — a KYC-gated lender funds the receivable **peer-to-peer** with an HSP compliant payment (`attests:kyc` + `attests:sanctions` capabilities).
3. **Verify** — the settlement is independently re-verified off-chain (`HSPVerifier`, pinned adapter address — *verify the settlement, not the promise*). A designated attestor signs the decision, which is anchored on-chain (`SettlementAnchor`) and advances the invoice lifecycle.
4. **Repay** — at maturity the repayment leg runs the same HSP → verify → anchor path.
5. **Audit** — one click exports a **compliance packet**: HSP mandate, receipt, attestations, verifier decision, KYC snapshot and chain anchors. Anyone can re-verify it offline.

## Repository layout

```
contracts/   Solidity (Foundry): KycGate, TegataRegistry, SettlementAnchor
server/      settlement verifier, attestor, compliance-packet builder, AI agents
app/         web app (English / 日本語)
docs/        architecture notes
```

## Contracts

| Contract | Purpose |
|---|---|
| `KycGate` | Dual-mode identity gate: official HashKey Chain KYC SBT first, disclosed demo-attestor fallback |
| `TegataRegistry` | Non-transferable registry of invoice-backed credit records with lifecycle status machine |
| `SettlementAnchor` | Anchors attestor-signed HSP verification results; ACCEPT decisions advance the registry |

Deployed addresses (HashKey Chain mainnet, chainId 177): _pending — see [Deployments](#deployments)._

## Development

```bash
cd contracts
forge build
forge test
```

Networks: HashKey Chain mainnet (177, `https://mainnet.hsk.xyz`) · testnet (133, `https://testnet.hsk.xyz`). HSP settlement legs run on the hackathon sandbox (hashkey-testnet USDC); their provenance (`settlementChainId`) is recorded explicitly in every anchor.

## Deployments

_To be published before submission._

## Disclaimer

Demo workflow only. Invoice records are non-transferable registry entries, not tokens, and nothing here constitutes a public offering of securities or financial services. Private documents never go on-chain — hashes only.
