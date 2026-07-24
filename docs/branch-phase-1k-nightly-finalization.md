# Phase 1K — Nightly Finalization Topology

**Date:** 2026-07-24  
**Orchestrator:** `src/lib/hr/nightly-close.service.ts` → `runNightlyClose`  
**Finalize:** `src/lib/hr/finalize-incomplete-attendance.ts`  
**Database:** cloud / `last132`

---

## 1. Topology (authoritative)

```
for each active branch:
    finalizeIncompleteAttendanceWithDefaults(workDate, { branchId })
then once globally:
    daily payroll generate
    employee daily targets
    employee WhatsApp
    owner WhatsApp
```

Attendance close is **per active branch**. Payroll / targets / WhatsApp remain **once per workDate** (employee-global), unchanged in ownership until Phase 1L.

---

## 2. Per-branch finalize rules

| Rule | Detail |
|---|---|
| Scope | Only reads/updates/creates `TblEmpAttendance` for `@branchId` |
| Does not | Close another branch’s open sessions |
| Defaults | Same “D” Default fill as HR board (`applyDefaultTimesToRow`) |
| Schedules | Still employee-global (`TblEmpWorkSchedule` / emp defaults) |
| Failure | Per-branch errors collected; abort only if **all** active branches fail |

With GLEEM-only active, behavior matches single-branch finalize.

---

## 3. Why this order

1. Branch-owned incompletes must close **without** writing the wrong `BranchID`.  
2. Payroll still needs one Emp+WorkDate aggregate (`vw_EmpAttendancePayrollDay`) after all branches finalize.  
3. Targets / WhatsApp remain centralized HR outputs — not branch-iterated in 1K.

---

## 4. Explicit non-changes

* No BranchID on payroll/ledger/target writes  
* No per-branch payroll generate loop  
* No second branch activation (only active branches are iterated)  
* Sync remains stopped  

---

## 5. Operational note

When a future branch #2 is activated, nightly will finalize **both** branches independently before a single payroll pass. Wage attribution across those sessions remains a **Phase 1L** decision.
