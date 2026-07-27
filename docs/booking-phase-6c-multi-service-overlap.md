# Booking Phase 6C — Multi-Service Overlap Boundaries

## Live Scenario

A booking with three services totaling 90 minutes is created for a disposable barber. Competing bookings are attempted for the same EmpID:

| Competitor | Start | Policy |
|---|---|---|
| A | same start | rejected |
| B | 30 min inside | rejected |
| C | 89 min inside | rejected |
| D | exactly at first end | allowed (half-open) |
| E | ends exactly at first start | allowed (half-open) |

## Assertions

All decisions are based on `AbsoluteStartUtc` and `AbsoluteEndUtc`, not on `WorkDate` / `time` strings alone.

- Half-open interval semantics: `[start, end)` means a slot starting exactly at the previous end does not overlap.
- Overlap at `start + 89` minutes is still an overlap and is rejected.
- Service duration is resolved from the branch catalog; total duration is 90 minutes in the test fixture.

## Files

- `src/lib/__tests__/bookingCreateMultiServiceOverlap.test.ts`
- `scripts/verify-booking-phase6c-final-proof.ts`
