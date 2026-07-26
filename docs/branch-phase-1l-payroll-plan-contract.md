# Phase 1L — Payroll Plan Contract

**Date:** 2026-07-25  
**Table:** `TblEmpBranchPayrollPlan`  
**Resolver:** `src/lib/payroll/branchPayrollPlan.ts`

## Resolve

```text
EmpID + BranchID + WorkDate between EffectiveFrom/EffectiveTo + IsActive=1
```

PayType: hourly | daily | monthly.

## Rules

* No GLEEM fallback  
* No TblEmp.HourlyRate / ManualHourlyRate / BaseSalary for operational generation  
* Overlap detection via `assertNoOverlappingBranchPayrollPlans`  
* Historical payroll keeps stored rate/breakdown  

## Status

Generate path uses `SQL_BRANCH_PAYROLL_PLAN_APPLY` + `buildDailyWageSqlFromBranchPlan`.
