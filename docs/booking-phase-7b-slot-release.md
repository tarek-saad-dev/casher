# Booking Phase 7B — Slot Release

Cancel sets `Status=cancelled` (lowercase). `buildBookingIntervals` / busy engines use `LOWER(Status) IN (active…)` — cancelled rows stop blocking.

Post-commit:
1. Invalidate availability (+ barber-related) caches
2. Probe intervals for booking ID absence → `bookingBlockRemoved`
3. Optional `assertEmployeeIntervalAvailable` → `currentlyAvailable` (may be false for queue/override/schedule)

Does **not** promise the slot stays free forever.
