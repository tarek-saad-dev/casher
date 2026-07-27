# Booking Phase 6C — Cross-Branch Global Employee Race

## Live Scenario

One disposable global EmpID is assigned to both GLEEM (public) and Camp Caesar (non-public smoke branch). Two requests attempt the same absolute interval concurrently:

- **Public request** — `branchCode=GLEEM`, `purpose=public_booking`
- **Internal request** — `branchCode=CAMP_CAESAR`, `purpose=internal_preview` under a controlled `SmokeExecutionContext`

Both use the same `AbsoluteStartUtc` / `AbsoluteEndUtc`.

## Proven Outcomes

- Maximum one success.
- Second request returns `SLOT_UNAVAILABLE` or bounded `BOOKING_LOCK_TIMEOUT`.
- No duplicate booking for the same EmpID interval.
- Camp Caesar remains non-public; no public discovery or public booking path exposes it.

## Locking Mechanics

- The global EmpID interval applock key is `booking:emp:{empId}:{startMs}:{endMs}`.
- The lock is intentionally not scoped by `BranchID`.
- A lock acquired on GLEEM blocks the Camp Caesar insert, and vice versa.

## Internal Preview Safety

- `internal_preview` requires a valid `auth` object and is only usable from smoke/verifier code.
- The public `/api/public/booking/create` route never forwards an `auth` or `purpose` override.
- Camp Caesar `LifecycleStatus` is `SMOKE_TEST` or `SETUP` only.

## Files

- `src/lib/__tests__/bookingCreateCrossBranchGlobalRace.test.ts`
- `src/lib/__tests__/helpers/phase6cSmokeHarness.ts`
- `scripts/verify-booking-phase6c-final-proof.ts`
