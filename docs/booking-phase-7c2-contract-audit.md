# Booking Phase 7C2 — Contract Audit

**Date:** 2026-07-27 · **Contract:** `booking-public-v1` · **Default mode:** `compat`

Audited against `gatePublicBookingRoute`, `PUBLIC_BOOKING_ROUTE_RATE_FAMILY`, `PUBLIC_BOOKING_ROUTE_CORS`, and the 17 public booking route handlers.

## Shared response contract (all gated routes)

| Header / field | Value |
|---|---|
| `X-Booking-Contract-Version` | `booking-public-v1` |
| `X-Request-Id` | `pb-{uuid}` (echoed if valid inbound) |
| `X-RateLimit-Limit` / `Remaining` / `Reset` | From central policy |
| `Retry-After` | On 429 only |
| `Cache-Control` | `no-store` (default finalize) |
| `Deprecation` / `Warning` | Only when legacy create contract accepted |

## Per-route audit (17 routes)

| # | Path | Methods | Route key | RL family | Limit / 60s | Subject-aware | Gate | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | `GET /api/public/branches` | GET+OPTIONS | `branches` | discovery | 60 | no | yes | Excludes Camp Caesar / non-discoverable |
| 2 | `GET /api/public/booking/config` | GET+OPTIONS | `config` | discovery | 60 | no | yes | Branch-scoped; `BRANCH_NOT_PUBLIC` for Camp Caesar |
| 3 | `GET /api/public/booking/status` | GET+OPTIONS | `status` | discovery | 60 | no | yes | Camp Caesar → `BRANCH_NOT_PUBLIC` |
| 4 | `GET /api/public/booking/services` | GET+OPTIONS | `services` | catalog | 45 | no | yes | No GLEEM fallback; Camp Caesar blocked |
| 5 | `GET /api/public/booking/barbers` | GET+OPTIONS | `barbers` | barbers | 45 | no | yes | |
| 6 | `GET …/barbers/[empId]/calendar` | GET+OPTIONS | `calendar` | availability | 30 | no | yes | Range ≤ 31 days |
| 7 | `GET …/barbers/[empId]/location` | GET+OPTIONS | `location` | barbers | 45 | no | yes | |
| 8 | `GET …/barbers/[empId]/available-slots` | GET+OPTIONS | `barber-available-slots` | availability | 30 | no | yes | |
| 9 | `GET …/booking/available-days` | GET+OPTIONS | `available-days` | available-days | 20 | no | yes | Parallel days + preloaded context (7C2) |
| 10 | `GET …/booking/available-slots` | GET+OPTIONS | `available-slots` | availability | 30 | no | yes | |
| 11 | `POST …/booking/check-slot` | POST+OPTIONS | `check-slot` | validation | 20 | no | yes | |
| 12 | `POST …/booking/plan` | POST+OPTIONS | `plan` | plan | 15 | no | yes | Mints `planToken` |
| 13 | `POST …/booking/create` | POST+OPTIONS | `create` | create | 8 | no | yes | Compat: legacy plan/idempotency accepted; enforce: required |
| 14 | `GET …/booking/[code]` | GET+OPTIONS | `lookup` | lookup | 30 | yes (code digest) | yes | Auth / phone ownership |
| 15 | `POST …/booking/upcoming` | POST+OPTIONS | `upcoming` | upcoming | 15 | yes (phone digest) | yes | Batch service lines (7C2) |
| 16 | `POST …/booking/cancel` | POST+OPTIONS | `cancel` | cancel | 10 | yes (code digest) | yes | Body `code`; Idempotency-Key |
| 17 | `POST …/booking/[code]/cancel` | POST+OPTIONS | `cancel-by-code` | cancel | 10 | yes (code digest) | yes | Preferred cancel path |

## Legacy rate helpers

All 17 routes use `gatePublicBookingRoute`. None call legacy `getRateLimitKey` / `checkRateLimit` (verified by `scripts/verify-booking-phase7c2-readiness.ts`).

## Camp Caesar

Must remain non-public: discovery list omits it; branch-scoped routes resolve via `isPubliclyDiscoverable` → `BRANCH_NOT_PUBLIC` (HTTP 404). CORS allowlist cannot enable Camp Caesar.
