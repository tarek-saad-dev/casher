# Booking Phase 7B — Ownership

Reuses Phase 7A primitives (`normalizePublicBookingPhone`, `digestNormalizedPhone`, `verifyBookingAccessToken`).

| Proof | Cancel allowed |
|---|---|
| code only | **No** |
| code + phone | Yes (normalized match) |
| code + bookingAccessToken | Yes (code + phoneDigest bind) |
| wrong phone / wrong token | `BOOKING_NOT_FOUND_OR_UNAUTHORIZED` (generic) |
| numeric BookingID | `INVALID_BOOKING_CODE` |

Token cannot cancel another booking code. Expired → `BOOKING_ACCESS_TOKEN_EXPIRED`.
