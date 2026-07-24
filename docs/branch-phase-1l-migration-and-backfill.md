# Phase 1L — Migration and Backfill

**Migration:** `db/migrations/add-employee-financial-branch-ownership.sql`  
**Runner:** `scripts/audit-branches/run-phase1l-migration.cjs`  
**Pre-capture:** `scripts/audit-branches/19-phase1l-employee-financial-before.cjs` → `_phase1l-employee-financial-before.json`  
**Database:** cloud / `last132` only  
**Captured (pre):** 2026-07-24T09:19:21Z  
**Status:** Migration applied

---

## 1. Preconditions (enforced in SQL)

| Check | Requirement |
|---|---|
| Database name | Must be `last132` |
| GLEEM exists + active | `BranchCode = N'GLEEM'`, `IsActive = 1` |
| PH1GTEST | Must remain **inactive** |
| After backfill | No NULL BranchID on payroll / ledger / targets / recalc / target plans |
| Cash-linked invariant | Abort if any `Ledger.BranchID <> CashMove.BranchID` |
| PH1GTEST financial rows | Abort if any payroll / ledger / target owned by PH1GTEST |

---

## 2. Migration steps (idempotent)

| # | Step | Idempotent mechanism |
|---|---|---|
| 1 | Create `TblEmpBranchPayrollPlan` + indexes | `OBJECT_ID` / index existence |
| 2 | Seed GLEEM plans from Emp / SalaryHistory | `NOT EXISTS` Emp+Branch+From |
| 3 | ADD nullable BranchID on payroll, ledger, daily target, recalc, target plan | `COL_LENGTH IS NULL` |
| 4 | Backfill BranchID (priority below) | `WHERE BranchID IS NULL` |
| 5 | Abort on nulls or CashMove mismatch | `RAISERROR` |
| 6 | Add FKs | `sys.foreign_keys` name check |
| 7 | ALTER BranchID NOT NULL | Only while nullable |
| 8 | Replace Emp+WorkDate uniques → Emp+Branch+WorkDate / EffectiveFrom | Drop/create index checks |
| 9 | Create `vw_EmpAttendancePayrollBranchDay`, ledger balance views | DROP + CREATE |
| 10 | Sanity: zero PH1GTEST financial ownership | `RAISERROR` |

---

## 3. Historical backfill priority

### Payroll

1. From linked attendance `BranchID` when `AttendanceID` present  
2. Else **GLEEM**

### Targets / target plans / recalc

* All historical → **GLEEM** (sole production operating branch)

### Ledger

1. **CashMove.BranchID** when `CashMoveID` present  
2. **Attendance.BranchID** when `AttendanceID` present  
3. Payroll ref (`RefType = TblEmpDailyPayroll`) → payroll BranchID  
4. Target ref → target BranchID  
5. Remainder → **GLEEM**  
6. **Abort** on ambiguous CashMove / ledger BranchID mismatch

Do not fabricate ownership for unclear rows beyond the above proven chain.

---

## 4. Pre-migration fingerprints (authoritative)

| Domain | Metric | Value |
|---|---|---:|
| Payroll | rows | **606** |
| Payroll | wageSum | **147999.66** |
| Ledger | rows | **517** |
| Ledger | credits / debits / balance | **80985.33** / **59951** / **21034.33** |
| Ledger | cash-linked | **281** |
| Targets | rows / targetSum | **97** / **30833.6** |
| Recalc | rows | **49** |
| Target plans | rows | **5** |
| Salary history | rows | **36** |
| Dup Emp+WorkDate payroll/target | | **0** |

---

## 5. Post-migration expected fingerprint

| Check | Expected |
|---|---|
| Null BranchID | **0** on all 1L tables |
| GLEEM owns historical financial rows | Yes |
| PH1GTEST employee-financial rows | **0** |
| Payroll / target / ledger totals | Unchanged vs pre |
| `SUM(branch balances)` | Equals pre global balance |
| CashMove/ledger mismatch | **0** |
| Unique keys | Emp+Branch+WorkDate (payroll/targets/recalc); Emp+Branch+From (plans) |
| Active branches | **1** (GLEEM) |
| Sync | **Stopped** |
| Idempotent rerun | No duplicate plans / no null reintroduction |

---

## 6. Rollback posture

No automated down migration. Forward-only on live `last132`.

Rollback would require redeploying app builds that do not require BranchID **and** restoring prior uniques only if no multi-branch financial rows exist.

---

## 7. What migration does not do

* Activate PH1GTEST or branch #2  
* Copy financial rows to PH1GTEST  
* Restart sync  
* Update `domainOwnershipRegistry` (app responsibility)  
* Rewrite target/payroll generate callers  
* Change attendance / inventory schemas
