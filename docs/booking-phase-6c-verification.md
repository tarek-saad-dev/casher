# Booking Phase 6C — Verification

## Command Reference

```powershell
# 1. Run the full live verifier (requires cloud DB connection)
$env:BOOKING_PHASE_6C_VERIFIER = 'enabled'
npx tsx scripts/verify-booking-phase6c-final-proof.ts

# 2. Run targeted Phase 6C unit/integration tests
npx vitest run src/lib/__tests__/bookingCreateAnyVsSpecificLive.test.ts
npx vitest run src/lib/__tests__/bookingCreateCrossBranchGlobalRace.test.ts
npx vitest run src/lib/__tests__/bookingCreateRollbackRetryLive.test.ts
npx vitest run src/lib/__tests__/bookingCreateMultiServiceOverlap.test.ts
npx vitest run src/lib/__tests__/bookingCreateOvernightEquivalent.test.ts
npx vitest run src/lib/__tests__/bookingCreateCodeCollision.test.ts
npx vitest run src/lib/__tests__/bookingCreateSmokeRegistry.test.ts

# 3. Regression suites
npx vitest run src/lib/__tests__/bookingCreateConnectionOwnership.test.ts
npx vitest run scripts/verify-booking-create-concurrency.ts

# 4. Build and lint
npm run build
npx eslint src/lib/booking/publicBookingCreate.ts src/lib/booking/publicBookingSelectionEvaluator.ts src/lib/booking/publicBookingBarbers.ts src/lib/booking/publicBookingAvailability.ts src/lib/booking/publicBookingBarberPolicy.ts src/lib/hr/testEmployeePolicy.ts src/lib/__tests__/helpers/phase6cSmokeHarness.ts src/lib/__tests__/bookingCreate*.test.ts scripts/verify-booking-phase6c-final-proof.ts
```

## Verifier Failure Conditions

The script `verify-booking-phase6c-final-proof.ts` fails if:

- No `TblBranchSmokeRun` row is created.
- Any-vs-specific is not executed live.
- Cross-branch race is not executed live.
- Rollback injection is not executed.
- Retry after rollback fails.
- Overlapping multi-service bookings exist.
- Equivalent overnight interval duplicates exist.
- Code collision handling is unproven.
- Pool acquisition or deadlock occurs without a safe mapped response.
- Cleanup is incomplete.
- GLEEM real data changed.
- Camp Caesar becomes public.

## Design-Only vs Live-Proven

Statements in the design and contract docs are marked separately from live-proven metrics in `ResultJson`.
