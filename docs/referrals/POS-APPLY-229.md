# POS Referral Apply — Issue #229

**State:** DRAFT. The user-visible 50% Apply flow is build-gated OFF. This is NOT approval to deploy or activate the promotion.

## Dependencies

This branch is based on the **unmerged** preview draft #226 (head `a0fe127`) to reuse the customer-owned preview UI, and opens a **draft PR against main**. Its backend contract depends on **unmerged** tenant schema/preview #224, core policy #222, and atomic sale #228.

When human-approved dependencies merge, rebase/reconcile PR #229 against main, re-run all CI, re-review and smoke. DO NOT enable the feature in production while these dependencies remain drafts.

## Operator flow

1. On `/income/pos`, start a **new** sale, select an existing POS customer and add eligible full-price services. There must be no manual header/line discounts.
2. With `NEXT_PUBLIC_POS_REFERRAL_CHECKOUT_ENABLED=true`, enter `CUT-...`, tap **فحص**. Staff-only GET `/api/pos/referrals/preview` reports initial eligibility. **Preview cannot apply money.**
3. Only an explicitly eligible preview shows **تطبيق خصم الإحالة 50%**. Cashier must deliberately click it. The existing `useSaleState` reducer sets a 50% header discount and stores only the code as the applied intent.
4. The existing invoice summary, total, mobile total bar and payment inputs immediately reflect the discounted total computed by the existing `computeInvoiceItemsTotals` helper. This preserves the same half-piaster rounding as the server.
5. Applying/removing the code clears old payment allocations. **Single payment** re-synchronizes to new total through the POS page effect; with **split payment** the cashier must enter the new cash/card totals and Save rejects a mismatch.
6. Client switch, item add/remove/edit, line discount or manual invoice discount, reset and new invoice all invalidate the code and revert to full-price. Customer information edits with the same ID do not invalidate it. The existing legacy `ClientVouchersModal` is unavailable while referral is applied to avoid untracked stacking.
7. The new sale payload sends `referralCode` and **manual** `dis=0, disVal=0`. Server PR #228 independently validates eligibility, catalog prices, discount, exact payment amounts and reward under one SERIALIZABLE SQL transaction. Existing `PUT` invoices cannot receive this code.
8. If the payment save fails/returns unknown, keep the draft and show a warning to check **recent invoices before retry** until persistent idempotent requests are implemented.

## Switches

- `NEXT_PUBLIC_POS_REFERRAL_CHECKOUT_ENABLED=true`: exposes Apply/Remove after successful preview on POS **build**. OFF by default.
- `POS_REFERRAL_CHECKOUT_ENABLED=true`: separate server-only authorization gate in draft #228. OFF by default.
- `NEXT_PUBLIC_POS_REFERRAL_PREVIEW_ENABLED=true`: existing read-only preview from #226; preview still works independently of checkout.

**Both** checkout switches should remain OFF until core PRs have been reviewed, staging real-invoice E2E has passed and the owner approves rollout. Public client flag is not authorization, never trust it on server.

## Tests and deployment blockers

Unit/React tests in:
- `posReferralApplyState.test.tsx` — real `useSaleState` hook 50% price, payment reset, customer/cart/manual discount invalidation, and reset
- `posReferralCheckoutUi.test.tsx` — eligible preview is NOT Apply, explicit Apply/Remove, stale/denied preview, conflict UI
- `posReferralSalePayload.test.ts` — no double-discount request payload and new-POST-only intent
- Existing `posReferralPreview.test.ts` and `posReferralPreviewComponent.test.tsx` — read-only preview contract preserved

All are required by `.github/workflows/ci.yml`.

**Not solved by this PR**: customer-facing code history/share, 20% voucher redemption (the old inventory endpoint consumes before invoice), 20% voucher expiry/return/refund/reversal audit, request idempotency and unknown commit retries, real checkout DB concurrency tests including both writer paths, price policy for retail/products/packages/custom tariffs and broader promotional combinations, production migration PLAN/APPLY. No agents may merge or deploy, and production `last132` must not be accessed.
