# Booking V2 — Phase B9.5 Production Read Performance Hardening

## Bottleneck (measured, not guessed)

`scripts/audit-booking-v2-bootstrap-cold.ts` on cloud SQL (2026-08-16):

| Phase | ms |
|---|---|
| connection | 857 |
| list_discoverable | 1643 |
| branch_load total | 1113 |
| catalog total | 1637 |
| settings total | 457 |
| **barbers total** | **22899** |

**Root cause:** bootstrap passed `date: today` into `listPublicBookingBarbers`, which
calls `resolveEmployeeGlobalSchedule` **per employee × per branch** (~11s/branch).

## Fixes

1. Bootstrap omits `date`; uses **one** `mode: 'global'` barbers load + parallel
   catalog/settings per branch.
2. Batched `canBranchesAppearInPublicBooking` (discoverable + barbers roster).
3. Persistent `TblBookingBootstrapSnapshot` (L1 → SQL → rebuild) + CDN
   `Cache-Control: public, max-age=300, stale-while-revalidate=3600` + ETag.
4. Availability warm path: revision batch only (0 heavy rebuild queries).
5. 14-day miss set: one batched SoT preload → N in-memory day payloads.

## Flags

```
BOOKING_V2_HOT_CACHE=on
BOOKING_V2_READ_MODE=canary   # or v2
```

## Harness

```bash
npx tsx scripts/audit-booking-v2-bootstrap-cold.ts
BOOKING_V2_HOT_CACHE=on npx tsx scripts/benchmark-booking-v2-read-perf.ts
```

## Live cloud results (Hot Cache ON, 2026-08-16)

### Bootstrap

| | p50 | p95 |
|---|---|---|
| cold | **1175 ms** | 4185 ms (first cold includes connection/schema) |
| warm | **0 ms** | 0.2 ms |

gzip ≈ **2.76 KB** (unchanged). Historical with `date` on barbers: **~21 s**.

### Availability 14d (1 barber)

| | wall p50 | wall p95 | queries | heavy SoT | revision Q | hit ratio |
|---|---|---|---|---|---|---|
| cold | 1826 ms | 2120 ms | **10** batched | 1 tree → 14 day masks | 1 | 0% |
| warm | 542 ms | 856 ms | **1** | **0** | 1 | **100%** |

### Other scenarios (warm)

| Scenario | wall p50 | queries | heavy | hit |
|---|---|---|---|---|
| 1d | 544 ms | 1 | 0 | 100% |
| roster 14d | 719 ms | 1 | 0 | 100% |
| Zeyad 2×14d | 899 ms | 1 | 0 | 100% |

Warm residual ≈ revision RTT (~175 ms) + matrix branch/settings setup — **not**
full availability SoT preload.
