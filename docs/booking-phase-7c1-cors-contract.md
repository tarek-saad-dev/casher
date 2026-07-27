# Booking Phase 7C1 — CORS Contract

**Module:** `src/lib/booking/publicBookingCors.ts`

| Scenario | Behavior |
|---|---|
| Allowed Origin | `Access-Control-Allow-Origin: <exact>` + `Vary: Origin` |
| Disallowed Origin GET/POST | Response proceeds; **no** ACAO |
| Disallowed Origin OPTIONS | **403** `CORS_ORIGIN_NOT_ALLOWED`; no ACAO |
| Missing Origin | Proceed; no ACAO |
| `Origin: null` | Disallowed (not missing) |
| Credentials | Never set |

`Access-Control-Max-Age`: **600** seconds on successful preflight.
