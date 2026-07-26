# Phase 1L — Hourly Payroll

**Date:** 2026-07-25  
**Core:** `dailyPayrollGenerateCore` + `branchPayrollPlan` + `dailyPayrollHrRules`

## Contract

```typescript
executeDailyPayrollGenerate(workDate, { branchId, ... })
```

* `branchId` mandatory  
* Attendance source: `vw_EmpAttendancePayrollBranchDay`  
* Grouping: BranchID + EmpID + WorkDate  
* Rates: `TblEmpBranchPayrollPlan` only (no TblEmp / GLEEM fallback)  
* Missing plan with attendance → `no_branch_payroll_plan`  
* Manual API: session branch; reject body BranchID  

## Two-branch same day

```text
GLEEM: 5h × 50 = 250  → payroll row + hourly_wage credit (Branch=GLEEM)
Branch B: 3h × 50 = 150 → payroll row + hourly_wage credit (Branch=B)
Global total = 400 (SUM only)
```

## Status

| Piece | Status |
|---|---|
| branchId required | Done |
| Branch-day attendance view | Done |
| Plan-based rates | Done |
| Manual / auto / nightly callers | Done |
| Hourly ledger BranchID = payroll BranchID | Done |
