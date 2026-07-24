# Phase 1I — Risk Register

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Active branches:** GLEEM only

Severity: Critical / High / Medium / Low. Likelihood: High / Medium / Low.

---

| Risk | Domain | Severity | Likelihood | Current protection | Required fix | Implemented? | Go-live blocker? | Owner | Evidence |
|---|---|---|---|---|---|---|---|---|---|
| Operations status read any open day globally | Day/shift | Critical | High (pre-1I) | `requireActiveBranchContext`, `getOpenBusinessDay(branchId)` | Branch-scoped status route | **Yes** | No | Engineering | `operations/status/route.ts`; registry marker |
| Rollover check assumed single global open day | Day/shift | Critical | High (pre-1I) | Active-branch rollover | Scope to session branch | **Yes** | No | Engineering | `day/rollover-check/route.ts` |
| Day history/summary leaked cross-branch | Day/shift | Critical | Medium (pre-1I) | `BranchID = @branchId`, validate day belongs to branch | Ownership predicates | **Yes** | No | Engineering | `day/history`, `day/summary` routes |
| Shift routes unscoped | Day/shift | Critical | Medium (pre-1I) | `getUserOpenShiftForBranch`, branch history | Branch shift helpers | **Yes** | No | Engineering | `shift/*`, `shifts/current` routes |
| Business days list unscoped | Day/shift | High | Medium (pre-1I) | `BranchID = @branchId` | Branch filter | **Yes** | No | Engineering | `business-days/route.ts` |
| Sales today open-day query unscoped | POS | High | Medium (pre-1I) | Open day query scoped to branch | Branch predicate on day join | **Yes** | No | Engineering | `sales/today/route.ts` |
| Queue settings TOP 1 fallback | Queue/settings | Critical | High (pre-1I) | `WHERE BranchID = @branchId`; no fallback | Remove TOP 1 | **Yes** | No | Engineering | `queue/settings/route.ts` |
| Booking settings migrate unscoped | Settings | High | Low | `requireActiveBranchContext` | Active branch only | **Yes** | No | Engineering | `admin/booking-settings-migrate/route.ts` |
| Sales WhatsApp used default branch name | WhatsApp | Medium | High (pre-1I) | `gated.branch.branchName` in payload | Persisted branch name | **Yes** | No | Engineering | `sales/route.ts` |
| Owner daily WA preferred GLEEM | WhatsApp | Medium | Medium (pre-1I) | `listActiveBranches()` iteration | Per-branch sections | **Yes** | No | Engineering | `owner-daily-whatsapp-report.service.ts` |
| Global product stock on `TblPro.Qty` | Inventory | Critical | High (if retail enabled) | Single branch — latent | Branch inventory balance + scoped movements | **No** | **Yes** (product sales) | Business + Engineering | Live inventory; `proHasQty: true` |
| Purchases without BranchID | Purchases | Critical | High (if receiving enabled) | No purchase API active; 0 purchase rows | Add BranchID + write paths | **No** | **Yes** (with stock) | Business + Engineering | `purchaseHasBranch: false` |
| Attendance global Emp+Date | HR | Critical | High (multi-branch staff) | Works for GLEEM-only | BranchID or explicit rule | **No** | **Yes** (check-in) | Business | 893 attendance rows; no BranchID |
| Nightly close global not per-branch | Jobs/HR | High | Medium | Single branch masks issue | Iterate branches or central HR policy | **No** | Conditional | Engineering | `nightly-close.service.ts` |
| Employee daily WA default branch name | WhatsApp | Medium | Medium | Config default | Pass branch from payroll context or iterate | **No** | No | Engineering | `employee-daily-whatsapp-report.service.ts:196` |
| Payroll/ledger/target attribution undefined | HR | Critical | Medium | Cash moves branch-stamped | Business decision + optional schema | **No** | **Yes** (full HR) | Business | Ledger 517 rows; deferred phases |
| Loyalty ledger lacks source branch | Loyalty | Medium | Low | Global atomic balance | Optional SourceBranchID on ledger | **No** | No (preferred) | Business | 2225 ledger rows |
| Offers scope undefined | Promotions | Medium | Low | Table absent | Classify before activation | **No** | No (table absent) | Business | `TblOffers` false on last132 |
| Printers machine-local not branch DB | Devices | Medium | Medium (multi-site) | Single deployment | Machine binding + invoice branch check on reprint | **No** | No (deploy) | Ops | 2 printers, 5 print settings |
| Calendar sync inactive but CT-enabled | Legacy | Medium | Low | Sync stopped | Keep stopped; no branch-less writes | N/A | No | Engineering | 124+37 sync rows |
| Sync service registry stale | Legacy | Low | Low | Service stopped | Do not restart in 1I | N/A | No | Ops | ~40 syncEnabled rows |
| PH1GTEST reactivation without readiness | Branches | High | Low | `IsActive=0` | Follow Phase 1G bootstrap + clear blockers | N/A | **Yes** (if premature) | Ops | BranchID 2 inactive |
| Child table direct IDOR | Various | Medium | Low | Parent validation on modern routes | Continue child inherit audits | Partial | No | Engineering | Phase 1F/1D patterns |
| Employee schedule overlap global | Bookings | Medium | By design | Emp-global intervals | Document EMPLOYEE_GLOBAL_CONFLICT | N/A | No | Business | Phase 1F closure §9 |

---

## Fixed P0 summary (Phase 1I)

All day/shift/status/settings P0 route leaks listed in the feature inventory are **Implemented = Yes**, **Go-live blocker = No** for GLEEM-only and for branch infrastructure (session, switcher, financial ownership).

## Remaining go-live blockers for production branch #2

1. **Inventory** — global `TblPro.Qty` + no purchase BranchID  
2. **Attendance** — no BranchID before staff check-in  
3. **Payroll/ledger/targets** — cost attribution undecided (full HR on branch #2)  
4. **Operational activation** — must not open branch #2 until 1–3 addressed or explicitly scoped (e.g. services-only pilot without local HR/stock)

## Risk acceptance (GLEEM-only production)

With one active branch, Critical inventory and attendance risks are **latent** — behavior unchanged from pre-1I for day-to-day GLEEM operations. Phase 1I P0 fixes reduce **infrastructure** risk when a second branch is eventually activated and users switch sessions.
