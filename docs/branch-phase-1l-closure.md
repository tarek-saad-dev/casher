# Phase 1L Closure — Branch Employee Financial Ownership

**Status:** Accepted for GLEEM continuity + branch-account infrastructure  
**Date:** 2026-07-24  
**Database:** cloud / `last132` only  
**Live active branches:** **1** (GLEEM) — unchanged  
**PH1GTEST:** inactive (`BranchID=2`) — unchanged  
**Sync:** stopped and unused  
**Attendance / inventory:** Phase 1K / 1J preserved

---

## 1. Executive verdict

| Decision | Verdict |
|---|---|
| GLEEM employee accounts (historical continuity) | **GO** |
| Branch employee account infrastructure | **GO** |
| Hourly wage separation | **GO** |
| Monthly salary separation | **GO** (plan-based; GLEEM seeded) |
| Target separation | **GO** |
| Branch payouts | **GO** |
| Global consolidated account | **GO** (read-only SUM) |
| Controlled second-branch smoke | **CONDITIONAL GO** (infra ready; do not activate yet) |
| Activating production branch #2 | **NO-GO** |
| Reactivate PH1GTEST for production | **NO-GO** |
| Restart sync service | **NO-GO** |

**Summary:** Phase 1L freezes writable **EmpID+BranchID** accounts and read-only global SUM. Historical GLEEM totals preserved. No second production branch.

---

## 2. Ownership contract (frozen)

```
Employee identity          = global (TblEmp)
Branch employee account    = writable (EmpID + BranchID)
Global employee account    = read-only SUM
Hourly wage                = branch attendance
Monthly salary             = configured branch plan component
Target                     = invoice branch
Advance / payout           = paying CashMove branch
BranchID                   = immutable after create
```

---

## 3. Post-migration fingerprints (`last132`)

| Metric | Before → After |
|---|---|
| Payroll rows / wageSum | 606 / 147999.66 → **same** (all GLEEM) |
| Ledger credits / debits / balance | 80985.33 / 59951 / 21034.33 → **same** |
| Targets / targetSum | 97 / 30833.6 → **same** |
| Null BranchID | **0** on payroll/ledger/target/recalc/plan |
| PH1GTEST financial rows | **0** |
| CashMove↔ledger BranchID mismatch | **0** |
| Branch balance sum = global sum | **21034.33** |
| Branch payroll plans | **13** (GLEEM only) |

---

## 4. Verification

* Vitest regression: **10 files / 121 tests passed** (includes Phase 1L **10** tests)
* Verifier: `scripts/verify-employee-financial-branch-ownership.ts --with-phase1k..1g` **PASS**
* `npm run build` **PASS**
* Targeted ESLint **0 warnings** on touched Phase 1L files

---

## 5. Remaining go-live blockers (branch #2)

* Explicit second-branch payroll/target plans before any smoke
* Controlled smoke only after ops approval
* No cross-branch payout / settlement
* Sync remains stopped
* Partner-share formulas unchanged

---

## 6. Explicit non-goals (honored)

* No second branch activation  
* No PH1GTEST financial ownership  
* No writable global ledger account  
* No GLEEM plan fallback  
* No attendance / inventory ownership regression  
* No sync restart  
