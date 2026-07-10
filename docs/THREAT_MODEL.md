# Threat model

What an attacker (or a failing dependency) can and cannot do to TEGATA, and
where each defense lives. "Verifier" below always means the shared
verification core (`server/src/verification-core.ts`) that backs the auditor
CLI, `/api/verify/:id` and every mark on the website.

## Actors and trust

| Actor | Trusted with | If it lies / is compromised |
|---|---|---|
| HSP Coordinator | transport + storage of mandates/receipts/attestations | Its "paid" status is **never** trusted. The verifier re-runs HSPVerifier over the raw triple under OUR pinned adapter + issuer. A coordinator that fabricates status cannot fabricate the adapter's signature. |
| HSP Adapter (pinned) | observing settlement txs and signing receipts | Receipts are checked against the pinned adapter address. The adapter-signed proof is decoded and every field (from/to/token/amount/chain/tx) is cross-checked against the mandate and the invoice's terms. A different adapter's receipt fails the pin. |
| Compliance issuer (pinned) | KYC/sanctions judgements | Attestations signed by any other issuer fail the capability check → REJECT. A compromised pinned issuer could attest a bad actor — that is a disclosed trust assumption of the sandbox; production uses licensed issuers + the official HashKey KYC SBT (already integrated first-priority in `KycGate`). |
| TEGATA attestor key | signing verified evidence into `SettlementAnchor` | The single demo attestor is a disclosed trust edge. The contract authenticates the DESIGNATED attestor, not the truth of the evidence: a compromised attestor can anchor a false struct, but the independent verification core detects that it does not match the raw HSP evidence and the invoice's terms. Production path: threshold/institutional attestors, multisig + timelock admin. |
| TEGATA backend | preparing mandates, relaying to the coordinator, holding the HSP write key | Holds **no user keys and no funds**. A malicious backend could refuse service, but cannot move user money (wallet-settling) and cannot fake a packet that survives independent verification. |
| Browser client | UX only | Fully untrusted. See "modified client" below. |
| Registry/Anchor owner key | `setPacketHash`, attestor rotation | Can overwrite a packet hash — but anyone re-running the verifier against the published packet detects the mismatch. Production: multisig + timelock, append-only packet-hash history. |

## Attacks and outcomes

**Modified client underpays / overpays / pays the wrong party / wrong token / wrong chain.**
`/api/hsp/submit` recomputes the expected amount and parties from chain state +
the underwriting record and rejects mismatches with 409 before any signature
or coordinator work (`test-negative.ts`, 8 cases). Even if the backend were
bypassed entirely, the settlement could not advance the registry: only the
attestor can anchor, and the verifier layer re-checks commercial terms.

**Same paymentId replayed against another invoice.**
Every prepared paymentId is bound server-side to (invoice, leg); submitting it
for anything else is rejected (`unknown-payment`). On-chain, `SettlementAnchor`
rejects double-anchoring a paymentId. Mandate nonces are 32 random bytes.

**Packet omits or duplicates a leg / embeds a doctored decision / points at a
different tx.** The verifier enforces leg cardinality against lifecycle
status, unique paymentIds, decision equality with a fresh verifier run, and
decodes the adapter-signed proof to bind the exact settlement tx
(`test-packet-negative.ts`, 10 doctored packets, each caught by its guard).

**Coordinator/RPC outage during a demo.** `/api/readiness` reports component
state; the UI shows it and points judges to the pre-verified showcase, whose
packet can still be verified locally by anyone (needs only public RPC reads).
A stale verification cache is downgraded in the UI — old PASS marks are never
presented as live.

**Fake invoice / debtor default.** Out of scope by design: TEGATA proves
settlement and compliance integrity, not commercial authenticity of the
underlying receivable (production: issuer attestations from ERP/e-invoice
networks) and does not guarantee debtor performance — the lender bears credit
risk.

**Document leakage.** Documents never go on-chain (hashes only). In LLM mode
the text is sent to the configured model provider — the demo uses synthetic
documents and the UI says so. Production: private/VPC model, redaction,
customer-held documents with selective disclosure.

## Contract-layer honesty

The current prototype enforces commercial policy at the independently
reproducible verifier/attestor boundary; the contracts anchor accepted
evidence and lifecycle. `markFunded` bounds but does not equal-match amounts;
`markRepaid` takes no amount; owner can rotate attestor and overwrite
packetHash. This is deliberate scope for a hackathon prototype and is
detectable by any party re-running the verifier. Production roadmap: registry
stores quoted amounts (quoteHash), exact-amount checks in `markFunded`/
`markRepaid`, append-only packet-hash history, multisig + timelock owner,
threshold attestor registry.
