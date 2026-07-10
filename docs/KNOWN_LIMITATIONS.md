# Known limitations (hackathon scope)

Honest boundaries of the current build, with the production path for each.

1. **USDC-denominated synthetic invoices only.** Real Japanese receivables are
   JPY-denominated; a JPY invoice → stablecoin settlement flow needs an FX
   quote/oracle or a JPY stablecoin integration with FX-attested settlement.
   The demo therefore uses synthetic USDC invoices and validates
   `currency === "USDC"` explicitly.

2. **Single demo attestor.** Evidence anchoring is signed by one disclosed
   demo key. Production: institutional or threshold attestors, multisig +
   timelock administration, on-chain rotation history.

3. **Sandbox compliance issuer.** KYC/sanctions attestations come from the
   HSP sandbox issuer. Production: licensed KYC/AML issuers plus the official
   HashKey KYC SBT (already the first-priority path in `KycGate`).

4. **Commercial terms enforced at the verifier/attestor boundary, not in
   Solidity.** See THREAT_MODEL.md ("Contract-layer honesty"). Roadmap:
   quoteHash in the registry and exact-amount checks in the contracts.

5. **Demo API has no wallet-session auth.** Faucet/KYC/repay endpoints are
   rate-limited and budget-capped but not bound to a signed wallet session.
   Production: challenge/response wallet sessions and per-address budgets.

6. **No flow resume after page refresh.** A judge who refreshes mid-settlement
   loses UI state (the settlement itself is safe; the lifecycle can be
   inspected under Invoices). Roadmap: localStorage checkpointing.

7. **LLM mode sends document text to the configured model provider.**
   Disclosed in the UI; demo documents are synthetic. Production: private/VPC
   models, field-level redaction, customer-held document custody.

8. **HSP is pre-1.0.** The SDK is consumed as a sibling clone pinned to
   commit `98afbb9a8b89b34ad55b6f97a416fab18f3128c6`
   (github.com/project-hsp/hsp). Wire details may change upstream; the pinned
   commit is the one this build and its packets were verified against.

9. **Invoice records are non-transferable registry entries, not tokens.**
   Deliberate: the prototype demonstrates compliant origination, settlement
   and evidence without implying a public securities market.
