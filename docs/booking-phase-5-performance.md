# Booking Phase 5 — Performance

check-slot / plan evaluate **one** WorkDate + exact `time|dayOffset`.

| Mode | Work |
|------|------|
| Specific | 1 branch + 1 service resolve + 1 employee day classify + 1 fresh slot list (day) + optional validate |
| Any-barber | Same + `collectAllCandidates` batch (no N+1) |

Does **not**: available-days range loops, horizon-wide slot grids, Phase-4 8s final-slot cache.

Static branch/service caches may still apply. Busy intervals always fresh via engine load.
