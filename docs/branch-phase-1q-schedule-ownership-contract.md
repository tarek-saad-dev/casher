# Phase 1Q — Schedule Ownership Contract

**Date:** 2026-07-26  
**Modules:** `empBranchWorkSchedule.ts`, `employeeBranchScheduleResolver.ts`, `employeeBranchScheduleSave.ts`

---

## Source of truth

```text
TblEmpBranchWorkSchedule = BRANCH_OWNED weekly schedule SoT
Key = EmpID + BranchID + DayOfWeek + EffectiveFrom
Policy = ONE_OPERATIONAL_BRANCH_PER_EMPLOYEE_PER_WORKDATE
```

| Field | Role |
|---|---|
| EmpID | Global employee identity |
| BranchID | Operational branch |
| DayOfWeek | 0–6 |
| IsWorking / StartTime / EndTime | Window |
| EffectiveFrom / EffectiveTo | Versioned effectiveness |
| CanReceiveBookings | Booking eligibility at that branch cell |
| IsActive | Soft active |

---

## Legacy

| Object | Role |
|---|---|
| `TblEmpWorkSchedule` | **Read-only fallback for GLEEM only** when no branch-table row |
| DayOff / schedule overrides | Still **global** (no BranchID); `day_off` blocks all branches |

CC / PH1GTEST do **not** inherit legacy schedules via backfill.

---

## Policy

`BRANCH_SCHEDULE_POLICY = ONE_OPERATIONAL_BRANCH_PER_EMPLOYEE_PER_WORKDATE`

- Save rejects working same weekday in two branches for overlapping effective periods → `EMPLOYEE_MULTI_BRANCH_SAME_WORKDAY_NOT_ALLOWED`
- Global resolver flags >1 working branch on a WorkDate with the same code
- Temporary transfer moves that WorkDate’s operational branch without mutating weekly SoT

---

## Resolvers

| Function | Scope |
|---|---|
| `resolveEmployeeBranchSchedule` | One EmpID + BranchID + WorkDate |
| `resolveEmployeeGlobalSchedule` | Union across branches; optional `publicOnly` / `allowedBranchIds` |

Resolution order (branch): global leave → temporary transfer → assignment → branch table → GLEEM legacy fallback → not working.

---

## Related roots (unchanged ownership)

| Root | Classification |
|---|---|
| `TblEmp` | GLOBAL_MASTER |
| `TblEmpBranchAssignment` | Branch eligibility |
| `TblEmpAttendance` | BRANCH_OWNED (1K) |
| `TblEmpBranchPayrollPlan` | Branch plan (1L) |
| `TblEmpTemporaryBranchTransfer` | Date-scoped transfer (1Q) |
