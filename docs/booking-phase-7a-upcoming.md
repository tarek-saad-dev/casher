# Booking Phase 7A — Upcoming Bookings

`POST /api/public/booking/upcoming` body: `{ phone, fromDate?, limit? }`

- Phone via `normalizePublicBookingPhone`.
- Empty list is success (`bookings: []`) — same shape for unknown vs zero upcoming.
- Excludes cancelled/completed/no_show via status mapper; requires future `AbsoluteEndUtc` (or legacy BookingDate).
- Limit default 10, max 25.
- Rate limit: **15/min/IP** (stricter).
- No branchCode required (owned bookings remain readable across discovery changes).
- OTP deferred (future hardening).
