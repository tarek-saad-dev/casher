# Phase 1Q — Attendance / Payroll Guards

**Date:** 2026-07-26  
**Attendance:** `branchAttendance.service.ts` + schedule resolver  
**Payroll:** branch plan still required for working schedule / transfer (1L)

---

## Attendance schedule gate

Check-in requires `resolveEmployeeBranchSchedule` working at **session branch** for WorkDate.

| Code | Meaning |
|---|---|
| `EMPLOYEE_NOT_SCHEDULED_IN_THIS_BRANCH` | No working schedule (or day off / transferred away) at this branch |
| `EMPLOYEE_ALREADY_CHECKED_IN_OTHER_BRANCH` | Open attendance session exists at another branch |

Open-session exclusivity remains employee-global (Phase 1K applock).

---

## Schedule / save conflicts

| Code | Meaning |
|---|---|
| `EMPLOYEE_MULTI_BRANCH_SAME_WORKDAY_NOT_ALLOWED` | Same weekday (or WorkDate union) working in >1 branch |

Working schedule save also asserts assignment + branch payroll plan (and booking services when CanReceiveBookings).

---

## Payroll attribution

Unchanged from 1L:

- Hourly wage → attendance branch  
- Monthly / plans → `TblEmpBranchPayrollPlan`  
- Temporary transfer to-branch requires an active payroll plan for that date  

No payroll BranchID invented in 1Q beyond existing 1L ownership.
