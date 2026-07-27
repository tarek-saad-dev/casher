# Booking Phase 8A2 — Expose-Headers Proof

**Date:** 2026-07-27  
**Commit:** `39e1e9e064e018d980d4bb791e2237b8d59bff5e`  
**Alias:** `https://casher-five.vercel.app`  
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

Applied once in `buildPublicBookingCorsHeaders` for allowed origins (GET/POST success, errors, 429, OPTIONS). Not duplicated in route handlers. Routes use `gatePublicBookingRoute` → `withPublicBookingCors`.

## Local verification

| Check | Result |
|---|---|
| Phase 8A2 tests (18) | **PASS** |
| Phase 8A1 tests | **PASS** |
| Phase 7C1 CORS / RL tests | **PASS** (57 total across suite) |
| `npm run build` | **PASS** |
| ESLint touched files | **PASS** |

## Production deployment

| Field | Value |
|---|---|
| Push | `main` `c00ad4a..39e1e9e` |
| Commit SHA | `39e1e9e064e018d980d4bb791e2237b8d59bff5e` |
| Vercel CLI | unavailable (no credentials) — freshness proven by live header change |
| Freshness proof | Pre-deploy: `Access-Control-Expose-Headers` empty; post-deploy: full list present |
| Env | `PUBLIC_BOOKING_ALLOWED_ORIGINS=https://cutsaloon.com,https://www.cutsaloon.com` |
| Contract mode | `compat` (unchanged) |

## Production GET probes

### Root origin

| Field | Result |
|---|---|
| Status | **200** |
| ACAO | `https://cutsaloon.com` |
| Expose-Headers | full required list |
| Contract | `booking-public-v1` |
| Request-Id | present (`pb-…`) |
| RateLimit-Limit | `60` |
| Credentials / wildcard | absent |

### WWW origin

| Field | Result |
|---|---|
| Status | **200** |
| ACAO | `https://www.cutsaloon.com` |
| Expose-Headers | same full list |
| Credentials / wildcard | absent |

## OPTIONS

| Route | Origin | Status | Allow-Headers |
|---|---|---|---|
| create | root | **204** | Content-Type, Idempotency-Key |
| cancel | www | **204** | Content-Type, Idempotency-Key |
| `[code]/cancel` | root | **204** | Content-Type, Idempotency-Key |

## Error response

`POST /api/public/booking/check-slot` `{}` + Origin root:

- Status **400**, nested `BRANCH_REQUIRED`
- Exact ACAO + full Expose-Headers
- `X-Booking-Contract-Version`, `X-Request-Id`, `Cache-Control: no-store`

## Browser proof (real page origin `https://cutsaloon.com`)

```js
const response = await fetch(
  "https://casher-five.vercel.app/api/public/branches",
  { credentials: "omit", cache: "no-store" }
);
```

| Field | Result |
|---|---|
| status | **200** |
| `X-Booking-Contract-Version` | `booking-public-v1` |
| `X-Request-Id` | non-null (`pb-…`) |
| `X-RateLimit-Limit` | `60` |
| CORS error | **none** |

## Typed client semantics (browser-equivalent metadata)

| Field | Result |
|---|---|
| `metadata.contractVersion` | `booking-public-v1` |
| `metadata.contractUnverified` | **false** |
| `metadata.requestId` | populated |
| `metadata.rateLimit.limit` | **60** |
| `/dev/booking-api-proof` page | **404** on production cutsaloon.com (proof via live fetch instead) |

## Security regression

| Check | Result |
|---|---|
| `/api/admin/branches` no auth | **401** |
| Public branches | **GLEEM only** |
| CAMP_CAESAR config | **BRANCH_NOT_PUBLIC** |
| `preview=true` Camp Caesar | **BRANCH_NOT_PUBLIC** |
| example.com / evil / suffix / http / null OPTIONS | **403**, no ACAO |
| Missing Origin | **200**, no ACAO |
| Wildcard / credentials | absent |
| Contract mode | remains **compat** |

## Verdicts

| Gate | Verdict |
|---|---|
| Expose-Headers local implementation | **GO** |
| Tests/build/ESLint | **GO** |
| Production deployment freshness | **GO** (header flip observed) |
| Production Expose-Headers | **GO** |
| Browser-readable contract metadata | **GO** |
| Typed client contract verification | **GO** (browser metadata semantics) |
| Admin/internal isolation | **GO** |
| Camp Caesar privacy | **GO** |
| Phase 8A final closure | **GO** |
| Phase 8B UI migration | **GO** (may begin; do not flip enforce yet) |
