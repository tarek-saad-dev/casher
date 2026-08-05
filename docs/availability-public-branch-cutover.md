# Public branch cutover

## Ready branches (2026-08-04)

| Branch | PUBLIC_LIVE | PublicBooking | QBS Booking | Discovery |
|--------|-------------|---------------|-------------|-----------|
| GLEEM | yes | yes | yes | yes |
| CAMP_CAESAR | yes | yes | yes | yes |

## Command

```bash
BOOKING_PUBLIC_CUTOVER=1 npx tsx scripts/activate-public-booking-cutover.ts
```

## Rollback

Set `QueueBookingSettings.BookingEnabled=0` per branch; or CAMP → `INTERNAL_LIVE` + `PublicBookingEnabled=0`.
