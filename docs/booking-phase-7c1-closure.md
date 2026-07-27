# Booking Phase 7C1 — Closure

**Status:** CLOSED — CORS probe PASSED

## Delivered

- Central CORS: `src/lib/booking/publicBookingCors.ts`
- All public booking + branches routes migrated off wildcard
- Env: `PUBLIC_BOOKING_ALLOWED_ORIGINS` (documented in `.env.example`)
- Docs under `docs/booking-phase-7c1-*`

## Remaining Phase 7C2

- Mandatory Idempotency-Key / clientRequestId cutover
- Rate-limit hardening contract
- cutsaloon.com frontend CORS/integration cutover
- Optional OTP / notification outbox (out of 7C1)
