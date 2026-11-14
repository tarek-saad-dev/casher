# Referral Reward Wallet 20% — Issue #231

## Scope (STILL DRAFT)

Adds the **read-only** staff-wallet list `GET /api/pos/referrals/wallet?clientId=<SQL INT>` and **atomic** redemption of a single 20% referrer voucher on a *new paid sale*.

- Voucher ID is an unguessability-irrelevant identifier: authorization is the staff's server tenant/session plus selected client owner, ACTIVE status, unexpired date, linked APPLIED claim, and row locks. Wallet returns no client PII and no cross-tenant records.
- `POS_REFERRAL_CHECKOUT_ENABLED=true` **and** `POS_REFERRAL_REDEEM_ENABLED=true` both required on server; OFF by default.
- On `POST /api/sales`, an explicit `referralVoucherId` is valid **instead of** `referralCode`, not together. Manual/line discounts cannot stack; current catalog prices and bonus enforced under same transaction.
- Header discount **20%** is recomputed by `computeInvoiceItemsTotals`; payment allocations must sum exactly to discounted total.
- Existing extracted and legacy sale writers invoke shared `prepareReferralSaleTransaction` under SERIALIZABLE: tenant customer lock then voucher `UPDLOCK, HOLDLOCK` of ACTIVE, unexpired, owner-matched voucher with APPLIED claim.
- After persisted invoice, successful payment and actual saved header discount, shared `finalizeReferralSaleTransaction` marks voucher USED with `UsedAtUtc` and `UsedInvID/UsedInvType`, before calling the original sale transaction commit. Any failure propagates to existing sale rollback. **No pre-sale spend API** is used.
- Audit-linked PUT/DELETE now also blocks touching invoices that redeemed a 20% voucher. Full accounting return/reversal is still an unmet release requirement.

## Prerequisites, limitations

This branch starts from **unmerged draft #228** (`e0509dcd...`) and is a new draft PR against main. Rebase after #228 and its prerequisites #222 and #224 human-merge. DO NOT merge or enable independently.

UI staff voucher selection/Apply/Remove is a separate slice based on #230. **GET only lists**; no consumer usage without the new sale flow.

Unresolved: refund/cancellation/reversal/reinstatement/debt for previously consumed vouchers, persistent idempotency/retry IDs, cash-sale E2E for both writers on staging with two concurrent cashiers, controlled expiry policy, promo rules for custom service/package/retail price, financial/security review, full dependency integration, production schema migration PLAN with human-approved APPLY. **No production DB access or merge permitted.**

## Test boundaries

- `referralRewardPolicy.test.ts`: id/flag, 50/20 conflict, no stacking, precise 20% pricing
- `referralRewardWallet.test.ts`: staff tenant-owned wallet, active/expiry/applied-claim filter, absent schema and ID overflow
- `referralRewardRedemption.test.ts`: same transaction/paid invoice/USED, race/failure, partial payment, different tenant/owner, retry rejection
- `referralInvoiceMutationGuard.test.ts`: edit/delete guard on USED voucher and earned claim invoice
- Existing full POS/DRVO CI remains required.

**Never enable the flags in production until independent review, approved migration, refunded voucher handling and real staging E2E pass.**
