# Phase 1K — Attendance Business Contract

**Date:** 2026-07-24  
**Database:** cloud / `last132`  
**Status:** Ownership contract frozen for Phase 1K

---

## 1. Frozen ownership contract

```
TblEmp                    = GLOBAL_MASTER
TblEmpBranchAssignment    = branch eligibility
TblEmpAttendance          = BRANCH_OWNED
open conflict             = EMPLOYEE_GLOBAL
payroll daily             = employee/date aggregate until 1L
```

| Layer | Rule |
|---|---|
| Employee identity | One global `TblEmp` row across all branches |
| Who may check in | Active assignment to the **session** branch on `WorkDate` |
| Attendance row | Owned by `BranchID`; unique `(BranchID, EmpID, WorkDate)` |
| Concurrent open session | At most **one** open attendance per employee **globally** |
| Same calendar day, two branches | Allowed **only** as sequential closed → open (not overlapping opens) |
| Payroll hours (1K) | Sum net minutes across all branch sessions for Emp+WorkDate |
| Payroll / ledger / targets P&L | **Not** branch-attributed until Phase 1L |
| Schedules / day-off | Remain **employee-global** |

---

## 2. WorkDate (not BusinessDayID)

| Decision | Rationale |
|---|---|
| Persist `WorkDate` only | Historical attendance lacks reliable business-day linkage |
| Resolve WorkDate at write | Prefer open business day `newDay` for session branch; else branch calendar date |
| **Do not** add `BusinessDayID` | Not deterministic for backfill; deferred indefinitely |

---

## 3. Case outcomes (vs Phase 1I HR boundary)

| Case | Verdict after 1K |
|---|---|
| 1 — Works only GLEEM | **SAFE** — all history backfilled to GLEEM |
| 2 — Works only branch B | **Infra ready** — requires active branch + assignment; **NO-GO** to activate B for check-in until smoke + 1L clarity |
| 3 — Morning GLEEM, evening B same date | **CONDITIONAL** — two rows allowed; must close GLEEM before B open; payroll aggregates hours |
| 4 — Sales in both branches | Sales already branch-owned; wage cost attribution still **1L** |
| 5–9 — Ledger / targets / advances | **Unchanged** — deferred to Phase 1L |

---

## 4. Session vs body BranchID

* Mutating routes take `BranchID` **only** from authenticated session / `requireBranchOperationAccess`.  
* Request body `BranchID` / `branchId` → **rejected**.  
* Check-out must target a row whose persisted `BranchID` equals the active session branch (else 404).

---

## 5. Explicit exclusions

* No second-branch activation  
* No sync restart  
* No payroll table BranchID  
* No schedule/day-off branch ownership  
* No claim that multi-branch wage P&L is correct
