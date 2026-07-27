# Booking Phase 5 — Check-slot

**Route:** `POST /api/public/booking/check-slot`

## Behavior

Canonical evaluator (`purpose: check_slot`). No reservation.

## Compatibility

Business unavailability → **HTTP 200** `{ ok: true, available: false, reason: { code, message } }`.

Malformed / branch / service / barber resource errors → nested Phase-1 error + catalog HTTP status.

## CORS

`OPTIONS` 204 + `PUBLIC_CORS_HEADERS` on all responses including errors/rate-limit.
