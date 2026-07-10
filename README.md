# TEGATA Protocol

**HSP-verifiable invoice discounting for Japan's post-paper-tegata era, on HashKey Chain.**

> Every invoice-backed credit event produces a cryptographically verifiable settlement packet — auditors re-verify it offline, without trusting our servers.

**Live demo: https://tegata.axiqo.xyz** · HashKey Chain Horizon Hackathon · Japan 2026 · **DeFi track (RWA / Lending / HSP)**

日本の紙の約束手形は政策により退場しつつあります。TEGATA はその信用機能 — 支払繰延・債権割引・信頼できる決済 — を、HashKey Chain 上の検証可能な金融インフラとして再構築します。

---

## For judges — three ways to check this project

| Path | What you see | Needs |
|---|---|---|
| **[Verified demo packet](https://tegata.axiqo.xyz/showcase)** | A real, repaid lifecycle: AI underwriting (LLM), both HSP settlement legs (ACCEPT), packet download, one-click re-verification | nothing |
| **[Live testnet demo](https://tegata.axiqo.xyz/live)** | You act as the lender: claim test funds, get a demo KYC attestation, sign a real HSP mandate (EIP-712) and settle from **your own wallet**, watch verification + anchoring, trigger repayment. Plus: issue your own invoice through the AI underwriter | any injected wallet, ~4 min |
| **[Deployment proof](https://tegata.axiqo.xyz/proof)** | Contracts with verified sources, pinned HSP trust config, sample-packet hash trail | nothing |

## Deployments

**HashKey Chain Testnet (chainId 133)** — the live demo environment ([deployments/hashkey-testnet.json](deployments/hashkey-testnet.json)):

| Contract | Address | |
|---|---|---|
| KycGate | `0xA36E8c13Ca1eF6493d9F57D74E1470fB3427Ee46` | [verified source](https://testnet-explorer.hsk.xyz/address/0xA36E8c13Ca1eF6493d9F57D74E1470fB3427Ee46?tab=contract) |
| TegataRegistry | `0xE95D2E98955238F253436DFA7A057bbB1aBC3092` | [verified source](https://testnet-explorer.hsk.xyz/address/0xE95D2E98955238F253436DFA7A057bbB1aBC3092?tab=contract) |
| SettlementAnchor | `0x4e4739b08593dDfB8C66Ad03808d11064f906042` | [verified source](https://testnet-explorer.hsk.xyz/address/0x4e4739b08593dDfB8C66Ad03808d11064f906042?tab=contract) |

**HashKey Chain Mainnet (chainId 177)** — same bytecode, one-command proof deployment via [`scripts/deploy-mainnet.sh`](scripts/deploy-mainnet.sh); addresses land in `deployments/hashkey-mainnet.json` and light up the [/proof](https://tegata.axiqo.xyz/proof) page automatically.

**Sample packet (a real lifecycle, LLM-underwritten, repaid — Tegata #15)** — [packets/sample-compliance-packet.json](packets/sample-compliance-packet.json):

- funding paymentId [`0xaea9050a…`](https://hsp-hackathon.hashkeymerchant.com/explorer?id=0xaea9050a5a30a56b9c4469590163c1c462a8e792bc56ae4971811f82c6e8920c) · repayment paymentId [`0xa3dbe67c…`](https://hsp-hackathon.hashkeymerchant.com/explorer?id=0xa3dbe67c3cf38348885b906f8b08a5030812fb954ef816126477262c7e71275b) (HSP Explorer decision traces)
- on-chain anchors: [register](https://testnet-explorer.hsk.xyz/tx/0x82a50778871859a3c031f0d87692ca3921062a8c059ea4af289cd073674bdedb) · [funding](https://testnet-explorer.hsk.xyz/tx/0x92629e2f6df049197fa4199009837c15901e34de854e7c6cdd1f6e95cc2b6f34) · [repayment](https://testnet-explorer.hsk.xyz/tx/0x389d9cfe3ed723ea079bf24c5491e6e362417476d61257f44ce5380c52d5b07c)

## Verify the packet offline — don't trust us

```bash
git clone https://github.com/a252937166/tegata-protocol
git clone https://github.com/project-hsp/hsp        # SDK, side by side
cd tegata-protocol/server && npm install
npx tsx src/verify-packet.ts ../packets/sample-compliance-packet.json
```

This re-runs the HSP verifier against the **pinned** adapter + compliance issuer, recomputes each leg's `evidenceHash`, checks the `SettlementAnchor` records on-chain, re-derives `riskReportHash` from the embedded report, and compares `packetHash` with `TegataRegistry` — 14 checks, all from primary sources.

## Judge-flow rehearsal (what the live demo does, headless)

```bash
cd server
npx tsx src/test-judge-flow.ts                       # against a local API
npx tsx src/test-judge-flow.ts https://tegata.axiqo.xyz   # against production
```

A throwaway wallet claims funds, gets a demo KYC attestation, signs the EIP-712 mandate (after re-checking the typed-data digest equals the paymentId), broadcasts the settlement itself, and the pipeline settles → verifies → anchors → repays → re-verifies. `forge test` (27 tests) covers the contracts.

## How it works

```
SME (borrower)                       protocol                             lender
   │  ① AI underwriting: parse + grade   │                                  │
   │  ② TegataRegistry: hashes only      │   ③ KycGate: SBT-first identity  │
   │ ───────────────────────────────────▶│ ◀──────────────────────────────  │
   │                                     │   ④ HSP compliant payment        │
   │  funds arrive, wallet-to-wallet     │      (kyc + sanctions signed     │
   │ ◀───────────────────────────────────│       into the mandate)          │
   │                                     │   ⑤ independent verification     │
   │  ⑥ repayment leg at maturity        │      (pinned adapter + issuer)   │
   │ ───────────────────────────────────▶│   ⑦ attestor-signed anchor       │
   │                                     │   ⑧ compliance packet export     │
```

- **Zero custody.** The lender's wallet is the mandate signer *and* the settling account (HSP wallet-settling). No pool ever holds funds; our server holds an HSP write key, never user keys.
- **Two-layer compliance.** `KycGate` (official HashKey KYC SBT first, disclosed demo-attestor fallback) gates participation; HSP `attests:kyc` + `attests:sanctions` attestations prove compliance of every individual settlement.
- **Verify the settlement, not the promise.** The registry only advances on ACCEPT decisions produced by our *own* verifier run against out-of-band-pinned trust anchors — and anyone can reproduce that run from the packet.
- **AI-assisted underwriting with deterministic fallback.** An LLM parses the document and writes a graded risk report (see the sample packet, `engine: "llm"`); a rule engine guarantees reproducible offline runs. Only hashes go on-chain.

## Repository layout

```
contracts/   Solidity (Foundry): KycGate, TegataRegistry, SettlementAnchor + 27 tests
server/      HSP relay (key-less browser-wallet flow), verifier, attestor,
             compliance packets, AI underwriting, judge-demo API, e2e drivers
app/         web app (English / 日本語, light/dark, wagmi)
deployments/ chain addresses + pinned HSP trust config
packets/     sample compliance packet (real artifacts)
scripts/     one-command mainnet proof deployment
```

## Development

```bash
cd contracts && forge build && forge test        # 27 tests
cd server && npm install && npm run api          # :4033 (needs .env — see below)
cd app && npm install && npm run dev             # :5173, proxies /api
```

`server/.env`: `HSP_API_KEY` (self-service at the sandbox `/register`), `BORROWER_PRIVATE_KEY` / `LENDER_PRIVATE_KEY` / `ATTESTOR_PRIVATE_KEY` (testnet demo wallets), optional `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` for the AI underwriter.

## Disclaimer

Demo workflow only. Invoice records are non-transferable registry entries, not tokens; nothing here constitutes a public offering of securities or financial services. Documents never go on-chain — hashes only. Demo attestations are clearly labelled and testnet-scoped.
