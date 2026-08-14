# Phase 1L / 6C — Payroll Plan Contract

**Date:** 2026-08-13 (6C global agreement inherit)  
**Table:** `TblEmpBranchPayrollPlan`  
**Resolver:** `src/lib/payroll/branchPayrollPlan.ts`

## Resolve precedence

```text
1) Explicit EmpID + BranchID + WorkDate plan (branch override)
2) Primary / global employee agreement (home-branch plan preferred, else any covering plan)
3) null → no_branch_payroll_plan / salary_config_missing
```

PayType: hourly | daily | monthly.

## Rules

* No TblEmp.HourlyRate / ManualHourlyRate / BaseSalary for operational generation  
* Branch assignment / schedule / attendance control **where** work happens  
* Compensation agreement is **global per employee** (configure once in `/admin/hr?tab=employees`)  
* Existing per-branch plan rows remain valid **explicit overrides** (not deleted)  
* HR employee form rate edits write **only** to `TblEmpBranchPayrollPlan` via `syncHrRatesToActiveBranchPlans`  
* Employee list/GET overlays rate fields from the primary/active plan for display  
* Generated payroll / ledger rows stay attributed to the working `BranchID`  
* Historical payroll keeps stored rate/breakdown  

## Status

Generate path uses `SQL_BRANCH_PAYROLL_PLAN_APPLY` + `buildDailyWageSqlFromBranchPlan` (with primary inherit).
