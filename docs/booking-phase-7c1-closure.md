# Booking Phase 7C1 — Closure

**Status:** CLOSED for CORS allowlist; Phase 8A2 Expose-Headers **GO** (2026-07-27)

## Delivered (7C1)

- Central CORS: `src/lib/booking/publicBookingCors.ts`
- All public booking + branches routes migrated off wildcard
- Env: `PUBLIC_BOOKING_ALLOWED_ORIGINS` (documented in `.env.example`)
- Docs under `docs/booking-phase-7c1-*`

## Phase 8A1 / 8A2 update (2026-07-27)

- Production allowlist confirmed live for root + www cutsaloon.com
- Create/cancel Idempotency-Key preflight confirmed on production alias
- Central `Access-Control-Expose-Headers` shipped in commit `39e1e9e` and verified on production
- Browser JS on `https://cutsaloon.com` can read contract / request-id / rate-limit headers

See: `docs/booking-phase-8a2-expose-headers-proof.md`

## Remaining (not 7C1 / 8A blockers)

- Frontend Phase 8B UI migration (BookingModal etc.) — separate task
- Keep `PUBLIC_BOOKING_CONTRACT_MODE=compat` until frontend cutover
