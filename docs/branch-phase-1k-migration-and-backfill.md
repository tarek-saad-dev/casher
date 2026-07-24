# Phase 1K — Migration and Backfill

**Migration:** `db/migrations/add-attendance-branch-ownership.sql`  
**Runner:** `scripts/audit-branches/run-phase1k-migration.cjs`  
**Pre-capture:** `scripts/audit-branches/17-phase1k-attendance-before.cjs` → `_phase1k-attendance-before.json`  
**Database:** cloud / `last132` only  
**Captured (pre):** 2026-07-24T04:05:46Z

---

## 1. Preconditions (enforced in SQL)

| Check | Requirement |
|---|---|
| Database name | Must be `last132` |
| GLEEM exists | `BranchCode = N'GLEEM'` |
| GLEEM active | `IsActive = 1` |
| After backfill | No NULL `BranchID` |
| Sanity | **Abort** if any attendance row owned by PH1GTEST |

---

## 2. Migration steps (idempotent)

| # | Step | Idempotent mechanism |
|---|---|---|
| 1 | ADD `BranchID` nullable | `COL_LENGTH IS NULL` |
| 2 | Backfill NULL → GLEEM | `UPDATE … WHERE BranchID IS NULL` |
| 3 | FK `FK_TblEmpAttendance_BranchID` | `sys.foreign_keys` name check |
| 4 | ALTER `BranchID` NOT NULL | Only while still nullable |
| 5 | Drop Emp+WorkDate unique | Constraint/index name checks |
| 6 | Create `UQ_TblEmpAttendance_Branch_Emp_WorkDate` | Index IF NOT EXISTS |
| 7 | Create `IX_TblEmpAttendance_Branch_WorkDate` | Index IF NOT EXISTS |
| 8 | Recreate `vw_EmpAttendancePayrollDay` | DROP VIEW IF EXISTS + CREATE |
| 9 | Sanity: zero PH1GTEST attendance | RAISERROR |

**Not created:** filtered unique on open sessions (historical multi-open incompletes).

---

## 3. Backfill

| Metric | Value |
|---|---:|
| Pre rows | **~893** |
| Strategy | All historical rows → GLEEM `BranchID` |
| PH1GTEST rows after | **0** |
| Emp+WorkDate duplicates pre | **0** (safe unique reshape) |

No ownership guessing beyond founding-branch backfill — single active production branch at cutover.

---

## 4. Post-migration fingerprint

| Object | Expected |
|---|---|
| `TblEmpAttendance.BranchID` | NOT NULL + FK |
| Unique | `UQ_TblEmpAttendance_Branch_Emp_WorkDate` |
| View | `vw_EmpAttendancePayrollDay` exists |
| Attendance row count | Preserved (~893) |
| PH1GTEST attendance | **0** |
| Active branches | **1** (GLEEM only) |
| Payroll/ledger/target BranchID | **Absent** |
| Sync | **Stopped** |

---

## 5. Rollback posture

No automated down migration. Rollback would require:

1. Redeploy prior app (routes/service) that do not require BranchID  
2. Drop view / restore Emp+WorkDate unique only after confirming no multi-branch session rows  

**Forward-only** acceptance for live `last132`.

---

## 6. What migration does not do

* Activate PH1GTEST  
* Add `BusinessDayID`  
* Modify payroll / ledger / targets schema  
* Change schedules / day-off  
* Restart sync  
* Enforce open-session uniqueness in SQL
