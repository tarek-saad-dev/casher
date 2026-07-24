# Phase 1L — Monthly Salary (Branch Component)

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Service:** `src/lib/services/employeeLedgerMonthlySalaryService.ts`  
**Plan:** `TblEmpBranchPayrollPlan` (`PayType = monthly`)

---

## 1. Locked model

Do **not** auto-split one global monthly salary across branches by hours or invisible formula.

```
Each branch has its own configured monthly salary contribution
```

Example:

| Branch | Monthly component |
|---|---:|
| GLEEM | 4000 |
| Branch B | 2500 |
| Global entitlement (read-only SUM) | **6500** |

---

## 2. Rules

| Rule | Detail |
|---|---|
| Source | `TblEmpBranchPayrollPlan.MonthlySalary` for that BranchID |
| Missing plan / amount | Generate **none** for that branch |
| GLEEM fallback | **Forbidden** |
| Idempotency | Emp + Branch + PayrollMonth (+ plan version when versioned) |
| Ledger credit | `EntryReason = monthly_salary`, BranchID = plan branch |
| Cross-branch generate | One branch cannot invent another’s component |

---

## 3. Historical cutover

* Pre-1L live: **2** monthly_salary ledger credits totaling **9000**.  
* Migration seeded active employee compensation onto **GLEEM** plans only.  
* Legacy `TblEmp.BaseSalary` / `Salary` / `TblEmpSalaryHistory` remain seed/compat sources — not permanent dual-write.

---

## 4. Implementation status

| Piece | Status |
|---|---|
| Branch plan table + GLEEM seed | **Done** |
| Monthly post uses branch plan + stamps BranchID | **Gap** — still posts from global emp BaseSalary without BranchID |
| Nightly “when due” per active branch | **Gap** |
| Fail closed on missing branch plan | **Contract locked; app pending** |

Until the service is updated, monthly posting against `TblEmpLedgerEntry.BranchID NOT NULL` will fail or must be blocked.

---

## 5. Explicit non-goals

* Hours-based automatic split  
* Company-wide bonus routed as monthly salary  
* Second-branch activation  
* Writable global salary account
