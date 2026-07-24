# Phase 1K Schema — Attendance Branch Ownership

**Migration:** `db/migrations/add-attendance-branch-ownership.sql`  
**Runner:** `scripts/audit-branches/run-phase1k-migration.cjs`  
**Database:** cloud / `last132` only  
**GLEEM:** `WHERE BranchCode = N'GLEEM'` → live `BranchID = 1`

---

## 1. `TblEmpAttendance` alterations

| Column | Pre | Post |
|---|---|---|
| `BranchID` | absent | **INT NOT NULL**, FK → `TblBranch` |
| Other columns | Unchanged | Unchanged |

**Not added:** `BusinessDayID` (explicit non-goal).

---

## 2. Constraints and indexes

| Name | Definition | Notes |
|---|---|---|
| Dropped | `UQ_TblEmpAttendance_Emp_WorkDate` (and legacy `UQ_TblEmpAttendance_Emp_Date` if present) | Was global Emp+date |
| `UQ_TblEmpAttendance_Branch_Emp_WorkDate` | UNIQUE `(BranchID, EmpID, WorkDate)` | Replaces global unique |
| `IX_TblEmpAttendance_Branch_WorkDate` | `(BranchID, WorkDate)` INCLUDE EmpID, Status, CheckIn/Out | Branch board queries |
| `FK_TblEmpAttendance_BranchID` | → `TblBranch(BranchID)` | |

**Open-session uniqueness:** **no** filtered unique index. Historical multi-open incompletes (`CheckIn` set, `CheckOut` null) prevent a safe filtered unique. Exclusivity is application-enforced (`attendance-session:{EmpID}` + service checks).

---

## 3. Compatibility view

### `vw_EmpAttendancePayrollDay`

Groups `TblEmpAttendance` by `(EmpID, WorkDate)`:

| Column | Meaning |
|---|---|
| `PrimaryAttendanceID` | `MIN(ID)` for join compatibility |
| `SessionCount` | Number of branch sessions that day |
| `NetMinutesRaw` | Sum of session net minutes (handles overnight out < in; subtracts `BreakMinutesTotal`) |
| `BreakMinutesTotal` | Sum of breaks |
| `HasOpenSession` | Any row with check-in and null check-out |
| `HasAnyCheckIn` / `HasMissingCheckIn` | Flags for validation |
| `AnyStatus` | `MAX(Status)` |

Used by `attendancePayrollAggregate.ts` / daily payroll generate. **Does not** expose BranchID for P&L.

---

## 4. Backfill fingerprint

| Metric | Value |
|---|---:|
| Pre-migration attendance rows | **~893** |
| Backfill target | All NULL `BranchID` → GLEEM |
| Post: PH1GTEST attendance rows | **0** (migration aborts if any) |
| Payroll / ledger / target schema | **Unchanged** (no BranchID) |

---

## 5. Explicit non-changes

* No BranchID on `TblEmpDailyPayroll`, ledger, or targets  
* No `BusinessDayID` on attendance  
* No schedule / day-off schema changes  
* No PH1GTEST attendance rows  
* No sync registry changes  
* No second branch activation
