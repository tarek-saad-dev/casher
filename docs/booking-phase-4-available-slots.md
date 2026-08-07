# Booking Phase 4 — Available slots

`GET /api/public/booking/available-slots` and `GET /api/public/booking/barbers/{empId}/available-slots` share `getPublicAvailableSlots`.

Slots include candidate `barbers[]` (merged unique times). Duration = sum of Phase-2 `DurationMinutes`. Ops/admin `source=` still uses legacy engine duration resolution.

## Performance (v5 lean path)

Happy-path specific barber (slots found):

1. Resolve branch + services (cached catalogs)
2. **In-memory cache hit** → return immediately (no schedule preflight)
3. On miss: one emp identity check + `listAvailableBookingSlots` for that emp only  
   (`isEmployeeBookableAtBranch` — not full branch roster)
4. Location classify (`resolveEmployeeGlobalSchedule`) runs **only when slots are empty**

Also skipped on public path: alternative-barber scan + day-plan reason enrichment batch.

## Full slot list (v6)

Public `available-slots` returns **every** bookable start for the shift (no 36/56 soft cap).  
Last start for a 12:00→23:00 barber with a 30-minute service is **22:30**.
