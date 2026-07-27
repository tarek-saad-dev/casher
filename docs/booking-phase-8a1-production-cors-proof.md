# Booking Phase 8A1 — Production CORS Proof

**Date:** 2026-07-27  
**Alias:** `https://casher-five.vercel.app`  
**Local HEAD (pre-Expose-Headers deploy):** `c00ad4a9154293afd1cc9baa39c3e14e3fc16800`  
**Vercel CLI / GitHub CLI:** not authenticated in this environment — deployment ID not retrievable from CLI  
**Operator-supplied Production env (manual):**

```env
PUBLIC_BOOKING_ALLOWED_ORIGINS=https://cutsaloon.com,https://www.cutsaloon.com
PUBLIC_BOOKING_CONTRACT_MODE=compat
```

## Root cause of prior Phase 8A CORS rejection

Phase 8A frontend probes failed with:

- GET `/api/public/branches` → 200 but **no ACAO**
- OPTIONS `/api/public/booking/create` → **403 `CORS_ORIGIN_NOT_ALLOWED`**

**Cause:** Production allowlist did not yet include (or was not yet applied for) `https://cutsaloon.com` / `https://www.cutsaloon.com`. Adding the env var alone does not update a stale deployment; after the operator configured Production/Preview env and a fresh deployment picked it up, ACAO/preflight started succeeding.

## Code change in this phase (not yet on production alias)

Central CORS module now emits:

```http
Access-Control-Expose-Headers: X-Booking-Contract-Version, X-Request-Id, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, Deprecation, Warning
```

File: `src/lib/booking/publicBookingCors.ts`  
Tests: `src/lib/__tests__/bookingPublicCorsPhase8a1.test.ts`

**Manual redeploy required** (no Vercel token / `gh` auth here):

1. Commit + push Casher `main` including the Expose-Headers change.
2. Confirm Vercel Production redeploy completes for project alias `casher-five.vercel.app`.
3. Re-probe GET `/api/public/branches` with `Origin: https://cutsaloon.com` and confirm `Access-Control-Expose-Headers` is present.
4. Re-run browser JS proof from `https://cutsaloon.com` (or `/dev/booking-api-proof` after frontend deploy).

## Live production probes (2026-07-27, alias `casher-five.vercel.app`)

### Root-domain GET

| Field | Result |
|---|---|
| Request | `GET /api/public/branches` + `Origin: https://cutsaloon.com` |
| Status | **200** |
| ACAO | `https://cutsaloon.com` |
| Vary | `Origin` |
| Contract | `X-Booking-Contract-Version: booking-public-v1` |
| Request ID | present (`pb-…`) |
| Rate limit | `X-RateLimit-Limit: 60` |
| Credentials | absent |
| Wildcard | absent |
| Expose-Headers | **MISSING on current production** |

### WWW-domain GET

| Field | Result |
|---|---|
| Origin | `https://www.cutsaloon.com` |
| Status | **200** |
| ACAO | `https://www.cutsaloon.com` (exact echo) |
| Vary | `Origin` |
| Credentials / wildcard | absent |

### Create OPTIONS (both origins)

| Origin | Status | Allow-Methods | Allow-Headers | Max-Age |
|---|---|---|---|---|
| `https://cutsaloon.com` | **204** | `POST, OPTIONS` | `Content-Type, Idempotency-Key` | `600` |
| `https://www.cutsaloon.com` | **204** | `POST, OPTIONS` | `Content-Type, Idempotency-Key` | `600` |

### Cancel OPTIONS

| Path | Status | Idempotency-Key allowed |
|---|---|---|
| `/api/public/booking/cancel` | **204** | yes |
| `/api/public/booking/BK-TEST/cancel` | **204** | yes (code irrelevant for OPTIONS) |

### Actual error-response CORS (no live booking created)

| Request | Status | Error code | ACAO | Contract | Request-Id | Cache-Control |
|---|---|---|---|---|---|---|
| POST check-slot `{}` | 400 | `BRANCH_REQUIRED` | exact | present | present | `no-store` |
| POST plan incomplete | 400 | `INVALID_DATE` | exact | present | present | `no-store` |
| POST create incomplete | 400 | `INVALID_CUSTOMER` | exact | present | present | `no-store` |

No SQL/internal stack traces in bodies.

### Disallowed origins (OPTIONS create)

All returned **403 `CORS_ORIGIN_NOT_ALLOWED`**, no ACAO, no allowlist leak:

- `https://example.com`
- `https://evilcutsaloon.com`
- `https://cutsaloon.com.evil.com`
- `http://cutsaloon.com`
- `Origin: null`

Disallowed GET `/branches` with `Origin: https://example.com` → **200** body, **no ACAO**, `Vary: Origin`.

### No-Origin GET

`GET /api/public/branches` without Origin → **200**, no ACAO required, not rejected.

## Browser-readable metadata proof

**Method:** Chrome DevTools `Runtime.evaluate` fetch from page origin `https://cutsaloon.com` against `https://casher-five.vercel.app/api/public/branches`.

| Check | Result |
|---|---|
| Cross-origin fetch succeeds | **yes** (`status: 200`, `ok: true`) |
| JS-visible header keys | only `cache-control`, `content-type` |
| `X-Booking-Contract-Version` | **null** (not exposed) |
| `X-Request-Id` | **null** |
| `X-RateLimit-*` | **null** |
| `Access-Control-Expose-Headers` | **null** |

**Verdict:** browser-readable metadata **NO-GO** until Expose-Headers redeploy lands.

After redeploy, re-check via:

1. Open `https://cutsaloon.com/dev/booking-api-proof` (frontend Phase 8A page; requires that frontend deploy), **or**
2. From DevTools on `https://cutsaloon.com`:

```js
const r = await fetch('https://casher-five.vercel.app/api/public/branches', { credentials: 'omit' });
console.log(r.headers.get('X-Booking-Contract-Version'));
console.log(r.headers.get('X-Request-Id'));
console.log(r.headers.get('X-RateLimit-Limit'));
```

Expected after Expose-Headers deploy: non-null contract version + request id; rate-limit readable when present.

## Camp Caesar / admin

| Probe | Result |
|---|---|
| Public branches list | only `GLEEM` |
| `config?branchCode=CAMP_CAESAR` | 404 `BRANCH_NOT_PUBLIC` |
| `services?branchCode=CAMP_CAESAR` | 404 `BRANCH_NOT_PUBLIC` |
| `/api/admin/branches` no auth | 401 |
| `?preview=true` | does not unlock Camp Caesar |

## Tests / build / ESLint (Casher)

| Command | Result |
|---|---|
| CORS Phase 8A1 + 7C1 suites | **31 passed** (8 files) + additional security/contract suites **15 passed** |
| `npx eslint` on touched CORS files | **clean** |
| `npm run build` | **PASS** |

## Verdicts

| Item | Verdict |
|---|---|
| Production environment | **GO** (operator-supplied; live probes confirm both origins) |
| Production deployment freshness (Expose-Headers code) | **NO-GO** (code change not deployed; CLI cannot redeploy) |
| Root-domain CORS | **GO** |
| WWW-domain CORS | **GO** |
| Create/cancel preflight | **GO** |
| Exposed metadata headers (server sends Expose-Headers) | **NO-GO** until redeploy |
| Browser-readable metadata | **NO-GO** until Expose-Headers redeploy |
| Admin/internal isolation | **GO** |
| Camp Caesar privacy | **GO** |
| Phase 8A final closure | **NO-GO** (blocked on Expose-Headers + browser re-proof) |
| Phase 8B UI migration | **GO** for ACAO/preflight-dependent UI work; treat metadata header reads as soft until Expose-Headers ships |
