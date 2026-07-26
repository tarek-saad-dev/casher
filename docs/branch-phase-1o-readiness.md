# Phase 1O — Readiness

**Branch:** CAMP_CAESAR (3) · Lifecycle **SETUP**  
**Evaluate after apply:** score informational · blockers drive gates

## Gate verdicts

| Gate | Ready? |
|---|---|
| SMOKE_TEST | **false** (assignment / schedule / smoke service coverage after 1N cleanup) |
| INTERNAL_LIVE | **NO-GO** |
| PUBLIC_LIVE | **NO-GO** |

## Remaining blockers (post–1O apply)

| Key | Detail |
|---|---|
| biz.opening_cash | Opening cash balance required |
| biz.opening_inventory | Opening inventory A/B/C + qty/costs |
| biz.partner_shares_effective_date | Draft 100% ready — EffectiveFrom/opening date required |
| biz.real_employees | Real employee assignments (not smoke-only) |
| payroll.plan_coverage | Blocked until assignments + plans |
| target.policy_coverage | Blocked until assignments + target policy |
| public.frontend_multi_branch | cutsaloon.com multi-branch not deployed |
| public.* (selection / branchCode / flow smoke / notifications) | Phase 1P scope |

Eligible-barber / smoke.* keys also fail until real or controlled assignments exist again.

## Cleared / resolved by 1O (policy)

Address/contact, operating hours, English display, service/price policy, user access mapping, payment-method catalog policy, partner **percentages** (draft), shared printer, shared WhatsApp.

## Modules contributing

`overnightOperatingHours`, `branchDisplayIdentity`, `branchSetupPolicy`, `updateBranchSetup`, `branchConfigurationTemplate`, `campCaesarPartnerDraft`, `employeeAssignmentCommit`, `openingInventoryDecision`
