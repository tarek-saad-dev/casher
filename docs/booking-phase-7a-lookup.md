# Booking Phase 7A — Lookup by Code

`GET /api/public/booking/{code}?phone=…&accessToken=…`

- Malformed / numeric codes → `INVALID_BOOKING_CODE` (no SQL).
- Missing booking / wrong phone / internal origin → `BOOKING_NOT_FOUND` or `BOOKING_NOT_FOUND_OR_UNAUTHORIZED` (no existence leak when proof supplied).
- Rate limit: 30/min/IP.
- CORS: `PUBLIC_CORS_HEADERS` on all outcomes.
- Cache: `no-store` (no long-lived booking cache).
