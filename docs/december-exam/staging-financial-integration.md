# December Exam financial integration — staging only
Current delivery: read-only POS eligibility and transactional paid-first-visit referral confirmation/reversal.
No campaign discount has been applied to invoices; no campaign redemption write or group checkout is enabled.

## Switches (default off)
- DECEMBER_EXAM_POS_PREVIEW_ENABLED=true (server) and NEXT_PUBLIC_DECEMBER_EXAM_POS_PREVIEW_ENABLED=true (build).
- DECEMBER_EXAM_STAGING_REFERRAL_ENABLED=true only for isolated last132_agent/drvo_agent, CASHER_BOOT tenant.
- DECEMBER_EXAM_TENANT_ID and DECEMBER_EXAM_ELIGIBLE_SERVICE_IDS (explicit approved numeric IDs; exclude products/packages/free lines).
- Migration 027, a configured active campaign in its UTC window, and staff-verified participant links are prerequisites.

## Staging acceptance
- First paid sale at either branch confirms only the pending invitee; old or duplicate-phone clients do not qualify.
- Both legacy/extracted sale modes, payment/transaction rollback, and concurrent sales for the same customer.
- Audited deletion voids the linked referral when not consumed; edit or deletion after inviter redemption is denied pending reviewed accounting reversal.
- Confirm both direct and alternative invoice mutation paths cannot bypass the guard.
- Verify POS preview and tenant isolation; club link is observed but not awarded; cart service eligibility excluded.
- Source assertions are not proof of SQL execution.

## Release blockers
- Canonicalize legacy phone formats and historical client duplicates (including Arabic digits/other phone aliases); confirm invoice history semantics.
- Verify membership suspension source, authoritative eligible catalog pricing, approved rates, commission policy and branch participation.
- Zero-total invoices currently rejected by POST /api/sales because positive payment allocation is mandatory. Implement approved zero-payment treasury/trigger and payroll behavior, including receipt and refund tests.
- Server-derived discount recomputation inside both sale transactions and atomic redemption unique key; stale quote/payment and non-stacking guards.
- Full group checkout, legacy referral switch audit, and verified production migration/CI approval.
- No production activation or merge from this draft.
