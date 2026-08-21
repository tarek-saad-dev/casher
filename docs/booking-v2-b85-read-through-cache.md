# Booking V2 — Phase B8.5 Production Read-Through Hot Cache

## Goal

Serve V2 availability from L1 when revision is fresh. SQL remains Source of
Truth. Cache never gates write correctness.

## Flags

| Env | Values | Default |
|---|---|---|
| `BOOKING_V2_HOT_CACHE` | `off` \| `on` | `off` |
| `BOOKING_V2_READ_MODE` | `legacy` \| `shadow` \| `canary` \| `v2` | `shadow` |

When `BOOKING_V2_READ_MODE=canary|v2` **and** `BOOKING_V2_HOT_CACHE=on`, the V2
cohort uses read-through. Legacy cohort unchanged.

**Kill switch:** `BOOKING_V2_READ_MODE=legacy` (no deploy).

## Read path

```
request
→ batch SQL revision (Emp × date range, 1 query)
→ L1 lookup per Emp×Branch×Date
    ├ hit + revision match → compose starts from FreeMask
    └ miss/stale → rebuild miss set only from SoT → store → return
```

Warm availability should approach **0 heavy availability DB loads**.

## Cross-instance

`TblBookingAvailabilityRevision` (deploy-time migration) holds Emp×BusinessDate
counters. Process-local L1 is not shared; revision check rejects known-stale
entries. Redis is **not** required (L2 interface remains disabled by default).

## Invalidation (date-scoped, EmpID global for occupancy)

Occupancy (booking / hold / queue) clears **all branch** L1 entries for that
Emp×Date. Effective-day / schedule / branch hours bump `EffectiveWorkRevision`.

## Metrics (read_through log)

`hotCacheHit`, `hotCacheMiss`, `hotCacheStale`, `hotCacheRebuild`,
`hotCacheCoalesced`, `revisionLookupMs`, `rebuildDbMs`, `cacheReadMs`, `totalMs`.

## Tests

`src/lib/__tests__/bookingV2ReadThroughCache.test.ts`
