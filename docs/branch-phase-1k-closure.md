# Phase 1K Closure — Branch Attendance Ownership

**Status:** Complete (schema migration + application integration + documentation)  
**Date:** 2026-07-24  
**Database:** cloud / `last132` only  
**Live active branches:** **1** (GLEEM) — unchanged  
**PH1GTEST:** inactive (`BranchID=2`) — unchanged  
**Sync:** stopped and unused  
**Inventory changes:** none (Phase 1J preserved)

See also: `branch-phase-1k-attendance-dependency-audit.md`, `branch-phase-1k-attendance-business-contract.md`, `branch-phase-1k-schema.md`, `branch-phase-1k-checkin-checkout-contract.md`, `branch-phase-1k-payroll-compatibility.md`, `branch-phase-1k-nightly-finalization.md`, `branch-phase-1k-migration-and-backfill.md`, `branch-phase-1k-verification.md`.

---

## 1. Executive verdict

| Decision | Verdict |
|---|---|
| GLEEM attendance | **GO** — history backfilled; session-scoped writes |
| Attendance branch infrastructure | **GO** |
| Sequential multi-branch employee work | **CONDITIONAL GO** — infra ready; no live branch #2 |
| Activating branch #2 for check-in | **NO-GO** until smoke on second branch + Phase 1L clarity for payroll attribution |
| Starting Phase 1L | **GO** (may start) |
| Reactivate PH1GTEST for production | **NO-GO** |
| Restart sync service | **NO-GO** |

**Single-line summary:** **GO** for GLEEM attendance and branch ownership infra; **CONDITIONAL GO** for sequential multi-branch sessions; **NO-GO** for branch #2 check-in until smoke + 1L; Phase 1L may start.

---

## 2. What Phase 1K delivered

### Schema (`add-attendance-branch-ownership.sql`)

* `TblEmpAttendance.BranchID` NOT NULL + FK  
* Backfill all historical rows (~**893**) → GLEEM  
* Unique `UQ_TblEmpAttendance_Branch_Emp_WorkDate` (replaced Emp+WorkDate)  
* Index `IX_TblEmpAttendance_Branch_WorkDate`  
* View `vw_EmpAttendancePayrollDay` for payroll day aggregates  
* PH1GTEST attendance guard (must remain 0)  
* **No** `BusinessDayID`; **no** payroll/ledger/target BranchID  
* **No** filtered unique on open sessions

### Application

* `branchAttendance.service.ts` — check-in/out, eligibility, applock `attendance-session:{EmpID}`  
* Employee / admin attendance routes — session branch; reject body BranchID  
* `attendancePayrollAggregate.ts` + daily payroll generate via view  
* Nightly: finalize **per active branch**, then payroll/targets/WhatsApp **once**  
* `domainOwnershipRegistry`: `attendance.goLiveBlocker = false`

### Ownership contract freeze

```
TblEmp = GLOBAL_MASTER
TblEmpBranchAssignment = branch eligibility
TblEmpAttendance = BRANCH_OWNED
open conflict = EMPLOYEE_GLOBAL
payroll daily = employee/date aggregate until 1L
```

### Explicit exclusions

* Second branch activation / PH1GTEST check-in  
* Schedules / day-off remain employee-global  
* Payroll / ledger / target branch attribution (Phase 1L)  
* Sync restart  
* `BusinessDayID` on attendance  

---

## 3. Live post-migration fingerprint

| Metric | Value |
|---|---:|
| Attendance rows before/after | **893 / 893** |
| GLEEM attendance after | **893** |
| PH1GTEST attendance | **0** |
| Null BranchID | **0** |
| Duplicate Branch+Emp+WorkDate | **0** |
| Open sessions (check-in, null checkout) | **19** |
| Employees with >1 open session (historical) | **3** (blocks filtered unique; applock used) |
| Daily payroll row count | **606** (unchanged ownership model) |
| Active branches | GLEEM only |
| Migration idempotent rerun | **OK** |
| Active branches | 1 (GLEEM) |
| Payroll/ledger BranchID | Still absent |

---

## 4. Blocker delta vs Phase 1I / 1J

| Blocker | Phase 1K |
|---|---|
| Attendance no BranchID | **Cleared** |
| Emp+WorkDate blocks same-day multi-branch sessions | **Cleared** (unique reshaped) |
| Nightly HR finalize topology | **Cleared** for attendance (per-branch finalize) |
| Payroll / ledger attribution | **Still open** → Phase 1L |
| Branch #2 check-in go-live | **Still NO-GO** (smoke + 1L) |

`domainOwnershipRegistry`: `attendance` → `goLiveBlocker: false`; `payroll_ledger_targets` → still **true**.

---

## 5. GLEEM operational note

All historical attendance is GLEEM-owned. With one active branch, check-in/out and nightly finalize behave as before operationally, with BranchID stamped and open-session locking enforced in-app.

---

## 6. Branch #2 check-in checklist (when considered)

1. Bootstrap / activate branch session (Phase 1G/H) — still a separate go-live decision  
2. Assign employees via `TblEmpBranchAssignment`  
3. Smoke: check-in B, refuse second open while GLEEM open, close then check-in other branch  
4. Confirm nightly finalize iterates both active branches without cross-writes  
5. **Do not** treat payroll P&L as branch-correct until Phase 1L  

---

## 7. Regression boundary

Confirmed unchanged:

| Item | State |
|---|---|
| GLEEM active branch count | **1** |
| PH1GTEST | **Inactive** |
| Sync service | **Stopped** |
| Phase 1A–1J accepted contracts | Preserved |
| Schedules / day-off | Employee-global |
| Payroll/ledger/target schema | No BranchID |

---

## 8. Artifacts delivered

**Migration**

* `db/migrations/add-attendance-branch-ownership.sql`

**Code**

* `src/lib/hr/attendance/branchAttendance.service.ts`  
* `src/lib/payroll/attendancePayrollAggregate.ts`  
* `src/lib/payroll/dailyPayrollGenerateCore.ts` (aggregate join)  
* `src/lib/hr/finalize-incomplete-attendance.ts` (branch-scoped)  
* `src/lib/hr/nightly-close.service.ts` (per-branch finalize)  
* Attendance API routes (employees + admin + bulk)  
* `src/lib/branch/domainOwnershipRegistry.ts` (attendance blocker cleared)

**Scripts**

* `scripts/audit-branches/17-phase1k-attendance-before.cjs`  
* `scripts/audit-branches/_phase1k-attendance-before.json`  
* `scripts/audit-branches/run-phase1k-migration.cjs`  
* `scripts/audit-branches/17b-open-attendance.cjs` (probe)

**Documentation (9 files)**

* `docs/branch-phase-1k-attendance-dependency-audit.md`  
* `docs/branch-phase-1k-attendance-business-contract.md`  
* `docs/branch-phase-1k-schema.md`  
* `docs/branch-phase-1k-checkin-checkout-contract.md`  
* `docs/branch-phase-1k-payroll-compatibility.md`  
* `docs/branch-phase-1k-nightly-finalization.md`  
* `docs/branch-phase-1k-migration-and-backfill.md`  
* `docs/branch-phase-1k-verification.md`  
* `docs/branch-phase-1k-closure.md`

---

## 9. Next-phase boundary

**Phase 1L (Payroll / ledger / target branch attribution)** may proceed.

Do **not** activate production branch #2 for staff check-in until second-branch smoke passes and Phase 1L attribution rules are clear enough for ops.

Acceptance of Phase 1K is **schema migration + attendance ownership + payroll compatibility aggregate + nightly topology + documented GO/CONDITIONAL GO/NO-GO**, not second-branch go-live.
