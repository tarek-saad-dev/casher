# Booking Phase 6C — Overnight Equivalent Representation Protection

## Canonical Rule

An after-midnight slot belonging to opening WorkDate `D` is requested as:

- `WorkDate = D`
- `time = 00:15`
- `dayOffset = 1`

## Invalid Representation

The same absolute slot represented as:

- `WorkDate = D+1`
- `time = 00:15`
- `dayOffset = 0`

is rejected because it does not belong to the requested branch operating window.

## Proven Invariants

- Exactly one active booking exists for the absolute interval.
- `PublicWorkDate`, `PublicDayOffset`, `AbsoluteStartUtc`, and `AbsoluteEndUtc` are persisted.
- The booking date stored in `Bookings.BookingDate` is the actual calendar date `D+1`.
- No duplicate slot appears under two business dates.

## Files

- `src/lib/__tests__/bookingCreateOvernightEquivalent.test.ts`
- `scripts/verify-booking-phase6c-final-proof.ts`
