# Phase 1R — Transfer Conflict Policy

| Code | Effect |
|---|---|
| `TEMPORARY_TRANSFER_HAS_SOURCE_BOOKINGS` | Soft / forceable — list bookings; no silent BranchID move |
| `TRANSFER_ATTENDANCE_CONFLICT` | Hard — open attendance |
| `TRANSFER_ATTENDANCE_COMPLETED` | Relocatable with `relocateAttendance` (past-date correction) |
| `TRANSFER_ACTIVE_SERVICE_CONFLICT` | Hard — active queue |
| `TRANSFER_PAYROLL_ALREADY_GENERATED` | Relocatable with `relocateAttendance` (non-posted) |
| `TRANSFER_PAYROLL_ALREADY_POSTED` | Hard — void cash post first |
| `TRANSFER_LEDGER_ALREADY_POSTED` | Hard when posted payroll present |
| `TRANSFER_GLOBAL_LEAVE_BLOCKS` | Hard — cancel day_off first |
| `EMPLOYEE_NOT_ASSIGNED_TO_BRANCH` | Soft / forceable |
| `EMPLOYEE_BRANCH_PAYROLL_PLAN_REQUIRED` | Soft / forceable |
| `EMPLOYEE_BOOKING_SERVICES_REQUIRED` | Soft / forceable |
| `TRANSFER_DESTINATION_NOT_OPERATIONAL` | Hard — SETUP / inactive (unless smokePreview) |

**HR full page:** `/admin/hr/branch-transfer` — date picker (including past), preview, force + relocate, history.

Precedence: global leave → temporary transfer → weekly branch schedule → day overrides → busy intervals.
