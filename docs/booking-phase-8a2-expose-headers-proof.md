# Booking Phase 8A2 — Expose-Headers Proof

**Date:** 2026-07-27  
**Goal:** Make public booking metadata headers readable from browser JS on cutsaloon.com.

## Implementation

**Central module:** `src/lib/booking/publicBookingCors.ts`

```ts
export const PUBLIC_BOOKING_EXPOSED_HEADERS = [
  'X-Booking-Contract-Version',
  'X-Request-Id',
  'Retry-After',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
  'X-RateLimit-Reset',
  'Deprecation',
  'Warning',
] as const;
```

Applied once in `buildPublicBookingCorsHeaders` for allowed origins (GET/POST success, errors, 429). Not duplicated in route handlers. Routes use `gatePublicBookingRoute` → `withPublicBookingCors`.

## Expected response header

```
Access-Control-Expose-Headers: X-Booking-Contract-Version, X-Request-Id, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Deprecation, Warning
```

## Local verification

| Check | Result |
|---|---|
| Phase 8A2 tests | PASS |
| Phase 8A1 tests | PASS |
| Phase 7C1 CORS tests | PASS |
| `npm run build` | PASS |
| ESLint touched files | PASS |

## Production (fill after deploy)

| Probe | Result |
|---|---|
| GET `/api/public/branches` Origin root | pending |
| GET `/api/public/branches` Origin www | pending |
| Browser `headers.get('X-Booking-Contract-Version')` | pending |
| Typed client `contractUnverified === false` | pending |

## Security unchanged

- No wildcard ACAO
- No `Access-Control-Allow-Credentials`
- No cookies / credentials mode
- `PUBLIC_BOOKING_CONTRACT_MODE=compat`
- Camp Caesar remains non-public
