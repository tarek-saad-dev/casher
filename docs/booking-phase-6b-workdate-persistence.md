# Booking Phase 6B — WorkDate persistence

Dedicated nullable columns on `dbo.Bookings`:

| Column | Purpose |
|--------|---------|
| PublicWorkDate | Opening WorkDate |
| PublicDayOffset | 0 \| 1 |
| AbsoluteStartUtc | Absolute interval start |
| AbsoluteEndUtc | Absolute interval end |
| PlanFingerprint | Optional plan digest |
| IdempotencyRequestID | FK-ish to create request |

Migration: `db/migrations/add-booking-public-workdate-columns.sql`  
Runtime ensure: `ensureBookingPublicWorkDateColumns()`

Legacy rows may have NULL — Phase 7 readers should fall back to `BookingDate`/`StartTime`/`Notes` `[p6]` meta only when columns are null.
