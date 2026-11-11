# CUT POS Referral Reward Wallet UI — Issue #233

This is a **DRAFT** checkout UX, NOT an enabled production feature.

## Stacked dependency chain

- Branch starts at unmerged #230 (Apply 50% + read-only preview from #226).
- Backend contract is unmerged #232 (20% reward wallet and atomic redemption), itself depending on #228 (server sale transaction), #224 (tenant schema and preview) and #222 (business rules).
- After human-controlled merges and migration, rebase/reconcile and retest. Do not merge this PR independently.

## New-sale cashier workflow

1. Staff selects a customer and adds un-discounted services. With BOTH `NEXT_PUBLIC_POS_REFERRAL_CHECKOUT_ENABLED=true` and `NEXT_PUBLIC_POS_REFERRAL_WALLET_ENABLED=true` set during a reviewed staging rollout, a wallet card appears in shared desktop/mobile `PosInvoicePanel`. Both switches default to OFF.
2. Card uses read-only staff-authenticated `GET /api/pos/referrals/wallet?clientId=...`, `Cache-Control:no-store`, no write. Missing/unavailable wallet is a visible error, never an authorization.
3. Staff chooses an ACTIVE 20% reward with **تطبيق**. Existing shared `useSaleState` reducer sets header 20%, invoice total and mobile bar update; old payment allocations clear. The cashier re-allocates split payment or existing single-payment sync updates it.
4. Applied reward blocks 50% referral or manual/line discount stacking, and hides old `ClientVouchersModal`. The old `/api/pos/client-inventory/use` endpoint is NEVER called by this UI.
5. Changing customer, cart, discount, or resetting draft invalidates reward. **إلغاء المكافأة** removes the reward and resets totals/allocations.
6. New POST `/api/sales` sends `referralVoucherId` and `dis:0,disVal:0`, never direct 20% header. Backend #232 rechecks tenant customer/claim/status/expiry/catalog/current payment and consumes voucher only when a fully paid invoice commits. Existing PUT invoices cannot carry a voucher.
7. Failed or unknown payment save keeps the draft and warns staff to check recent invoices before retry because full request idempotency is still a blocker.

## Safety and launch blockers

- Two browser/server feature flags remain **OFF**, plus server flags `POS_REFERRAL_CHECKOUT_ENABLED` and `POS_REFERRAL_REDEEM_ENABLED` both OFF. Never enable until verified in integrated staging and approved rollout.
- No production DB/migration access, no auto-merge.
- Real SQL paid invoice/cash/visa/split checkout E2E under concurrent cashiers, refund/cancel/returns/reversal of accrued and spent rewards, expiry policy, idempotent retries, reconciliation of independent draft PRs, audited payout ledger, independent financial/security review and human-approved production migration PLAN/APPLY remain release blockers.
- Test: `posReferralWalletApplyState.test.tsx`, `posReferralWalletUi.test.tsx` in full CI.
