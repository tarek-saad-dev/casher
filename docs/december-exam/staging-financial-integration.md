# December Exam financial integration — staging only
Current delivery: staged cart quote, explicit POS campaign apply, transaction-time revalidation, atomic redemption, paid-first-visit referral confirmation/reversal, and gated zero-payment path. No real SQL acceptance or production activation. Sequential group helper implemented; all-or-nothing multi-invoice group checkout not implemented.

## Switches (default off)
- DECEMBER_EXAM_POS_PREVIEW_ENABLED=true (server) and NEXT_PUBLIC_DECEMBER_EXAM_POS_PREVIEW_ENABLED=true (build).
- DECEMBER_EXAM_STAGING_REFERRAL_ENABLED=true only for isolated last132_agent/drvo_agent, CASHER_BOOT tenant.
- DECEMBER_EXAM_STAGING_CHECKOUT_ENABLED=true (server) and NEXT_PUBLIC_DECEMBER_EXAM_STAGING_CHECKOUT_ENABLED=true (build), staging only.
- DECEMBER_EXAM_STAGING_ZERO_PAYMENT_ENABLED=true and DECEMBER_EXAM_ZERO_PAYMENT_METHOD_ID require dedicated method named `بدون تحصيل - عرض ديسمبر` and reviewed isolated SQL patch `sql/zero-payment-trigger-staging-only.sql`; do not execute on production.
- DECEMBER_EXAM_TENANT_ID and DECEMBER_EXAM_ELIGIBLE_SERVICE_IDS (explicit approved numeric IDs; exclude products/packages/free lines).
- Migration 027, a configured active campaign in its UTC window, and staff-verified participant links are prerequisites.

## Staging acceptance
- First paid sale at either branch confirms only the pending invitee; old or duplicate-phone clients do not qualify.
- Both legacy/extracted sale modes, payment/transaction rollback, and concurrent sales for the same customer.
- Audited deletion voids the linked referral when not consumed; edit or deletion after inviter redemption is denied pending reviewed accounting reversal.
- Confirm both direct and alternative invoice mutation paths cannot bypass the guard.
- Verify POS preview and tenant isolation; active verified Club link + active loyalty membership included; cart service eligibility excluded from customer-only preview.
- Source assertions are not proof of SQL execution.

## Release blockers
- Canonicalize legacy phone formats and historical client duplicates (including Arabic digits/other phone aliases); confirm invoice history semantics.
- Verify membership suspension source, authoritative eligible catalog pricing, approved rates, commission policy and branch participation.
- Zero-payment path has a staged code implementation; still requires actual isolated trigger patch, payment method, commission policy, treasury/loyalty/receipt/refund tests. The transaction fails if payment or cash movement exists. Positive-price first-visit referral still requires paid invoice.
- Server-derived recomputation and atomic redemption implemented for approved full-price service-only carts. Test stale quotes, concurrent redemption, payment allocations, no stacking and rollbacks on real SQL. Club eligibility requires ACTIVE approved account, exact normalized phone and active TblClientLoyalty. Recheck unlink, inactive loyalty and phone changes on isolated SQL. Persistent suspension separate from unlink remains a product requirement.
- Full atomic group checkout, legacy referral switch audit, and verified production migration/CI approval.
- No production activation or merge from this draft.

## Additional acceptance
- Quote no writes; use fixture identities and disable real outbound WhatsApp at staging ingress.
- Positive checkout: compare persisted head, details, payment, treasury, and redemption; two simultaneous cross-branch attempts can commit at most one redemption.
- Zero checkout: exact 100% entitlement, empty payments, no cash moves; test both treasury and legacy paths and noncampaign zero invoice rejection. Wrong trigger/method/login must fail closed.
- Do not configure the no-collection method for ordinary positive-payment sales. Confirm normal sales paths unchanged. The staging trigger patch must be independently reviewed and not included in production manifest.

## Additional work
- Group helper uses referral code and POS staff access; save invited friends separately first, then obtain a fresh quote for inviter. No atomic group payment or automatic application of pending referrals.
- Prior referral PR #245 paths for preview/wallet/customer-profile/admin and referralSaleTransaction.service.ts were absent on this branch. No legacy module was deleted or switched off in this change; verify deployment state and prevent future activation during December.
- Migration 028 adds independent approved education catalog; free-text unknown institutions remain unverified until in-person card review.
- Registration writes have a transactional global quota (default 60/min). This is not per-IP/anti-bot protection; public ingress limit, session recovery, and abuse tests remain required.
- Public website rates only from active configured campaign. Campaign preview flags remain off; do not activate while checkout is staging-only.
