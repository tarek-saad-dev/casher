# Booking Phase 6C — Mid-Transaction Rollback and Retry

## Injection Hook

A verifier-only hook `postBookingHeadInsert` is armed only when `BOOKING_PHASE_6C_VERIFIER=enabled`. It is impossible to arm from a public production request.

The hook is invoked after the `Bookings` head row insert and before any `BookingServices` details are written.

## Expected Rollback

When the hook throws:

- The SQL transaction rolls back.
- `BookingServices` count = 0.
- No customer mutation persists.
- Idempotency row stays `FAILED` / retryable (not `SUCCESS`).
- No cache invalidation, no WhatsApp scheduling, no audit claiming a confirmed booking.

## Retry Behavior

Retrying the same idempotency key with the hook disabled:

- Reclaims the `FAILED` idempotency row.
- Inserts one successful booking with a complete detail set.
- Safely reuses the same key without duplicate customer creation.
- Schedules at most one post-commit notification.

## Files

- `src/lib/booking/publicBookingCreate.ts` — `setBookingCreateTestHooks`, `postBookingHeadInsert`
- `src/lib/__tests__/bookingCreateRollbackRetryLive.test.ts`
- `scripts/verify-booking-phase6c-final-proof.ts`
