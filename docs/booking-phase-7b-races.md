# Booking Phase 7B — Races

| Race | Expected |
|---|---|
| Same cancel key concurrent | One mutation; replay / in-progress / lock timeout acceptable; single cancelled row |
| Different cancel keys | One cancel; second alreadyCancelled / cancelled success; no reason overwrite after first |
| Cancel vs service-start | Either cancel wins **or** cancel gets `BOOKING_ALREADY_IN_SERVICE` / `BOOKING_NOT_CANCELLABLE` — never dual state |
| Cancel vs new create | After commit + invalidation, create may succeed; ≤1 active overlapping booking |
