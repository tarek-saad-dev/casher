# Booking Phase 7C2 — Error Status Matrix

**Source:** `PUBLIC_BOOKING_ERROR_CATALOG` · **Test:** `src/lib/__tests__/bookingPublicErrorStatusMatrix.test.ts`

## Status class distribution (67 codes)

| HTTP | Count | Role |
|---|---|---|
| 200 | 1 | Idempotent cancel already done (`BOOKING_ALREADY_CANCELLED`) |
| 400 | 18 | Client / contract validation |
| 401 | 2 | Access token invalid/expired |
| 403 | 1 | CORS origin not allowed |
| 404 | 5 | Not found / not public (incl. Camp Caesar as `BRANCH_NOT_PUBLIC`) |
| 409 | 29 | Business conflict / availability / cancel policy |
| 429 | 1 | Rate limit |
| 500 | 8 | Unexpected / generation failures |
| 503 | 2 | Transient read unavailability |

## Exclusive mappings (enforced by tests)

| Status | Only code |
|---|---|
| 429 | `RATE_LIMIT_EXCEEDED` |
| 403 | `CORS_ORIGIN_NOT_ALLOWED` |

## Key contract statuses

| Code | Status |
|---|---|
| BRANCH_REQUIRED | 400 |
| BRANCH_NOT_FOUND | 404 |
| BRANCH_NOT_PUBLIC | 404 |
| PLAN_TOKEN_REQUIRED | 400 |
| IDEMPOTENCY_KEY_REQUIRED | 400 |
| LEGACY_BOOKING_CONTRACT_DISABLED | 400 |
| RATE_LIMIT_EXCEEDED | 429 |
| CORS_ORIGIN_NOT_ALLOWED | 403 |
| BOOKING_ACCESS_TOKEN_INVALID | 401 |
| BOOKING_ACCESS_TOKEN_EXPIRED | 401 |
| BOOKING_LOOKUP_UNAVAILABLE | 503 |
| UPCOMING_BOOKINGS_UNAVAILABLE | 503 |
| BOOKING_ALREADY_CANCELLED | 200 |
| SLOT_UNAVAILABLE | 409 |
| BOOKING_CREATE_FAILED | 500 |

## Gate vs catalog

`finalizePublicBookingError` always uses `def.httpStatus` from the catalog — routes must not invent alternate statuses for catalogued codes.
