# Booking Phase 4 — Busy intervals

Engine uses `buildQueueIntervals` (waiting/called/in_service) + `buildBookingIntervals` (active bookings) globally per EmpID. Half-open overlap via `intervalsOverlap`. Cancelled/inactive excluded by those builders. Cross-branch: one EmpID busy timeline is not branch-scoped.
