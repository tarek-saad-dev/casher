# Booking Phase 6C — Booking-Code Collision Handling

## Injection Hook

A verifier-only `generateBookingCode` hook is armed only when `BOOKING_PHASE_6C_VERIFIER=enabled`.

## Bounded Retry Case

When the first generated code collides with an existing controlled smoke booking:

- The unique constraint detects the collision.
- The create flow catches the SQL error and retries with a new code.
- Booking succeeds exactly once.
- No raw SQL error leaks to the public response.

## Exhausted Retry Case

When every retry collides (hook always returns the same code):

- After `CODE_ATTEMPTS` the create flow throws `BOOKING_CODE_GENERATION_FAILED`.
- Zero partial booking rows are inserted.
- Idempotency remains `FAILED` / retryable.
- No WhatsApp scheduling, no cache invalidation.

## Files

- `src/lib/booking/publicBookingCreate.ts` — `CODE_ATTEMPTS`, `BOOKING_CODE_GENERATION_FAILED`
- `src/lib/__tests__/bookingCreateCodeCollision.test.ts`
- `scripts/verify-booking-phase6c-final-proof.ts`
