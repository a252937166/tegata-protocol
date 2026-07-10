# TEGATA Protocol

**HSP-verifiable invoice discounting for Japan's post-paper-tegata era, on HashKey Chain.**

> Every invoice-backed credit event produces a cryptographically verifiable settlement packet — auditors re-verify it independently on their own machines, without trusting our servers.

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

**HashKey Chain Mainnet (chainId 177)** — LIVE, same bytecode and addresses as testnet ([deployments/hashkey-mainnet.json](deployments/hashkey-mainnet.json)):

| Contract | Address | |
|---|---|---|
| KycGate | `0xA36E8c13Ca1eF6493d9F57D74E1470fB3427Ee46` | [verified source](https://hsk.blockscout.com/address/0xA36E8c13Ca1eF6493d9F57D74E1470fB3427Ee46?tab=contract) |
| TegataRegistry | `0xE95D2E98955238F253436DFA7A057bbB1aBC3092` | [verified source](https://hsk.blockscout.com/address/0xE95D2E98955238F253436DFA7A057bbB1aBC3092?tab=contract) |
| SettlementAnchor | `0x4e4739b08593dDfB8C66Ad03808d11064f906042` | [verified source](https://hsk.blockscout.com/address/0x4e4739b08593dDfB8C66Ad03808d11064f906042?tab=contract) |

Mainnet proof anchors (the showcase packet's hashes, anchored on mainnet as invoice #3): [sample invoice register](https://hsk.blockscout.com/tx/0x861342da44c96392d0734f2847a7b31831b75d42facdda0bf89fb271ec0f89e1) · [packetHash](https://hsk.blockscout.com/tx/0x5f4545d00106e46641ec07f8b19d013b2b6d0de7f27be3f2cd5840cf39ca8efb). The live demo money flow runs on testnet funds by design — judges never spend real assets.

**Sample packet (a real lifecycle, LLM-underwritten, repaid — Tegata #20)** — [packets/sample-compliance-packet.json](packets/sample-compliance-packet.json):

- funding paymentId [`0x0f4505d9…`](https://hsp-hackathon.hashkeymerchant.com/explorer?id=0x0f4505d97003d5ec428821770ec9cc0d139ecf64fefba531ab0c39051736ac2c) · repayment paymentId [`0x9062a146…`](https://hsp-hackathon.hashkeymerchant.com/explorer?id=0x9062a146e398a5cda3f15d1f7acda0f59fd00e904d5b25110d645578f0e46c76) (HSP Explorer decision traces)
- on-chain anchors: [register](https://testnet-explorer.hsk.xyz/tx/0x620de462e2382476bebb004fbf92afa4163e02d46da049375d5968ac2c638004) · [funding](https://testnet-explorer.hsk.xyz/tx/0xd3a69d585659c52ec7824418494278991b3e0b6751b2576a6189c747626e7c2b) · [repayment](https://testnet-explorer.hsk.xyz/tx/0x1f915d3849bd36b427df095299bd48b8e8949f6b605720734915bc2320e7140c)
- financial semantics on display: issue date 2026-07-01 + NET-30 term → due **2026-07-31** (the term runs from the invoice's issue date, not from registration time)

## Independent local verification — don't trust us

```bash
git clone https://github.com/a252937166/tegata-protocol
git clone https://github.com/project-hsp/hsp        # SDK, side by side
git -C hsp checkout 98afbb9a8b89b34ad55b6f97a416fab18f3128c6   # the pinned pre-1.0 commit
cd tegata-protocol/server && npm install
npx tsx src/verify-packet.ts ../packets/sample-compliance-packet.json
```

Runs on your machine with **zero secrets**. Everything is re-derived from the packet's embedded evidence, public HSP data (Coordinator reads need no key) and public HashKey Chain state. The check list is a closed semantic loop — **36 checks for a full lifecycle**, in four layers:

1. **Structure** — strict runtime schema, leg cardinality vs lifecycle status, unique paymentIds
2. **Trust roots** — pinned adapter, pinned compliance issuer, pinned chain + token, published contract addresses
3. **Settlement (per leg)** — HSP verifier re-run, embedded-decision equality with a fresh run, attestations, **commercial terms** (amount + parties + token + chain vs the registered invoice), the **adapter-signed proof decoded and bound to the exact transfer** (from/to/token/amount/chain/tx), `evidenceHash`, the on-chain anchor compared **field by field**, and the `SettlementAnchored` event in the packet's anchor tx
4. **Lifecycle** — packetHash/invoiceHash/riskReportHash vs registry, status, face/dueDate/parties, strict paymentIds (no fallbacks), and the `InvoiceRegistered`/`InvoiceFunded` events incl. **historical KYC modes read from events, not current state**

The same module (`server/src/verification-core.ts`) backs the CLI, `/api/verify/:id`, and every PASS mark and hanko stamp on the website — the UI renders the latest real verification report (timestamped, with the block number), stale or errored reports downgrade to pending, and no verdict is hardcoded in page source. HSP SDK pinned to commit [`98afbb9`](https://github.com/project-hsp/hsp/commit/98afbb9a8b89b34ad55b6f97a416fab18f3128c6).

## Judge-flow rehearsal (what the live demo does, headless)

```bash
cd server
npx tsx src/test-judge-flow.ts                       # against a local API
npx tsx src/test-judge-flow.ts https://tegata.axiqo.xyz   # against production
```

A throwaway wallet claims funds, gets a demo KYC attestation, signs the EIP-712 mandate (after re-checking the typed-data digest equals the paymentId), broadcasts the settlement itself, and the pipeline settles → verifies → anchors → repays → re-verifies. `forge test` (27 tests) covers the contracts.

```bash
npx tsx src/test-negative.ts                         # commercial-terms binding (API)
npx tsx src/test-packet-negative.ts                  # doctored packets vs the verifier
```

Negative tests, both directions:
- **8 tampered mandates** (underpay, overpay, face-instead-of-discounted, wrong token, wrong chain, redirected payee, wrong-leg payer, unprepared paymentId) are each rejected with `409` **before** any signature or Coordinator work — the server recomputes the expected amount and parties from chain state + the underwriting record, and binds every prepared paymentId to its (invoice, leg).
- **10 doctored packets** (deleted/duplicated legs, duplicate paymentIds, smuggled leg kinds, inflated amounts, doctored decisions, rewritten chainIds, re-pointed settlement txs, swapped issuer pins, re-pointed invoices) each FAIL the specific check that guards the doctored property.

Trust boundary and honest scope: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) · [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md) · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## How it works

```
SME (borrower)                       protocol                             lender
   │  ① AI underwriting: parse + grade   │                                  │
   │  ② TegataRegistry: hashes only      │   ③ KycGate: SBT-first identity  │
   │ ───────────────────────────────────▶│ ◀──────────────────────────────  │
   │                                     │   ④ HSP compliant payment        │
   │  funds arrive, wallet-to-wallet     │      (mandate REQUIRES kyc +     │
   │ ◀───────────────────────────────────│       sanctions; issuer          │
   │                                     │       attestations satisfy)      │
   │                                     │   ⑤ independent verification     │
   │  ⑥ repayment leg at maturity        │      (pinned adapter + issuer)   │
   │ ───────────────────────────────────▶│   ⑦ attestor-signed anchor       │
   │                                     │   ⑧ compliance packet export     │
```

- **Zero custody.** The lender's wallet is the mandate signer *and* the settling account (HSP wallet-settling). No pool ever holds funds; our server holds an HSP write key, never user keys.
- **Two-layer compliance.** `KycGate` (official HashKey KYC SBT first, disclosed demo-attestor fallback) gates participation; HSP `attests:kyc` + `attests:sanctions` attestations prove compliance of every individual settlement.
- **Verify the settlement, not the promise.** The registry only advances on ACCEPT decisions produced by our *own* verifier run against out-of-band-pinned trust anchors — and anyone can reproduce that run from the packet.
- **AI-assisted underwriting with deterministic fallback.** An LLM parses the document and writes a graded risk report (see the sample packet, `engine: "llm"`); a rule engine guarantees reproducible runs when no model is configured. The prompt is constrained: no external credit data, no creditworthiness inferred from company names, discount quoted as an up-front rate on face value. Only hashes go on-chain.

### Trust boundary

| You can verify yourself | You currently trust | Production hardening |
|---|---|---|
| Every hash, signature and anchor in a packet (clean clone, zero secrets) | The demo attestor key that signs evidence | Multi-party attestors + slashing |
| HSP verifier decisions under **your** pinned adapter + issuer | The sandbox issuer's KYC/sanctions judgements | Licensed issuers + official HashKey KYC SBT (already integrated first-priority) |
| Settled amounts/parties vs registered commercial terms | The document store for invoice texts (chain holds hashes only) | Customer-held documents + selective disclosure |

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
