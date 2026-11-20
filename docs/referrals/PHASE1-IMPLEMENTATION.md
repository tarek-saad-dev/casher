# CUT Salon Referral Code — Phase 1 implementation map

Source of truth: [Issue #221](https://github.com/tarek-saad-dev/casher/issues/221).
This document describes the agreed referral campaign and the safe integration sequence. The accompanying policy module is **not wired into sales and does not enable promotional discounts**.

## Agreed rules

1. Each customer owns one permanent referral code. Its use becomes eligible after the owner has at least one completed, paid visit.
2. New referred customer receives **50% off their first paid visit**, only once.
3. After that new customer's discounted invoice is persisted and fully paid, the referrer earns **one separate 20% discount voucher**.
4. Separate qualifying referrals produce separate vouchers. **No three-voucher cap**. Each voucher must be redeemed at most once.
5. Self-referral, existing paid customers and repeat referral claims are ineligible.

This policy is represented in `src/lib/referrals/referralPolicy.ts` and tested by `src/lib/__tests__/referralPolicy.test.ts`.

## Current repository observations (2026-11-11)

- `src/app/api/public/client/referral/route.ts` generates a synthetic code from the untrusted `clientId` query parameter; the referral counts and reward-points figure are placeholders, not verified customer data.
- `src/app/admin/cut-club/referrals/page.tsx` shows hard-coded demo stats and demo referrals.
- `db/migrations/cut-club-economy-store.sql` defines `TblClientReferral` and `TblReferralReward`, but the rules there are **coin-based** and `TblClientReferral.ReferralCode` is unique per referral row, not a durable one-code-per-customer program. Presence of migration SQL is not evidence that it was applied.
- `src/components/pos/ClientVouchersModal.tsx` calls `POST /api/pos/client-inventory/use` before sale persistence; that route allows no invoice ID. `useInventoryItem` immediately marks it `USED`. This can burn vouchers if checkout fails; the update also does not constrain `Status='ACTIVE'` atomically.
- `src/app/api/sales/route.ts` has **two** sale writers (ported `createSale` and legacy `createSaleLegacyFromRoute`). Both need transactional handling before the promotion is switched on.
- The public customer identity flow is not authenticated/tenant-scoped. GitHub [Issue #92](https://github.com/tarek-saad-dev/casher/issues/92) and draft [PR #93](https://github.com/tarek-saad-dev/casher/pull/93) flag the same underlying problem. Do **not** launch referral redemption through those query-param customer endpoints.

## Next implementation slices (separate issues/PRs)

### B — Identity and data model (prerequisite)

- Introduce authenticated customer identity bound to a tenant; do not trust submitted customer IDs or a customer-controlled phone number as proof of identity.
- Store **one immutable unique code per (tenant, referrer)**, with activation on a confirmed paid invoice.
- Store a unique claim per **(tenant, referred customer)**, including referrer, applied invoice reference and referral status; protect against races through a unique DB constraint and transaction locks.
- Model **20% discount vouchers** separately from the current coin-based `TblReferralReward` rules; key issuance uniquely by referral claim/invoice.
- Add tenant ownership columns/constraints for any new entities, use migration manifest + checksums (per `docs/drvo/MIGRATION-CONTROL-PLANE.md`). Deploy schema to staging only for automated tests. Production PLAN/APPLY requires the separate human approval workflow.

### C — Authoritative paid-invoice integration

- Staff may enter an active referral code in the POS; the backend resolves the tenant/referrer and verifies eligibility against committed invoices under a lock. A preview is **never** a reservation.
- Treat the 50% discount as a **server-calculated** invoice amount, not a trusted client-side percentage. Define discount precedence with manual/line discounts, taxes and rounding before implementation.
- Integrate claim registration + voucher issuance with both sale writers in the **same database transaction** as invoice, payment and inventory; commit or roll back together.
- Require a valid, fully paid invoice and exactly-once issuance via an idempotency key/unique constraint. Invoice retries, concurrent cashiers, cancellations, partial payment and returns must not duplicate benefits.
- Do not mark any `TblClientInventory` item `USED` when merely selecting it in a modal. Validate ownership, ACTIVE status, expiration, unconsumed uniqueness and discount correctness **inside the invoice transaction**. Failed save leaves the voucher ACTIVE; successful save marks it USED and logs one usage.
- Surface a clear and non-destructive error for an invalid, expired or already-claimed code.

### D — Real customer/admin screens and staging proof

- Replace mock referral counts and sample referrals with tenant-scoped database queries or an explicit no-data state.
- Show each customer's permanent code, available/used vouchers and referral history only after authenticated identity checks.
- Validate first checkout, self-referral, existing customer, repeat attempt, simultaneous redemption, retry with same invoice, partial-payment case, rollback on error, cancellation and reverse-sale cases on `last132_agent`.
- Verify exact invoice totals, cash movements, reward cost, and both sale writers; then perform manual review before release.

## Policy function boundaries

`evaluateReferralAtCheckout`, `calculateFirstVisitReferralDiscountMinor` and `evaluateReferrerReward` accept facts already established on the backend; they do **not** fetch SQL, authenticate users, reserve a referral or perform monetary writes.

Currency is expressed in integer minor units. For the 50% discount, a half-minor-unit rounds up. Future invoice integration must reconcile this with existing server-side `computeInvoiceItemsTotals`, and may change this pure helper after explicit business approval if there is a conflicting monetary rounding policy.

**Release state:** No live referral activation, schema mutation, production migration or deployment in this issue.
