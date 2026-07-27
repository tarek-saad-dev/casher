# Booking Phase 6C — Smoke Results and Artifacts

## Smoke Run Registry

Every Phase 6C execution writes a real row to `dbo.TblBranchSmokeRun`:

- **Phase:** `booking-phase-6c-final-create-proof`
- **Status:** `PASSED` or `FAILED`
- **ResultJson:** per-scenario metrics, DB assertion counts, and verdicts
- **Artifacts:** disposable EmpIDs, booking codes, idempotency keys, schedules, payroll plans

## Recorded Metrics

For each scenario:

- Scenario name
- HTTP/result code
- Booking count
- Distinct booking codes
- Distinct EmpIDs
- Overlap count
- Booking detail count
- Idempotency status
- Customer count
- Notification attempt count
- Pool error flag
- Deadlock flag

## Post-Cleanup Invariants

- `active Phase 6C bookings = 0`
- `active Phase 6C employees = 0`
- `active Phase 6C assignments = 0`
- `active Phase 6C schedules = 0`
- `Phase 6C idempotency leftovers = 0`
- `real GLEEM bookings changed = 0`
- `real Camp Caesar data changed = 0`

## Files

- `src/lib/__tests__/helpers/phase6cSmokeHarness.ts`
- `scripts/verify-booking-phase6c-final-proof.ts`
- `scripts/branch-smoke/_booking-phase6c-final-proof.json`
