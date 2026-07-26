# Phase 1R — Booking / Attendance / Payroll Integration

- Booking create/slots already use resolvers → transfer reflected as `BARBER_AVAILABLE_AT_DIFFERENT_BRANCH` at source.
- Attendance check-in requires schedule at session branch → source rejected, destination allowed.
- Transfer itself creates no financial rows; payroll/ledger inherit attendance BranchID later.
- Public APIs still hide SETUP branches (Camp Caesar).
