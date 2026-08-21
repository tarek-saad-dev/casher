# Booking V2 — Phase B9.6 Warm Read Final Optimization

## Goal

Cut warm matrix wall latency without Redis and without losing cross-instance
revision safety or zero-heavy-SoT warm behavior.

## Measured warm breakdown (before)

| Phase | ≈ ms |
|---|---|
| SQL revision RTT | ~175 |
| Branch/settings/roster setup | ~300–400 |
| L1 + DTO | small |
| **Wall p50 (1×14d)** | **~542** |

## Changes

1. **WarmMatrixContextCache** — branch + settings + roster (60s TTL), invalidated
   with public settings / barbers catalog bumps.
2. **Revision soft memo (250ms)** + single-flight over SQL `loadBatch`. Source of
   truth remains SQL; occupancy bumps clear the memo. Not process-local-only.
3. **DTO** — compose emits `freeMaskB64` from cached FreeMask; matrix avoids
   `fromFreeRanges` re-encode. Midnight ms memoized per businessDate.
4. **No catalog** on matrix unless `serviceId(s)` / `durationMinutes` requested.

## After (cloud, Hot Cache ON — 2026-08-17)

| Scenario | wall p50 | wall p95 | revision p50 | branch/settings p50 | appCompute p50 | queries | heavy |
|---|---|---|---|---|---|---|---|
| 1 emp × 14d | **37 ms** | **214 ms** | 0.1 | 0.1 | **35** | ~0.13 | **0** |
| roster × 14d | **43 ms** | **246 ms** | 0 | 0.1 | **43** | ~0.13 | **0** |
| multi × 14d | **42 ms** | **216 ms** | 0 | 0 | **40** | ~0.13 | **0** |

p95 spikes ≈ soft-memo expiry refreshing SQL revision (~175 ms RTT) — expected.

## Acceptance

| Gate | Status |
|---|---|
| ZERO HEAVY SOT READS PRESERVED | Yes |
| BRANCH/SETTINGS SQL REMOVED FROM WARM PATH WHERE SAFE | Yes (context HIT) |
| CROSS-INSTANCE REVISION SAFETY PRESERVED | Yes (SQL + 250ms soft) |
| DUPLICATED BOOTSTRAP WORK REMOVED | Yes |
| WARM LATENCY BREAKDOWN RECORDED | Yes (`metrics.warm`) |
| NO REDIS REQUIREMENT | Yes |

```bash
BOOKING_V2_HOT_CACHE=on npx tsx scripts/benchmark-booking-v2-warm-b96.ts
```
