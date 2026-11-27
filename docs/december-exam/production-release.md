# December launch — release candidate, disabled by default

## Decision: launch V1 via sequential POS checkout
The internal atomic group transaction passed VPS rollback smoke (run 46057258019), but is deliberately not exposed to staff yet. Do not enable group mode for launch. Standard customer-by-customer checkout is the tested release path.

## Publish order
1. Review latest CI on Casher PR #390 and website PR #77. Wait for all relevant checks after the production-mode commits. Merge Casher first with all December flags disabled; confirm deployment and normal non-campaign sale flow. Migration 027–029 use the existing controlled production migration runner, only with verified backup and approval. Do not run the staging smoke against production.
2. Merge website #77; set DECEMBER_EXAM_PREVIEW=true for viewing the landing page only, keep HOME_PREVIEW and PUBLIC_LAUNCH false and registration disabled. No live rates, registration or discount until authorized activation. This is a visual preview, not a private authenticated route: anyone with the URL can see it. Leave it false if preview must remain private.
3. Enable staff flag, tenant ID and origin on Casher, open /admin/offers/december/config, enter the seven approved rates and save DRAFT. Verify eligible service IDs against both branches. Do not use fixture percentages or test service IDs as approval.
4. Finance must approve commission policy. Supported policy in this release is NO_COMMISSION (header TotalBonus and detail Bonus are forced to zero in both adapters; actual legacy payroll procedures still require inspection). Do not set the policy flag without approval. Approve 100% path and the tenant-scoped production trigger patch separately. Inspect production trigger definition and original SHA-256, backup, fill the reviewed script in docs/december-exam/sql/zero-payment-trigger-production-reviewed.sql. No automatic trigger change. Verify dedicated method ID and normal sales before enabling.
5. Apply trusted ingress rate limit to register and recover on the real hosting platform, test 429, and verify the old referral system is disabled on production. Only then set the ingress verification flag. Use matching generated secret across servers; never expose to browser or commit it. Do not copy staging DB user/password into production.
6. Rebuild Casher for NEXT_PUBLIC switches. Enable production flags only after financial/operational approval. On or after 1 Dec Cairo, activate from admin with reason. Verify the public rates and registration, then enable home promotion and public launch labels. Rollback: PAUSE immediately, turn off registration/home/production flags, keep audit and financial records. Do not delete tables or revert the trigger while dependent invoices are active without DBA review.

## Casher release settings (values are placeholders, NOT a ready-to-paste .env)
```env
DECEMBER_EXAM_STAFF_ENABLED=true
DECEMBER_EXAM_TENANT_ID=<verified CUT tenant>
DECEMBER_EXAM_CASHER_PUBLIC_ORIGIN=https://ops.cutsaloon.com
DECEMBER_EXAM_BFF_SHARED_KEY=<same randomly generated server-only secret>
DECEMBER_EXAM_ELIGIBLE_SERVICE_IDS=9,10,20,1047,1049
DECEMBER_EXAM_RECEPTION_USER_IDS=<approved staff IDs>
DECEMBER_EXAM_INTERNAL_REGISTRATION_ENABLED=false
DECEMBER_EXAM_POS_PREVIEW_ENABLED=false
NEXT_PUBLIC_DECEMBER_EXAM_POS_PREVIEW_ENABLED=false
NEXT_PUBLIC_DECEMBER_EXAM_PRODUCTION_CHECKOUT_ENABLED=false
DECEMBER_EXAM_PRODUCTION_ENABLED=false
DECEMBER_EXAM_RELEASE_APPROVAL=<approved release reference>
DECEMBER_EXAM_COMMISSION_POLICY=NO_COMMISSION
DECEMBER_EXAM_INGRESS_VERIFIED=false
DECEMBER_EXAM_PRODUCTION_DB_LOGIN=<verified SUSER_SNAME() from production app>
DECEMBER_EXAM_PRODUCTION_ZERO_PAYMENT_ENABLED=false
DECEMBER_EXAM_ZERO_PAYMENT_METHOD_ID=<reviewed production method ID>
DECEMBER_EXAM_STAGING_CHECKOUT_ENABLED=false
DECEMBER_EXAM_STAGING_REFERRAL_ENABLED=false
DECEMBER_EXAM_STAGING_LIFECYCLE_ENABLED=false
DECEMBER_EXAM_STAGING_ZERO_PAYMENT_ENABLED=false
DECEMBER_EXAM_STAGING_GROUP_ENABLED=false
```

## Website settings
```env
DECEMBER_EXAM_PREVIEW=false
DECEMBER_EXAM_HOME_PREVIEW_ENABLED=false
DECEMBER_EXAM_PUBLIC_LAUNCH_ENABLED=false
DECEMBER_EXAM_INTERNAL_REGISTRATION_ENABLED=false
DECEMBER_EXAM_PUBLIC_ORIGIN=https://cutsaloon.com
DECEMBER_EXAM_CASHER_ORIGIN=https://ops.cutsaloon.com
DECEMBER_EXAM_BFF_SHARED_KEY=<matching server-only secret>
```
Preview and launch remain guarded by live approved rates. No production deployment or activation was performed by preparing this guide. Actual production trigger script is not executed/tested on production; staging used a related rollback-only patch. Browser test used local mocked upstream. Group POS UI, actual printer acceptance, and post-commit payroll/loyalty/messaging acceptance remain release gates.
