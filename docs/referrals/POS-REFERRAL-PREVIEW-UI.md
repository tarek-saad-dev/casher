# POS Referral Code Preview UI — Issue #225

## What it does

On `/income/pos`, the **new-sale** invoice panel has an optional read-only card:

- Select a customer before entering the permanent code.
- Enter code in exact `CUT-{24 hex characters}` format (case-insensitive input accepted).
- Click **فحص**. The staff-session-authenticated API from [PR #224](https://github.com/tarek-saad-dev/casher/pull/224) checks the customer/code inside the session tenant.
- Display eligibility only: first-visit 50% *potential* discount, denied reason, missing/foreign code, or unavailable schema.
- Clearly state: **معاينة فقط — لن يُطبّق أي خصم على الفاتورة، ولن تُصدر مكافأة من هنا.**
- Same `PosInvoicePanel` in desktop and mobile, customer-keyed reset and abort of stale requests.

## Feature flag

`NEXT_PUBLIC_POS_REFERRAL_PREVIEW_ENABLED=true`

- **Absent/false by default**; the preview is not shown after an ordinary deploy.
- Only enable for a separately verified preview environment **after PR #224 and its backend are integrated**.
- This is a public build-time client flag, not an authorization gate. The backend must still enforce staff session and tenant scope.
- Editing existing invoices never displays the card.

## Explicit exclusions

This PR never calls any referral write endpoint, does not send or store referral claims/vouchers, and **never writes** `dis`, `disVal`, line discounts, totals, payment allocations, the sale request, or voucher USED state. Even if a code is 'eligible' in preview, the actual sale remains full-price. **Do not assume the UI is a referral launch.**

## Required following slices before 50/20 launch

1. After human-approved merge/migration of [PR #224](https://github.com/tarek-saad-dev/casher/pull/224), re-test preview API + UI as staff on Staging; PR #222 contains the pure policy rules.
2. Add a server-side invoice-scope `referralCode` field and re-evaluate inside the same SERIALIZABLE sale transaction for **both** port and legacy writers. Claim unique by `(TenantId, ReferredClientID)`; deny reused codes/reversed invoices.
3. Apply 50% and recompute totals/payment atomically; issue one 20% voucher only after committed full payment.
4. Fix existing voucher pre-consumption outside the invoice transaction, and add repeated concurrent cashier, failed payment, rollback, return/reversal and retry tests.
5. Obtain independent review, production migration PLAN and separate human-approved APPLY before any human merge that auto-deploys production.

No production database access, migration, auto-merge or deployment occurs from this UI PR.
