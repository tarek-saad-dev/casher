# Booking Phase 7A — Booking Access Token

Minted on successful public create (`booking.bookingAccessToken`) and refreshed on owned lookup.

| Field | Content |
|---|---|
| contractVersion | `booking-access-v1` |
| bookingCode | Uppercase public code |
| phoneDigest | SHA-256 of normalized phone (no raw phone) |
| issuedAt / exp | Unix seconds |

- Signed with `SESSION_SECRET` (same HMAC pattern as plan tokens).
- TTL: **30 days**; renewal = re-issue on lookup/create.
- Not a reservation; cannot create/modify other bookings.
- Mismatch code → invalid; expired → `BOOKING_ACCESS_TOKEN_EXPIRED`.
