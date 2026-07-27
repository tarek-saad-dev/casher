# Booking Phase 7C1 — CORS Audit

**Date:** 2026-07-27 · **Scope:** Casher backend public booking surface

## Findings summary

| Issue | Severity | Action |
|---|---|---|
| `PUBLIC_CORS_HEADERS` uses `Access-Control-Allow-Origin: *` | Critical | Replace with allowlist module |
| Broad methods `GET, POST, OPTIONS` on every route | Medium | Route-specific matrix |
| `Idempotency-Key` advertised globally (ok) but no `Vary: Origin` | Medium | Add Vary |
| `publicBookingErrorResponse` always wildcard CORS | High | Request-aware CORS |
| OPTIONS ignores request Origin | High | Origin-aware preflight |
| Rate-limit 429 uses wildcard CORS | High | Merge allowlist CORS |
| Proxy: `/api/public/*` is anonymous_public | OK | No login 401 before CORS |
| Non-booking `/api/public/client/*` still wildcard | Out of scope | Documented; not booking |
| `x-public-booking-key` advertised unused | Low | Drop from booking allow headers |

## Route matrix (pre-migration)

| Route | Methods | ACAO | OPTIONS | Errors CORS | Rate limit | Migration |
|---|---|---|---|---|---|---|
| GET /api/public/branches | GET+OPTIONS | * | static * | * | before handler | allowlist |
| GET …/booking/config | GET+OPTIONS | * | static * | * | yes | allowlist |
| GET …/booking/status | GET+OPTIONS | * | static * | * | yes | allowlist |
| GET …/booking/services | GET+OPTIONS | * | static * | * | yes | allowlist |
| GET …/booking/barbers | GET+OPTIONS | * | static * | * | yes | allowlist |
| GET …/barbers/[empId]/calendar | GET+OPTIONS | * | static * | * | yes | allowlist |
| GET …/location | GET+OPTIONS | * | static * | * | yes | allowlist |
| GET …/available-slots (barber) | GET+OPTIONS | * | static * | * | yes | allowlist |
| GET …/available-days | GET+OPTIONS | * | static * | * | yes | allowlist |
| GET …/available-slots | GET+OPTIONS | * | static * | * | yes | allowlist |
| GET …/booking/[code] | GET+OPTIONS | * | static * | * | yes | allowlist + Auth header |
| POST …/check-slot | POST+OPTIONS | * | static * | * | yes | allowlist |
| POST …/plan | POST+OPTIONS | * | static * | * | yes | allowlist |
| POST …/create | POST+OPTIONS | * | static * | * | yes | allowlist + Idempotency-Key |
| POST …/upcoming | POST+OPTIONS | * | static * | * | yes | allowlist |
| POST …/cancel | POST+OPTIONS | * | static * | * | yes | allowlist + Idempotency-Key |
| POST …/[code]/cancel | POST+OPTIONS | * | static * | * | yes | allowlist + Idempotency-Key |

## Proxy

`proxy.ts` + `proxyPublicRoutes.ts`: `/api/public/` is `anonymous_public` → `NextResponse.next()`. Admin remains session-required. Origin cannot bypass auth or enable Camp Caesar.
