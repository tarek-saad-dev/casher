# Booking Phase 4 — Available slots

`GET /api/public/booking/available-slots` and `GET /api/public/booking/barbers/{empId}/available-slots` share `getPublicAvailableSlots`.

Slots include candidate `barbers[]` (merged unique times). Duration = sum of Phase-2 `DurationMinutes`. Ops/admin `source=` still uses legacy engine duration resolution.
