# Booking Phase 2 — Public services catalog

**Endpoint:** `GET /api/public/booking/services?branchCode=GLEEM`  
**Module:** `src/lib/booking/publicBookingServices.ts`  
**Policy:** `src/lib/booking/publicBookingServicePolicy.ts`

## Behavior

1. Resolve branch via `resolvePublicBookingBranchContext({ purpose: 'public_booking' })` — no GLEEM fallback.
2. Reject when booking flags off → `BRANCH_BOOKING_DISABLED`.
3. Load global `TblPro` + `TblCat`, filter with `isServiceEligibleForPublicBooking`.
4. Return nested categories + flat `services`/`groups` (GLEEM widget compatibility).
5. `pricingScope: "global"` — GLEEM and Camp Caesar share prices; Camp Caesar still cannot call the API.

## Expected statuses

| Call | Result |
|------|--------|
| no branchCode | 400 `BRANCH_REQUIRED` |
| GLEEM | 200 catalog (~30 services) |
| CAMP_CAESAR | 404 `BRANCH_NOT_PUBLIC` |
| UNKNOWN | 404 `BRANCH_NOT_FOUND` |

## CORS

`PUBLIC_CORS_HEADERS` currently uses `Access-Control-Allow-Origin: *` (wildcard). Full origin allowlist deferred. OPTIONS → 204 with same headers. Errors (400/404/409/429/500) include CORS.
