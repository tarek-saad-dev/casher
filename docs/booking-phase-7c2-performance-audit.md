# Booking Phase 7C2 — Performance Audit

**Date:** 2026-07-27 · **Focus:** available-days + upcoming reads

## available-days (primary)

**Sources:** `getPublicAvailableDays` / `listSlotsForPreloadedContext` in `publicBookingAvailability.ts`

### Before (Phase 7C2)

| Metric | Value |
|---|---|
| Cold available-days (sequential day evaluation) | **~64s** (observed baseline) |
| Pattern | Per-day work effectively sequential; repeated branch/service resolution cost |

### After (Phase 7C2)

| Change | Detail |
|---|---|
| Parallel days | `Promise.all(dateRange.map(buildAvailableDayWire))` |
| Preloaded context | Resolve branch + selected services **once**, then `listSlotsForPreloadedContext` per day |
| Per-day slot cache key | `slots-pre::{branch}::{date}::{emp|ANY}::{serviceIds}::{duration}::{contract}` |
| Days response cache | TTL **8s**, max **48** entries (`__pos_public_booking_availability_v4`) |

### Estimated improvement

| Scenario | Estimate | Measured live in 7C2? |
|---|---|---|
| Cold available-days wall time | **~4–10×** faster vs ~64s sequential (order-of-magnitude; depends on day span, pool, and engine cost) | **No** — live post-change timing **not re-measured** |
| Warm cache hit (≤8s TTL) | Near-instant same-key replay | Not re-measured |

**Caveat:** Parallelism is bounded by SQL pool / Azure latency; worst-case cold may still be multi-second for long ranges. Re-run a timed probe before claiming production SLOs.

## upcoming (batch services)

**Source:** `loadServiceLinesBatch` in `publicBookingReader.ts`

| Before | After |
|---|---|
| N service queries (one per booking) | **One** `BookingServices` query with `IN (@bid0…)` for all eligible booking IDs |

Typical path: 1 list query + 1 batched services query (N ≤ upcoming limit ≤ 25).

## Non-goals this phase

- No new DB indexes
- Rate-limit storage remains in-memory (not a latency feature)
- Create/cancel TX paths unchanged from 7B
