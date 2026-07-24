# Phase 1L — Branch Payroll Plan Contract

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Table:** `dbo.TblEmpBranchPayrollPlan`  
**Migration:** `db/migrations/add-employee-financial-branch-ownership.sql`

---

## 1. Purpose

Effective-dated **compensation per employee per branch**. Future branches must have an explicit plan before payroll generation. **No GLEEM plan fallback.**

---

## 2. Schema

| Column | Type | Notes |
|---|---|---|
| `PlanID` | INT IDENTITY PK | |
| `EmpID` | INT NOT NULL | FK → `TblEmp` |
| `BranchID` | INT NOT NULL | FK → `TblBranch` |
| `PayType` | NVARCHAR(20) | `hourly` \| `daily` \| `monthly` |
| `HourlyRate` | DECIMAL(12,4) NULL | |
| `DailyRate` | DECIMAL(12,4) NULL | |
| `MonthlySalary` | DECIMAL(12,2) NULL | Branch component, not a global split |
| `EffectiveFrom` | DATE NOT NULL | |
| `EffectiveTo` | DATE NULL | Must be ≥ From when set |
| `IsActive` | BIT NOT NULL | Default 1 |
| `SourceNotes` | NVARCHAR(200) NULL | Migration seed notes |
| `CreatedAt` / `UpdatedAt` | DATETIME2 | |

**Unique:** `UX_TblEmpBranchPayrollPlan_Emp_Branch_From` → `(EmpID, BranchID, EffectiveFrom)`.

**Index:** `IX_TblEmpBranchPayrollPlan_Branch_Active` on `(BranchID, IsActive, EffectiveFrom)`.

---

## 3. Seed (historical → GLEEM only)

Idempotent INSERT from active `TblEmp` + open `TblEmpSalaryHistory`:

* `PayType` from `PayrollMethod` / `SalaryType` (same semantics as existing HR rules).  
* Rates/salary from ManualHourlyRate / HourlyRate / history / BaseSalary / Salary.  
* `EffectiveFrom` from history or `2020-01-01`.  
* `SourceNotes` = `Phase1L backfill from TblEmp/SalaryHistory → GLEEM`.  
* **No** PH1GTEST plans.

`TblEmp` / `TblEmpSalaryHistory` remain readable for transition; operational generation must migrate to branch plans and treat missing plan as **fail closed**.

---

## 4. Rules (frozen)

| Rule | Detail |
|---|---|
| Missing plan | Fail closed — do not invent rates |
| Other branch | Never read GLEEM plan as fallback |
| Overlap | One active effective period per Emp+Branch (enforce in app; unique on From) |
| After payroll posted | Prefer audited correction over mutating historical plan rates silently |
| Monthly component | Configured per branch; no invisible hours-based auto-split |

---

## 5. Relationship to legacy globals

| Legacy | Phase 1L |
|---|---|
| `TblEmp.HourlyRate` / `ManualHourlyRate` / `BaseSalary` | Seed source for GLEEM plan only |
| `TblEmpSalaryHistory` | Seed + join compatibility during cutover |
| Dual-write forever | **No** — deprecate for ops payroll |

---

## 6. Implementation note

Core daily generate still joins `TblEmpSalaryHistory` for rate snapshot during cutover. Completion requires generate paths to resolve rates from `TblEmpBranchPayrollPlan` for the **session / generation BranchID** and refuse missing plans.
