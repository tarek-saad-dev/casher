# Booking Phase 5 — Check-slot / Plan audit

**Scope:** Casher backend only. cutsaloon.com unchanged.  
**Date:** 2026-07-27 · **DB:** last132

## Pre-migration state

| Endpoint | Branch | Services / price / duration | Availability | Writes? | Errors |
|----------|--------|------------------------------|--------------|---------|--------|
| `POST .../check-slot` | Legacy `resolvePublicBranchCode` (single-public fallback) | Engine `calculateServicePlanDuration` → emp override → system default; **no price** | `validateBookingSlot` (fresh engine; no Phase-4 cache) | No | Flat `{ error }` / `{ ok:false, available:false, reasonCode }` |
| `POST .../plan` | Same legacy resolver | Raw SQL `ISNULL(DurationMinutes, default)` + `SPrice1` | Per-segment `validateBookingSlot` **without `branchId`/`dayOffset`** | **Yes — INSERT bookings** | Flat Arabic / mixed 409 |

## Matrix

| Endpoint/function | Branch source | Service source | Price source | Duration source | Schedule source | Busy source | Any-barber | Overnight | Error contract | Fallback risk | Required migration |
|-------------------|---------------|----------------|--------------|-----------------|-----------------|-------------|------------|-----------|----------------|---------------|--------------------|
| check-slot (pre) | `resolvePublicBranchCode` | engine TblPro | none | emp → service → system | engine | queue+booking | `nearest` first-hit | `dayOffset` passed | flat | GLEEM via single-public; system duration | Phase 5 evaluator |
| plan (pre) | same | TblPro SQL | `SPrice1` | ISNULL + JS default | engine (broken dayOffset) | write-guard | global Job list | applied once then lost | flat | GLEEM; system duration; **creates rows** | Phase 5 read-only plan |
| `calculateServicePlanDuration` | n/a | TblPro + emp | n/a | emp override path | n/a | n/a | n/a | n/a | throw | employee + system default | Do not use for public |
| Phase-4 `getPublicAvailableSlots` | central context | Phase-2 catalog | catalog | strict DurationMinutes | engine | queue+booking | `collectAllCandidates` | yes | nested | **8s final-slot cache** | Reuse logic **without** slot cache |
| Phase-5 evaluator | central context | `resolveSelectedBookingServices` | catalog sum | strict sum | engine fresh | fresh busy | candidate set | required dayOffset | nested + availability result | none intended | **canonical** |

## Explicit risks identified

| Risk | Pre-Phase-5 | Phase-5 fix |
|------|-------------|-------------|
| Employee-duration fallback | Engine emp overrides | Forbidden — catalog only via `durationOverride` |
| System-default duration | `defaultServiceDurationMinutes` / ISNULL | Forbidden |
| Implicit GLEEM fallback | `resolvePublicBranchCode` single-public | `BRANCH_REQUIRED` — no fallback |
| Client-supplied duration/price | Ignored today but not rejected | Ignored safely; never used in calc |
| plan vs check-slot calc differences | Different duration + branch paths | Same evaluator |
| Stale final-slot cache | check-slot did not use Phase-4 cache; listing cache is 8s with incomplete busy-version | Evaluator **never** reads Phase-4 slot cache |
| date/dayOffset ambiguity | plan advanced date then validated with dayOffset=0 | WorkDate + required dayOffset; absolute Cairo start/end |
| plan writes bookings | Full INSERT path | **Removed** — plan is preview; create remains Phase 6 |

## Compatibility decisions

1. **check-slot business unavailability** remains HTTP **200** with `{ ok: true, available: false, reason }` so existing clients that treat HTTP 200 as “answered” keep working. Malformed/resource errors use nested Phase-1 errors + non-200.
2. **plan** no longer creates bookings. cutsaloon.com is not modified here; create stays on `POST .../create` until Phase 6.
3. Legacy body aliases `mode: "nearest"|"specific"` map to `any_barber` / `specific_barber`.

## Migration matrix update

| Route | Status |
|-------|--------|
| check-slot | **migrated (Phase 5)** |
| plan | **migrated (Phase 5)** — read-only plan contract |
| create | **pending Booking Phase 6** |
