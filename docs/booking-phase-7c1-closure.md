# Booking Phase 7C1 — Closure

**Status:** OPEN items remain for Phase 8A1 Expose-Headers redeploy

## Delivered (7C1)

- Central CORS: `src/lib/booking/publicBookingCors.ts`
- All public booking + branches routes migrated off wildcard
- Env: `PUBLIC_BOOKING_ALLOWED_ORIGINS` (documented in `.env.example`)
- Docs under `docs/booking-phase-7c1-*`

## Phase 8A1 update (2026-07-27)

- Production allowlist confirmed live for root + www cutsaloon.com
- Create/cancel Idempotency-Key preflight confirmed on production alias
- Central `Access-Control-Expose-Headers` added in code; **not yet on production alias** (Vercel CLI unavailable — manual redeploy required)
- Browser JS on `https://cutsaloon.com` can call the API but **cannot** yet read contract/request-id/rate-limit headers

See: `docs/booking-phase-8a1-production-cors-proof.md`

## Remaining

- Redeploy Casher Production with Expose-Headers change
- Re-run browser-readable header proof from cutsaloon.com
- Frontend Phase 8B UI migration (separate repo)
- Keep `PUBLIC_BOOKING_CONTRACT_MODE=compat` until frontend cutover
