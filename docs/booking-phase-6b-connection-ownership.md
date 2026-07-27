# Booking Phase 6B — Connection ownership

See `booking-phase-6b-connection-ownership-audit.md`.

**Fix applied:** serialize `buildQueueIntervals` / `buildBookingIntervals` (and override loads) when running on a Transaction; `failHard` under TX so empty busy is never faked.
