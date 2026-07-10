# Architecture

## Three layers

```
HSP                     verifies the settlement itself + per-payment compliance
                        (mandate requires kyc/sanctions capabilities; pinned
                        issuer attestations satisfy them; pinned adapter signs
                        the receipt; HSPVerifier decides ACCEPT/REJECT)

TEGATA policy           verifies that THIS settlement satisfies THIS invoice's
                        commercial terms (discounted advance / face repayment,
                        right parties, right token, right chain), binds every
                        prepared paymentId to (invoice, leg), and packages
                        everything into a compliance packet

HashKey Chain           anchors the invoice lifecycle, paymentIds and
                        packetHash (TegataRegistry + SettlementAnchor), gates
                        participants (KycGate: official KYC SBT first)
```

## Two rails, one credit event

```
BUSINESS RAIL   Invoice -> AI quote -> wallet-settled USDC -> repayment
EVIDENCE RAIL   invoiceHash+riskHash -> HSP mandate -> receipt->ACCEPT -> anchor+packet
```

Money moves wallet-to-wallet (HSP wallet-settling: the mandate signer IS the
settling account; no pool, no custody). Evidence accumulates in parallel and
ends in a self-contained compliance packet that any third party re-verifies
with zero secrets.

## Module map

```
contracts/src/KycGate.sol            official KYC SBT first, disclosed demo-attestor fallback
contracts/src/TegataRegistry.sol     non-transferable invoice lifecycle records
contracts/src/SettlementAnchor.sol   EIP-712 attestor-signed settlement evidence

server/src/verification-core.ts      THE check list (structure/trust roots/legs/lifecycle)
server/src/verify-packet.ts          auditor CLI over the core (zero env)
server/src/api.ts                    judge-demo API; commercial-terms binding on submit
server/src/hsp-relay.ts              key-less browser-wallet prepare/submit (random nonces)
server/src/hsp.ts                    pinned-trust HSPVerifier bridge (sibling SDK clone)
server/src/settle.ts                 verify -> attestor-sign -> anchor (shared by all paths)
server/src/packet.ts                 packet structure + deterministic hash projection
server/src/packet-service.ts         rebuild packets from primary sources (events for history)
server/src/ai.ts                     LLM underwriting w/ deterministic fallback + validation
server/src/test-negative.ts          8 tampered mandates -> all rejected pre-signature
server/src/test-packet-negative.ts   10 doctored packets -> each caught by its guard
server/src/test-judge-flow.ts        headless rehearsal of the full browser judge flow

app/                                 React/wagmi UI (EN/JA); every PASS mark renders the
                                     live verification report — nothing is asserted in page source
```

## Determinism and the packet hash

`packetHash` is computed over a deterministic projection of the packet:
`generatedAt` and each leg's outer `settlementTxHash` are excluded (the tx is
independently proven by decoding the adapter-signed receipt proof, which IS
hash-covered). Rebuilding a packet from primary sources reproduces the same
hash; historical facts (e.g. KYC modes) come from emitted events, never from
current state.
