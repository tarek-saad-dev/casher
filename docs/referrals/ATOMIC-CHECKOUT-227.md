# Referral Checkout — Atomic Writer Foundation (Issue #227)

## IMPORTANT: This is a draft integration, NOT a production-ready promotion

Existing open drafts at authoring time:
- PR #222: pure eligibility policy and 50%/20% business rules
- PR #224: tenant-owned DRVO-023 schema, permanent codes, claims, read-only lookup (staging verified)
- PR #226: feature-gated read-only POS referral input/preview; **does not submit `referralCode` in a sale**

This branch is independent of all unmerged PRs and targets `main`. Its SQL targets **DRVO-023 tables** that do not exist in production until a separately approved migration. It does NOT turn on any referral on ordinary deploy.

## Financial gate and checkout path

Server-only `POS_REFERRAL_CHECKOUT_ENABLED=true` is mandatory; absent/false means:
- POS `POST /api/sales` without `referralCode` is unchanged.
- Any explicit referralCode request returns `409 REFERRALS_DISABLED`; it **cannot** accidentally be accepted at full price.
- Writer hooks return without any SQL or monetary changes.

Once explicitly enabled in a safely migrated/approved environment:
1. `POST /api/sales` reads `referralCode` (optional) and authenticates tenant from the staff session. No customer-provided tenant or referrer identity is accepted.
2. A code must match `CUT-` plus 24 hex chars; selected `clientId` must be a SQL INT customer. Existing manual line/header discounts are exclusive with the promotion.
3. **Canonical server pricing** computes a 50% header discount using `computeInvoiceItemsTotals`. All split/normal payment allocations must match the discounted total. Browser `grandTotal` is never trusted.
4. Both `createSale` and `createSaleLegacyFromRoute` begin a SERIALIZABLE SQL transaction. Before writing a head, `prepareReferralSaleTransaction` locks `(TenantId, ClientID)` for **all customer sales while enabled**; the code path rechecks tenant-owned active referrer, prior full-paid invoice, no prior full-paid visit for referred client, and no existing referral claim. It inserts a PENDING claim (inside the same transaction).
5. The existing writers persist invoice/payment/stock/treasury effects in their own transaction.
6. `finalizeReferralSaleTransaction` verifies invoice tenant branch, client, full payment amount from actual payment rows, matching saved 50% header discount; marks claim APPLIED, inserts **one 20% voucher**; and activates or creates a permanent random code for the newly paid customer.
7. **Only then** does the original writer commit. Any SQL failure throws into the existing rollback path. Preview requests never reach this code.

## Explicit launch blockers (DO NOT MERGE/ENABLE)

This is a substantial first implementation slice, **not** the entire issue. The following must be resolved in code, reviewed and tested on staging before live money changes:

- **Production DB migration:** PR #224 / DRVO-023 has passed staging SQL smoke but needs separate production read-only PLAN, human-approved APPLY + backup and review. Do not enable checkout before exact schema/ledger verification. Do not auto-merge.
- **Dependencies/policy deduplication:** reconcile this module with the code generator and pure eligibility/activation utilities from draft PRs #222 and #224. Avoid divergent future business logic and ensure activation counts paid invoice consistently across features.
- **UI submission:** draft PR #226 is preview only; do not silently charge full price for unsubmitted/pending referrals. Add explicit POS apply intent with staff confirmation, updated totals and server-derived payment allocations to a subsequent reviewed integration.
- **Voucher redemption:** existing `/api/pos/client-inventory/use` marks `USED` **before invoice save**. Refactor the old path before any shared voucher usage; the 20% referral vouchers are a separate ledger and currently are **issued but not redeemable** in UI/checkout.
- **Returns/reversals/audit:** there is not yet an idempotent reversal/revocation/expiry movement log, refund-safe behavior or invoice-edit policy for referral vouchers. Do NOT launch without these.
- **Idempotency:** claim/voucher uniqueness prevents a double reward but a repeated POST after a successful invoice does not have a persistent client request-id ledger to return the original invoice; handle retry UX explicitly.
- **Real DB smoke/concurrency:** run targeted staging tests with two overlapping invoice writers (with and without referral), abort/rollback, mixed payments, refund/reversal and recovery. Current Vitest tests exercise the SQL seams with mocked data and static ordering, not full live cashier E2E.
- **SQL review:** check historical invoice flags, `Location` tenant association, money rounding and DB lock/order performance with real stage data. Independent financial/security review required.

## Verification

Run `npx vitest run src/lib/__tests__/referralCheckoutPolicy.test.ts src/lib/__tests__/referralSaleTransaction.test.ts src/lib/__tests__/referralWriterWiring.test.ts`. The same tests are required by GitHub CI. CI/build alone are **not** approval to turn the feature on.

**No production DB access, deployment or schema mutation was performed by this PR.**
