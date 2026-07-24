# Phase 1K — Payroll Compatibility

**Date:** 2026-07-24  
**View:** `dbo.vw_EmpAttendancePayrollDay`  
**Helper:** `src/lib/payroll/attendancePayrollAggregate.ts`  
**Consumer:** `src/lib/payroll/dailyPayrollGenerateCore.ts`  
**Database:** cloud / `last132`

---

## 1. Compatibility rule (frozen until 1L)

```
Attendance storage  = branch-owned sessions (TblEmpAttendance.BranchID)
Payroll input       = one EmpID + WorkDate aggregate
Payroll / ledger / targets tables = NO BranchID (unchanged)
```

Phase 1K makes multi-session days **safe for hour summation**. It does **not** attribute wages to a branch P&L.

---

## 2. Aggregate semantics

| Field | Rule |
|---|---|
| Grouping | `EmpID`, `WorkDate` (all branches) |
| Net minutes | Per-session duration − `BreakMinutesTotal`, summed |
| Overnight | If `CheckOutTime < CheckInTime`, add one day to out before diff |
| Open session | `HasOpenSession` — payroll validation still treats as incomplete |
| Primary ID | `MIN(ID)` — join anchor for legacy helpers expecting one attendance row |

`loadEmpDayAttendanceAggregates` prefers the view over ad-hoc `GROUP BY` in payroll paths. `AGGREGATE_ACTUAL_HOURS_EXPR` converts `NetMinutesRaw` → hours for generate SQL.

---

## 3. What stays employee/date keyed

| Object | BranchID in 1K? |
|---|---|
| `TblEmpDailyPayroll` | **No** |
| Employee ledger entries | **No** |
| Daily targets | **No** |
| Validation Map EmpID → attendance | Still one entry per employee per workDate |

---

## 4. Multi-branch same day (hours)

| Scenario | Hours behavior |
|---|---|
| One GLEEM session | Same as pre-1K |
| GLEEM morning + branch B evening (both closed) | **Sum** of both nets |
| Open session remains | Nightly / validation still flags missing checkout |

Wage **cost center** for that aggregate is **undefined** until Phase 1L.

---

## 5. Phase 1L boundary

Phase 1L owns:

* Payroll / ledger / target **branch attribution** decisions  
* Whether hours/wages split by attendance `BranchID` vs treasury payer vs home branch  
* Any schema columns on payroll/ledger/targets  

Starting Phase 1L is **GO** after 1K closure; activating branch #2 check-in remains **NO-GO** until smoke + attribution clarity.
