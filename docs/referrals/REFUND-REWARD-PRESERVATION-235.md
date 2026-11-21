# Cut Salon Referral Refund/Reversal — Approved Reward-Retention Policy (#235)

**Business decision approved by owner:** A referrer who earned 20% from a successful paid referral **keeps that reward even if the referred customer's original invoice is subsequently fully refunded/reversed**. It must NOT be revoked, deducted from the referrer, or invalidated due to refunding that referred invoice.

## Implemented in this draft

The existing `DELETE /api/sales/[id]` is a **full invoice cancellation/deletion** path (requires staff tenant session, branch/shift authorization, and a mandatory reason). It already executes `executeAuditedAction` in one SQL SERIALIZABLE transaction to reverse the underlying sale, stock, cash/payment and re-calc effects. This feature adds referral-ledger movements **inside that exact same transaction**:

| Full invoice cancellation scenario | Referral claim | 20% reward |
|---|---|---|
| Referred customer's 50%-off, fully-paid original invoice is deleted | APPLIED → REVERSED, ReversedAtUtc stamped | **No changes to existing earned voucher**. ACTIVE stays ACTIVE, USED stays USED; never auto revoked |
| Referrer redeems an earned 20% voucher on a later invoice, then THAT redeemed invoice is deleted | Original claim unchanged (APPLIED or REVERSED) | Single existing voucher USED → ACTIVE, UsedInvID/UsedInvType/UsedAtUtc cleared, original ExpiresAtUtc retained, no duplicate voucher created |
| Normal non-referral invoice deleted | No change | No change |
| Partial refund, edit of referral-linked invoice | Not implemented | Existing PUT guard blocks edited claim/redeemed invoice. No partial financial handling is presumed |
| Cancel after a previous full refund | Unique claim record remains REVERSED | Reward still honored; the same first-visit discount is not granted again |

### Technical invariants

- Server-only `POS_REFERRAL_REVERSAL_ENABLED=true`, default OFF. Without it, a referral-linked full invoice delete returns 409; non-referral deletes remain unaffected. Enabling before DRVO-023 is installed yields 503, never a silent bypass.
- `reverseReferralInvoiceOnFullRefund` checks migrated schema, tenant+invoice association via `dbo.Location`, locks claim/voucher rows with `UPDLOCK,HOLDLOCK`, and uses state-and-invoice conditioned UPDATE with exactly one affected row. No cross-tenant or double reversal.
- Existing `executeAuditedAction` captures old invoice snapshot + referral ledger IDs/status, staff ID, reason and timestamp in the same transaction and rolls back if invoice stock/payment/treasury reversal or audit write fails.
- Wallet `GET /api/pos/referrals/wallet` and payment `prepareReferralSaleTransaction` / `finalizeReferralSaleTransaction` now accept voucher source claim in **APPLIED or REVERSED** state. The reward expiration and tenant/owner/used criteria are otherwise unchanged. **No re-issued rewards**.
- The original permanent customer referral code is not deleted; existing eligibility checks continue to require a qualifying paid sale and a unique first-visit claim. A fully-refunded first sale therefore cannot grant fresh referral discounts without another paid sale.
- The redeemed-invoice refund restores the original unused voucher *only after* full invoice reversal; its original expiry date is unchanged, so an expired reward does not become spendable merely through a refund.
- No new migration is needed beyond the pending DRVO-023 because it already supports `REVERSED`, `ReversedAtUtc` and the voucher usage fields.

## Important accounting distinction

**The existing DELETE route is an audited full invoice cancellation, not a payment-processor refund API and not proof that cash was physically handed back to a customer.** Staff still need to complete/confirm the external cash or terminal refund according to current shop operations. Part-refund and external refund-settlement reconciliation remain explicitly OUT OF SCOPE.

## Release blockers

1. PRs #222, #224, #226, #228, #230, #232, #234 are still separate unmerged drafts. This branch starts from #232 so its diff contains dependent backend code. Do not merge or enable until safe ordering, rebase, independent review and full CI.
2. Verify with REAL isolated, rolled-back **staging last132_agent** sale transactions including both legacy/extracted POS writers, mixed payments, stock, treasury, refund while reward ACTIVE / USED, retry races and paid-invoice reconciliation; mocked Vitest is not staging checkout proof.
3. Persistent idempotent request IDs, partial refunds, external refund reconciliation, complete customer/admin dashboards and operational approval flow still pending.
4. Human read-only production migration PLAN followed by a separately approved production APPLY with backup reference if required; no agent may merge or deploy.
5. **Never touch production database last132**. New flag and all referral checkout/redeem flags remain OFF by default.

## Tests

```bash
npx vitest run src/lib/__tests__/referralInvoiceRefund.test.ts src/lib/__tests__/referralRefundRouteWiring.test.ts src/lib/__tests__/referralRewardWallet.test.ts src/lib/__tests__/referralRewardRedemption.test.ts src/lib/__tests__/salesInvoiceDelete.test.ts
```

New targeted refund tests enforce no reward revocation, correct voucher restoration, unchanged expiry, authentication-derived tenancy, status uniqueness, row locks, safety gate, audited ordering and rollback. Full build in CI is mandatory; passing CI alone does not authorize financial launch.
