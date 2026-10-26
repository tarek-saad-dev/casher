# DRVO ERP — Operator Review of Modular Quote Inquiries (V1)

> 2026-10-26 · **Manual follow-up only** · Does not produce a priced quote, order, invoice, activation or payment.

## Why now
Tenant `/admin/billing` already lets users submit **unpriced inquiries** (Migration 017). Those requests need a traceable operator-side follow-up path **before** any commercial tariff or checkout is approved. This release is not a priced Quotes & Orders engine.

## Delivered
- Migration 018: additive `TenantModularInquiryReview` table, linked with a trusted composite `(TenantId,RequestId)` FK to the original inquiry, with a single immutable review per request; checked review outcomes and required 1–500-character note. New unique tenant/request index on original inquiry table.
- Operator-only `GET/PATCH /api/admin/platform/modular-quote-inquiries` with `requirePlatformOperator()` on **both** methods; GET filters `awaiting_pricing` or `closed`, returns a maximum of 100.
- Atomic `closeOperatorQuoteInquiry`: authoritatively resolves request's tenant; protects `CASHER_BOOT`; takes tenant commercial applock; locks request; transitions `awaiting_pricing → closed`; records review and outbox audit in same SQL transaction. Identical replay returns success without writing a second review or event; mismatched replay returns 409.
- Operator inbox at `/platform/modular-quote-inquiries` linked from `/platform`; lists industry, tenant, selected apps, branch plan, billing cycle and draft revision. Closing a request requires a reason and note. Closed tab shows audit.
- Mandatory tests: migration integrity, tenant-FK and uniqueness checks, authenticated API, transactional scope, no-sale regressions and UI route.
- Every endpoint intentionally returns `paid:false`, `canIssueQuote:false`, `canAcceptOrder:false` or `orderCreated:false` as applicable; **cannot represent payment**.

## Status and outcomes
Inquiry statuses remain `awaiting_pricing` and `closed`; outcomes: `follow_up_recorded`, `not_applicable`, `duplicate`. None means "priced", "accepted", "paid", "approved" or "subscription active". To request later pricing after revisions, the customer saves a fresh revision and submits a new inquiry.

## Commercial boundary
The platform research simulator contains **experimental amounts** and must NEVER be used to issue these customers an offer. No approved commercial prices, branch tariff, tax treatment, annual term rules, payment/refund rules or billable entitlement mapping exist yet.

**NOT in this PR:** approved/signed priced quote, expiration, customer acceptance, order state, gateway, settlement reconciliation, invoice or feature entitlement. Do not quietly introduce those via follow-up buttons.

## Rollout acceptance gates
1. Review PR and CI, migrate **018 only after 015–017** through production-approved migration process; **no migration is executed merely by merging**.
2. Staging: operator can list/review; regular tenant admin cannot access the operator API; tenant users cannot close requests; verify both tenant histories are isolated.
3. Verify two simultaneous reviewers: exactly one close/outbox entry; identical retry is idempotent and a different retry is rejected.
4. Confirm Cut Salon invoices, shift close, employee ledger, public booking and pre-existing subscription remain unchanged. No core financial tables modified.
5. Require formal commercial policy and versioned catalog approval before initiating a priced Quotes & Orders implementation.

## Next: commercial readiness and approved Quotes & Orders
Catalog approval with four-eyes review → server-signed payable quote (version, expiry, locked minor-unit amounts, taxes/fees) → explicit acceptance → idempotent order → verified payment settlement → subscription/app entitlement grant. Each step demands separate design review; no experimental tariff auto-promotion.
