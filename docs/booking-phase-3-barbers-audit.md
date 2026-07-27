# Booking Phase 3 — Barbers audit

**Date:** 2026-07-27 · **DB:** last132 · Read-only

## Matrix

| Path/function | Input | Output | Branch ownership | Public visibility | Test/smoke | Dup EmpID | Schedule | Services | Required change |
|---|---|---|---|---|---|---|---|---|---|
| `GET .../barbers` | mode, branchCode?, date?, serviceIds? | barber cards | assignment | Phase 1 context | SQL `[[]TEST]` | map by EmpID | optional date | Phase 2 catalog | **Migrated** |
| `.../calendar` | from,to,branchCode?,serviceIds? | days[] presence | global resolver | publicOnly + privacy | BARBER_NOT_FOUND | n/a | `resolveEmployeeGlobalSchedule` | validate IDs | **Migrated** (no slots) |
| `.../location` | date,serviceIds? | one branch or off | one WorkDate | hide non-public | BARBER_NOT_FOUND | n/a | global | validate | **Migrated** |
| `listGlobalPublicBarbers` | date | EmpID+branches | assignment | `canBranchAppearInPublicBooking` | yes | map | no | unused | Keep for smoke; public routes use new module |
| `listBookableEmployeeIdsForBranch` | branchId,day | EmpIDs | assignment | publicOnly opt | yes | n/a | no | no | Still used by days/slots |
| `resolveEmployeeGlobalSchedule` | empId,day | branches union | HR | publicOnly | n/a | conflict code | yes | no | Unchanged engine |
| `employeeServiceEligibility` | emp+services | all active services | global | n/a | n/a | n/a | n/a | soft-delete only | Intersect with Phase 2 set for public |

## Live counts

| Metric | Count |
|--------|------:|
| Active employees | 11 |
| Active barber jobs | 5 |
| Test/smoke name rows | 21 |
| GLEEM assigned | 13 |
| GLEEM CanReceiveBookings | 11 |
| GLEEM scheduled (per weekday 0–6) | 12 each |
| Active with no assignment | 0 |
| CanBook with no weekly schedule | 3 |
| Duplicate barber names | 0 |
| Global public barbers (pre-Phase-3 helper) | **5** unique EmpIDs |
| Emp image/bio/sort columns | **none** |

## Privacy note

When an employee works only at a non-public branch (e.g. Camp Caesar INTERNAL_LIVE), public calendar/location return `not_available_publicly` with empty branches — never the branch name/hours.
