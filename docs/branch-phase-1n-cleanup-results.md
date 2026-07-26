# Phase 1N — Cleanup Results

- FK-safe delete order: ledger → targets/payroll/attendance → booking/queue → inventory → invoice detail/payment → CashMove → head → plans/assignments → shift/day
- Masters: smoke employees deactivated; smoke products soft-deleted (`isDeleted=1`)
- `cleanupBranchSmokeRun` restored SETUP / IsActive=0 / public off
- Post-cleanup operational counts on BranchID=3 = 0 for bookings, queue, attendance, payroll, ledger, targets, cash, inventory, pending artifacts
- Smoke run history retained (CLEANED)
- GLEEM untouched
