# CUT Referral Feature — Integrated release candidate (#244)

**STATUS: REVIEW / NOT production-ready. All feature flags OFF.**

## Sources integrated into ONE codebase (no merges to main)

| Origin draft | What has been reconciled |
|---|---|
| #222 | Referral business policy and spec regression |
| #224 | DRVO-023 additive SQL migration, manifest and rollback-only staging fixture; staff GET preview and code activation |
| #226 / #230 | Cashier GET code preview, deliberate 50% Apply/Remove and recalculated checkout payment UI |
| #228 / #232 | Both sale writers: atomic paid-invoice 50% reward issuance and 20% voucher redemption, catalogue/tenant/discount validation |
| #234 | Staff 20% wallet GET and mobile/desktop Apply/Remove UI |
| #236 | Full-invoice audited reversal: original source sale may be refunded while earned voucher REMAINS honored; refunded voucher purchase restores the SINGLE original reward |
| #238 | Real permanent code, Copy/WhatsApp sharing and wallet/referral counts for cashier-selected client |
| #241 | Real tenant-scoped admin claims/codes dashboard, no mock counts or invented points |

The integration head starts from draft #241 and brings over source *files* from #224, #234 and #222 using a single source-controlled tree commit; no PR was merged and nothing was pushed to main. **Conflict reconciliation:** `src/lib/types.ts` retains backend `CreateSalePayload.referralCode/referralVoucherId` and now also includes frontend `SaleState.referralCode/referralVoucherId`; `.github/workflows/ci.yml` includes all regression steps instead of losing prior ones; `.github/workflows/drvo-staging-gate.yml` is restricted to the same-repo integration PR branch, dedicated staging environment, `last132_agent/drvo_agent`.

## Expected new-sale workflow

1. Customer is selected in existing POS, staff opens **كود الإحالة والمكافآت** to view a real permanent code activated after a qualifying first fully paid sale; copy or share via WhatsApp.
2. For first visits: enter code and hit GET **فحص**; preview cannot apply discounts or grant rewards. Only eligible result exposes **تطبيق خصم الإحالة 50%**.
3. POS state updates invoice summary and payment allocations; mutually exclusive with 20% wallet voucher or manual/line discount; changing customer/cart revokes discount.
4. POST /api/sales sends the exclusive code/voucher intent, **manual discount 0**. Server independently prices from tenant catalogue, validates customer, locks claim/voucher, checks exact paid invoice and payment records in one SERIALIZABLE transaction across extracted and legacy sale writer paths.
5. Paid referred sale issues exactly one 20% voucher for the referrer, which becomes visible in staff wallet GET. Referrer may apply one 20% voucher on a later new full-price sale.
6. Full DELETE audited refund of original referred sale marks claim REVERSED, but does NOT revoke already-earned reward; refund of the redeemed-voucher purchase restores the original voucher. No unapproved reward override is exposed.
7. Admin dashboard shows actual activated codes, successful/refunded referred invoices and available/used vouchers, searchable/paginated. NO synthetic sent invites, monetary rewards or coins.

## Server flags — all false by default

- `POS_REFERRAL_CHECKOUT_ENABLED=true` for authoritative new-sale claim/issuance.
- `POS_REFERRAL_REDEEM_ENABLED=true` additionally for the 20% voucher checkout.
- `POS_REFERRAL_REVERSAL_ENABLED=true` for audited full-invoice referral cancellation.
- `POS_REFERRAL_PROFILE_ENABLED=true` for staff read-only customer code/rewards profile.
- `POS_REFERRAL_ADMIN_ENABLED=true` for manager-only admin report.

## Browser build-time flags — all false by default

- `NEXT_PUBLIC_POS_REFERRAL_PREVIEW_ENABLED=true` staff-only read-only preview.
- `NEXT_PUBLIC_POS_REFERRAL_CHECKOUT_ENABLED=true` 50% Apply UI.
- `NEXT_PUBLIC_POS_REFERRAL_WALLET_ENABLED=true` 20% earned voucher UI (also requires checkout UI flag).
- `NEXT_PUBLIC_POS_REFERRAL_PROFILE_ENABLED=true` customer profile popup.

Browser flags are NOT security gates. Server still independently validates tenant identity, catalogue, sale, ownership, eligibility, claimed one-time referrals and user privileges.

## Release blockers — MUST BE CLOSED BEFORE HUMAN MERGE

1. Persistent request-idempotency for POST /api/sales: retries/unknown outcome can still duplicate ordinary paid invoices after network failure. No claim of exactly-once general invoice save yet. **Separate issue/slice required** before financial production rollout.
2. **REAL isolated staging paid invoice E2E** for both sale writers: 50% apply + issued 20% reward + 20% spend + audit full refund with retained issued reward, mixed payment, stock/treasury, concurrency and rollback. DRVO-023 staging migration fixture and read-only checks alone do not prove full financial journey.
3. **Independent security/accounting review**, cross-tenant and branch authorization verification, check legacy `/api/public/client/referral` demo route isn't exposing fictional production referral data.
4. **Human-controlled migration plan** for DRVO-023 on production: read-only PLAN, migration checksum/version review, backup reference for MEDIUM-risk additive migration, explicit separately approved APPLY. Agents cannot connect production DB `last132`.
5. Review dependent draft PR diff overlap and choose **this integration PR only** or coordinated minimal PR strategy. **Do not merge any original PR independently on top of this integration branch**; main auto-deploys.
6. Full customer-self-service OTP portal and partial refund/physical payment settlement are not in this core staff/POS/manager integration. Decide whether these are launch requirements separately.

## Required verification

- Targeted `cutReferralFullIntegration.test.ts` cross-layer contract plus all original #222/#224/#230/#234/#228/#232/#236/#238/#241 targeted tests run in CI.
- Full Next production build in CI.
- Guarded DRVO staging gate proves `DB_NAME() = last132_agent`, `SUSER_SNAME() = drvo_agent`, applies only DRVO migrations to staging and runs DRVO-023 rollback-only SQL schema/lock smoke. This IS NOT financial E2E.
- Keep this PR **DRAFT / REVIEW**, all feature flags OFF and no production writes or changes.
