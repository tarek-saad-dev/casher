# Phase 1L — Monthly Salary (Branch Component)

**Date:** 2026-07-25  
**Database:** cloud / `last132`  
**Service:** `src/lib/services/employeeLedgerMonthlySalaryService.ts`  
**Plan:** `TblEmpBranchPayrollPlan` (`PayType = monthly`)

---

## Locked model

Each branch has its own configured monthly salary contribution. Global entitlement is a read-only SUM.

| Branch | Monthly component |
|---|---:|
| GLEEM | 4000 |
| Branch B | 2500 |
| Global (SUM) | **6500** |

---

## Rules

| Rule | Detail |
|---|---|
| Source | `TblEmpBranchPayrollPlan.MonthlySalary` for that BranchID |
| Missing plan / amount | Generate **none** for that branch |
| GLEEM fallback | **Forbidden** |
| Idempotency | Emp + Branch + PayrollMonth |
| Ledger credit | `EntryReason = monthly_salary`, BranchID = plan branch |
| API | Session branch; body BranchID rejected |
| Nightly | On last calendar day of month, post per active branch |

---

## Status

| Piece | Status |
|---|---|
| Branch plan table + GLEEM seed | **Done** |
| Monthly post uses branch plan + stamps BranchID | **Done** |
| Nightly “when due” per active branch | **Done** |
| Fail closed without branchId | **Done** |

---

## Non-goals

* Hours-based automatic split  
* Writable global salary account  
* Second-branch activation  
