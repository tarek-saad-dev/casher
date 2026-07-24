# Phase 1K — Attendance Dependency Audit

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Pre-capture:** `scripts/audit-branches/_phase1k-attendance-before.json`  
**Migration:** `db/migrations/add-attendance-branch-ownership.sql`  
**GLEEM:** `BranchID = 1` (active) · **PH1GTEST:** `BranchID = 2` (inactive)

---

## 1. Pre-migration live facts

| Object | Exists | Rows / note | BranchID |
|---|---|---|---|
| `TblEmpAttendance` | Yes | **893** rows; **21** employees | **No** (pre) |
| Unique | `UQ_TblEmpAttendance_Emp_WorkDate` | `(EmpID, WorkDate)` | Global |
| Open sessions | `CheckOutTime IS NULL` + check-in set | **285** null-checkout rows | — |
| Null check-in | — | **266** | — |
| Emp+WorkDate duplicates | — | **0** | — |
| WorkDate range | — | 2026-05-01 → 2026-07-23 | — |
| `TblEmpBranchAssignment` | Yes | Eligibility only | Yes |
| Daily payroll rows | `TblEmpDailyPayroll` | **606** | No BranchID |
| Schedules / day-off | `TblEmpWorkSchedule`, day-off tables | Employee-global | No |

**Status distribution (pre):** Late 421 · Present 221 · DayOff 136 · Absent 55 · Pending 45 · EarlyLeave 10 · Excused 5.

---

## 2. Application write/read paths (pre → post)

| Path | Pre-1K | Post-1K |
|---|---|---|
| `POST /api/employees/attendance` | Emp+WorkDate MERGE; no BranchID | Session branch; reject body BranchID; eligibility via assignment |
| `GET /api/employees/attendance` | Emp/date only | `WHERE BranchID = session` |
| Admin attendance GET/PUT | Emp+date | Branch-scoped upsert / filter |
| Admin attendance bulk | Emp+date global | Session branch + assignment gate |
| Check-in / check-out core | Scattered route SQL | `branchAttendance.service.ts` |
| Open-session exclusivity | Soft / incomplete | App lock `attendance-session:{EmpID}` + service checks |
| Nightly finalize | Global Emp+WorkDate | Per **active** branch, then payroll once |
| Daily payroll generate | One row per Emp+WorkDate from attendance | `vw_EmpAttendancePayrollDay` aggregate |
| Targets / ledger / WhatsApp | Emp+date / global | Unchanged ownership (Phase 1L) |

---

## 3. Failure scenarios addressed

| # | Failure (Phase 1I) | Phase 1K treatment |
|---|---|---|
| 1 | Check-in at branch B indistinguishable from GLEEM | **Fixed** — `BranchID NOT NULL` |
| 2 | Same-day multi-branch blocked by Emp+WorkDate unique | **Fixed** — unique `(BranchID, EmpID, WorkDate)` |
| 3 | Two open sessions across branches | **Mitigated** — employee-global open conflict via applock + service |
| 4 | Body/browser BranchID trusted | **Fail-closed** — session wins; body BranchID rejected |
| 5 | Employee not assigned to branch checks in | **Fail-closed** — `assertEmployeeEligibleForBranchAttendance` |
| 6 | Payroll breaks when multiple sessions/day | **Compatible** — day aggregate view (no branch P&L yet) |
| 7 | Nightly finalize mutates wrong branch rows | **Fixed** — finalize scoped by `branchId` |
| 8 | Filtered unique on open sessions | **Not used** — historical multi-open incompletes |

---

## 4. Explicit non-goals (frozen)

* Activate PH1GTEST or production branch #2  
* Add `BusinessDayID` to attendance (not deterministic for history)  
* BranchID on payroll / ledger / targets  
* Restart sync service  
* Change schedules / day-off to branch-owned  
* Live multi-branch smoke beyond GLEEM continuity  

---

## 5. Registry update

`domainOwnershipRegistry.ts`:

| Domain | Classification | `goLiveBlocker` (post-1K) |
|---|---|---|
| `attendance` | BRANCH_OWNED_ROOT | **false** |
| `payroll_ledger_targets` | DEFERRED_REQUIRES_BUSINESS_DECISION | **true** (Phase 1L) |

---

## 6. Classification summary

```
GLOBAL_MASTER:           TblEmp
BRANCH_ELIGIBILITY:      TblEmpBranchAssignment
BRANCH_OWNED:            TblEmpAttendance (+ breaks as children)
EMPLOYEE_GLOBAL:         open-session conflict (one open attendance per EmpID)
EMPLOYEE_DATE_AGGREGATE: payroll daily input (until Phase 1L)
EMPLOYEE_GLOBAL:         schedules / day-off
DEFERRED (1L):           payroll / ledger / targets BranchID attribution
```
