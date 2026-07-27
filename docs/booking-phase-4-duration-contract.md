# Booking Phase 4 — Duration contract

`src/lib/booking/bookingServiceDuration.ts` → `resolveSelectedBookingServices`

- Every ID must be in Phase-2 public catalog
- Positive `durationMinutes`, numeric price
- No emp override / system default / name match
- Public availability always passes `durationOverride: totalDurationMinutes` into the engine
