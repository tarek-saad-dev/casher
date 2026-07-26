# Phase 1R — Transfer Conflict Policy

| Code | Effect |
|---|---|
| `TEMPORARY_TRANSFER_HAS_SOURCE_BOOKINGS` | Block — list bookings; no silent BranchID move |
| `TRANSFER_ATTENDANCE_CONFLICT` | Block open/completed attendance |
| `TRANSFER_ACTIVE_SERVICE_CONFLICT` | Block active queue |
| `TRANSFER_PAYROLL_ALREADY_GENERATED` | Block |
| `TRANSFER_LEDGER_ALREADY_POSTED` | Block |
| `TRANSFER_GLOBAL_LEAVE_BLOCKS` | Block — cancel day_off first |
| `EMPLOYEE_NOT_ASSIGNED_TO_BRANCH` | Destination assignment required |
| `EMPLOYEE_BRANCH_PAYROLL_PLAN_REQUIRED` | Destination payroll required |
| `TRANSFER_DESTINATION_NOT_OPERATIONAL` | SETUP / inactive destinations blocked (unless smokePreview) |

Precedence: global leave → temporary transfer → weekly branch schedule → day overrides → busy intervals.
