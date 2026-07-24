# Phase 1L — Nightly Generation Topology

**Date:** 2026-07-24  
**Orchestrator:** `src/lib/hr/nightly-close.service.ts` → `runNightlyClose`  
**Database:** cloud / `last132`

---

## 1. Phase 1K baseline (attendance only)

```
for each active branch:
    finalizeIncompleteAttendanceWithDefaults(workDate, { branchId })
then once:
    daily payroll generate
    employee daily targets
    employee WhatsApp
    owner WhatsApp
```

---

## 2. Phase 1L required topology (frozen)

```
for each active branch:
    finalize attendance for branch
    generate branch hourly payroll (+ ledger dual-write)
    generate branch monthly salary components when due
    generate branch target results (+ target ledger)
    collect branch results

then:
    one employee WhatsApp per employee with branch breakdown + overall total
    owner sections remain per branch
```

| Requirement | Detail |
|---|---|
| Isolation | One branch failure must not silently skip / corrupt another |
| No global wage row | Never Emp+WorkDate-only payroll |
| Idempotent retry | Per BranchID + WorkDate |
| Inactive branches | **Not** processed |
| Logs | Include BranchID, BranchCode, EmpID, WorkDate |

---

## 3. Employee WhatsApp shape

```
GLEEM
Hourly wage: …
Target: …
Total: …

Branch B
Hourly wage: …
Target: …
Total: …

Overall total: …
```

One message per employee. Branch names from persisted `TblBranch`. Do not invent GLEEM when another branch name exists.

---

## 4. Implementation status

| Step | Status |
|---|---|
| Per-branch attendance finalize | **Done** (1K) |
| Per-branch payroll generate | **Gap** — still `runDailyPayrollGenerateWithOptionalLedger(workDate, { notesPrefix })` without `branchId` |
| Per-branch targets | **Gap** — still once globally |
| Monthly when due per branch | **Gap** |
| WhatsApp branch breakdown | **Gap** |

With GLEEM-only active, operational continuity can look unchanged **once** callers pass GLEEM `branchId`. Multi-branch correctness requires the loop above.

---

## 5. Explicit non-goals

* Processing PH1GTEST while inactive  
* Separate WhatsApp per branch (unless later requested)  
* Sync restart  
* Activating branch #2 during this phase
