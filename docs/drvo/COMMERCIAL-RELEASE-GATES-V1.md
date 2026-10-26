# DRVO ERP — Commercial release preparation & future sales gates

**Date:** 2026-10-26  
**State:** Draft PR; **NO CUSTOMER SALES ENABLED**. Stacked on Quote Lab PR #154.

## What was implemented

- Migration **020**: additive `ModularCommercialReleaseCandidate` with unique FK to reviewed tariff research (`ModularTariffResearchProposal`), SHA-256 source digest, immutable `pending_policy` state and actor/timestamp. No prices seeded, no existing tenant/catalog/subscription/finance rows mutated.
- Operator-only `GET/POST /api/admin/platform/commercial-release-candidates`: request can contain **only `sourceProposalId`**. The server loads independently reviewed research, constructs an immutable release dossier, revalidates complete research app prices and monetary bounds, then re-checks the source digest on every list/detail serialization, and rejects changed sources or unsupported industries. Idempotent repeat returns the same candidate.
- Operator UX `/platform/commercial-release`: select a reviewed Salon research version and view 10 explicit blockers. No button to publish, pay, activate, or issue a customer quote.
- Future **pure, disconnected contract checks**: quote must match tenant, be issued and unexpired before potential acceptance; a payment intent or unverified/corrupt/duplicate settlement cannot qualify for activation. Passing checks **does not create an order, charge money, or activate**.

## Deliberately not authorized

- No final app prices or fee approval, model approval, yearly discount, branch quotas, tax classification, trial/free and usage tariffs, refund or proration terms, legal acceptance wording, gateway reconciliation, end-to-end staging verification.
- `reviewed_research` is **not** `approved_for_sale`. Neither a reviewed tariff research proposal, Quote Lab simulation nor candidate digest automatically changes `dbo.ModularPriceCatalog.Status` to `approved`.
- No `quoted/accepted/paid/active` SQL states are created here. No customer-facing priced quote, order, invoice, gateway API or entitlement change is wired into this PR. Checkout/activation remain absent, not just visually hidden.
- `CASHER_BOOT` and existing invoices, booking, shift close, payroll and core accounting remain unchanged.

## Future release sequence (separate reviewed PRs)

1. Approve actual monetary and policy decisions in `docs/drvo/BUSINESS-MODEL-V2.md`, then implement a **distinct, audit-controlled** operator release process for immutable versioned public price catalogs, subject to explicit go-live flag and stage verification.
2. Issue customer quote from **approved** catalog and server-owned tenant app selection with deterministic integer minor-unit totals, policy/tax breakdown, digest and explicit expiry.
3. Customer explicitly accepts an unexpired quote (check tenant, issuer, digest, state, expiry) before creating an idempotent Order.
4. Create a payment intent for that Order, match amount/currency/order against provider webhook signatures, idempotency and the finance ledger; never trust redirect/browser claims alone.
5. Activate app entitlements only after authoritative reconciled settlement, with audit, rollback, notification and cross-tenant regression.

## Deployment / QA

- **Do not merge** while PR #154 is pending staging and this change is a Draft PR.
- Migration 020 must run on Staging after migrations 015–019, with manifest checksum verification and isolation tests.
- Test both identities (regular tenant admin must not see operator research), duplicate preparation, source tampering, independent review, quote expiry, payment mismatches and tenant financial regression.
- GitHub CI is mandatory but does **not** replace staging E2E.
