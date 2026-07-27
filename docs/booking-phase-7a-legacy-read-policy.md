# Booking Phase 7A — Legacy Read Policy

Prefer Phase 6 columns. Fallback order:

1. `PublicWorkDate` + `PublicDayOffset` + Absolute UTC → `dateSource=canonical`
2. Structured `[p6] workDate=…;dayOffset=…` Notes → `legacy_derived` (Notes never returned raw)
3. `BookingDate` + `StartTime` → `legacy_derived` (dayOffset=0)
4. After-midnight clock without PublicDayOffset → `ambiguous` (no fabricated WorkDate)

No historical mutation in Phase 7A. Live counts should be gathered via smoke/ops queries when needed; do not backfill ambiguous overnight rows here.
