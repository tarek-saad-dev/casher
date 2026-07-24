# Phase 1L — Hourly Payroll (Branch Day)

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**View:** `dbo.vw_EmpAttendancePayrollBranchDay`  
**Core:** `src/lib/payroll/dailyPayrollGenerateCore.ts`  
**Aggregate:** `src/lib/payroll/attendancePayrollAggregate.ts`

---

## 1. Contract (frozen)

```
Attendance storage     = branch-owned sessions (1K)
Payroll input          = BranchID + EmpID + WorkDate aggregate
Payroll row uniqueness = UNIQUE (EmpID, BranchID, WorkDate)
Never                  = one Emp+WorkDate wage combining branches
```

Example — same employee, same calendar date:

| Branch | Hours | Rate | Payroll / ledger |
|---|---:|---:|---|
| GLEEM | 5 | 50 | **250** credit @ GLEEM |
| Branch B | 3 | 50 | **150** credit @ Branch B |
| Global report | — | — | **400** = SUM only |

---

## 2. `vw_EmpAttendancePayrollBranchDay`

Groups `TblEmpAttendance` by `(BranchID, EmpID, WorkDate)`:

| Column | Meaning |
|---|---|
| `PrimaryAttendanceID` | `MIN(ID)` join anchor |
| `SessionCount` | Sessions that day at branch |
| `NetMinutesRaw` | Sum of overnight-safe durations − breaks |
| `BreakMinutesTotal` | Sum of breaks |
| `HasOpenSession` | Any check-in with null check-out |
| `HasAnyCheckIn` | Any check-in present |

Phase 1K Emp/day view `vw_EmpAttendancePayrollDay` may remain for consolidated reads — **not** for wage generation.

---

## 3. Generate semantics (`executeDailyPayrollGenerate`)

| Step | Behavior |
|---|---|
| Required | `options.branchId` (throw if missing) |
| UPDATE | Existing Generated/Earned/PendingCheckout rows for that branch+date |
| INSERT | New rows from branch-day view; `NOT EXISTS` on Emp+Branch+WorkDate |
| Hours | `AGGREGATE_ACTUAL_HOURS_EXPR` from view `NetMinutesRaw` |
| Open session | `HasOpenSession = 0` required |
| Dual-write | `syncHourlyWageLedgerForWorkDate(..., branchId)` stamps ledger BranchID |

---

## 4. Callers (expected topology)

```
for each active branch:
  validate attendance for branch
  executeDailyPayrollGenerate(workDate, { branchId })
  optional ledger dual-write for that branch
```

Session / job must supply BranchID from `listActiveBranches()` or gated session — **never** body BranchID.

---

## 5. Implementation status

| Piece | Status |
|---|---|
| Schema BranchID + unique reshape | **Done** (migration) |
| Branch-day view + aggregate loader | **Done** |
| `executeDailyPayrollGenerate` branch-scoped | **Done** |
| Dual-write hourly wage BranchID | **Done** |
| `POST /api/payroll/daily/generate` pass session branch | **Gap** |
| Auto-generate / nightly iterate branches | **Gap** |
| Resolve rate from `TblEmpBranchPayrollPlan` | **Gap** (still SalaryHistory/TblEmp) |

---

## 6. Explicit non-goals

* Combining multi-branch hours into one payroll row  
* GLEEM fallback for missing branch plan  
* Activating branch #2 in this phase  
* Changing attendance ownership
