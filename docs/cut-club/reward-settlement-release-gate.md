# CUT CLUB 2.0 — atomic financial settlement candidate (#300)

Status: DRAFT REVIEW ONLY, **feature disabled**, no API route / no SQL executed / no Coins changed. Builds on integrated member/security foundations from #299/#296.

## Why new checkout
Legacy `purchaseStoreItem` reads balance outside a transaction, deducts without `PointsBalance >= amount` guard inside the update, uses a timestamp-based ledger key, and can race double-submit. It is quarantined in existing Draft #266. The new CUT CLUB must not revive those paths.

## New contract
- `rewardSettlement.ts`: authorize only a revocable **verified** customer session and trusted tenant→legacy customer and SalonID mapping. Fail closed if disabled, no login, missing owner proof, invalid item/cost/tier or ambiguous loyalty data. No clientId from browser.
- `sqlRewardPurchasePort.ts`: SQL Server `SERIALIZABLE` transaction with per-tenant/customer `sp_getapplock`, idempotency key replay and exact-item conflict checks; confirm item belongs to authorized SalonID, available balance and tier; decrement stock only when available, conditionally debit Coins, create negative ledger movement, issue unpredictable voucher and record durable command with a unique key. A failure rolls the entire transaction back.
- `docs/cut-club/sql/reward-command-staging.sql`: staging-only review schema `CutClubRewardCommand`, unique `(TenantId, CustomerId, IdempotencyKey)`, FKs to tenant/client/inventory, immutable purchase receipt. **NOT automatically executed.**
- `cutClubRewardSettlement.test.ts`: synthetic in-memory serialized transaction fixture for concurrent same-key submit, replay, wallet/stock/ledger rollback, wrong tenant/session, same-key different item and SQL safety invariants. This is NOT a real SQL concurrency test.

## Never switch ON before
- [ ] Production metadata read-only proof and authenticated Tenant UUID/SalonID/ClientID mapping (still missing; GitHub tools cannot run the DB).
- [ ] Approved WhatsApp OTP identity verification and durable session, cookie/BFF and per-record authorization.
- [ ] SQL staging schema migration through controlled manifest and test data, with rollback proof and critical FK/index review.
- [ ] Actual SQL Server two-session concurrency, full double-spend/idempotency replay, record-level tenant isolation and voucher fulfillment tests.
- [ ] Mystery Box probability/stock/financial settlement and legacy reward-redemption replacement, both still not implemented here.
- [ ] Owner-approved exact Coins, reward terms, service/stock, expiry, tier and branch policies; financial reconciliation, partial refunds and reversed invoices.
- [ ] Old guest booking preserved, deep-link/campaign impact reviewed and customer support plan.
- [ ] VPS build/rollback, independent security review, exact-head CI, explicit owner Merge/Deploy signoff.

## Recovery
All old ledger records, Coins, vouchers and purchases must be preserved. If checkout settlement errors, return generic failure and retry with the **same idempotency key** only after verifying the receipt from the authoritative DB. Never generate a new idempotency key automatically on an uncertain outcome. Prevent staff or public clients from calling new writes before flags and billing/permissions are cleared.

**No active rewards checkout, no real customer data or database operation performed in this PR.**
