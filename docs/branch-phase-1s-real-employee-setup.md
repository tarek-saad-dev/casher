# Phase 1S-R — Real employee setup

## SUPERSEDED

Previous “no real operational employees” is **SUPERSEDED**.

## Live roster (BranchID=3)

| EmpID | Name | Days | Hours | Payroll | Target | Bookings |
|-------|------|------|-------|---------|--------|----------|
| 12 | زياد | **Friday only** | 11:00→01:30 | hourly **27.2727** | **NO_TARGET** (IsEnabled=0) | CanReceiveBookings=1 |

Assignment Notes include `services:…` eligibility list. IsHomeBranch=false (home remains GLEEM).

## Weekly coverage

Branch default hours imply open **every** weekday 11:00–01:30.

| Day | Coverage |
|-----|----------|
| Fri | Ziad — OK |
| Sun, Mon, Tue, Wed, Thu, Sat | **UNCOVERED** |

Readiness blocker: **`ops.weekly_employee_coverage`**

Do **not** invent other employee assignments. Ops must either staff those days or mark them closed (`TblBranchClosedWeekday` when used).

## UI

- `/admin/branches/3/setup/employees` — launch roster wizard
- `/admin/branches/3/setup/payroll-targets` — coverage dashboard
- Branch schedule: `/admin/hr/employees/{id}/branch-schedule`
- Legacy `PUT .../schedule` locked: `LEGACY_EMP_WORK_SCHEDULE_WRITE_LOCKED`
