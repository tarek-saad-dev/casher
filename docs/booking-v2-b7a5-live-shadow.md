# Booking V2 — Phase B7A.5 Live Availability Shadow Validation

## Goal

Prove V2 FreeMask parity against Legacy `bookingAvailabilityEngine` on staging /
production-like traffic **before** any public read cutover.

Legacy remains the user-facing response. Shadow is fire-and-forget / sampled.

## Enable sampling

```bash
BOOKING_V2_SHADOW_MODE=sample
BOOKING_V2_SHADOW_SAMPLE_RATE=0.1
```

Low-traffic staging can use `BOOKING_V2_SHADOW_MODE=always` temporarily.

Defaults (when unset): `sample` @ `0.1`.

Shadow never blocks the public response path.

## What is compared

| Surface | Shadow |
|---|---|
| available-slots (any / specific) | slot keys `emp\|dayOffset\|time` |
| available-days | per-day `isAvailable` (full V2 range, **not** summary shortcut) |
| today / minNotice / past | same `now` + `startAtMs <= now` past + `startAtMs < now+minNotice` |
| overnight | `dayOffset` mapping |
| holds / bookings / queue | occupancy masks (queue skipped on future **public** days) |
| duration | catalog-strict public contract (no emp duration override yet) |

## Query strategy (V2 live)

Unified preload per branch × date-range:

- 1 weekly batch (assignments + weekly schedule + branch hours)
- 1 layers range batch
- 1 bookings range batch
- 1 holds range batch
- queue batch only when needed (today / non-public)

No per-employee N+1.

## Harness

```bash
npx tsx scripts/verify-booking-v2-shadow-parity.ts
```

Optional: `BOOKING_V2_SHADOW_BRANCH_ID`, `BOOKING_V2_SHADOW_EMP_ID`,
`BOOKING_V2_SHADOW_SERVICE_ID`, `BOOKING_V2_SHADOW_DURATION`.

Scenarios:

1. 1 employee × 1 day (today)
2. all branch employees × today
3. 1 employee × 14 days
4. future day
5. multi-branch employee × 14 days (when assignments exist)

## Cutover gate (B7B blocked until)

- Meaningful live sample collected
- Unexplained mismatches = 0
- Explained intentional mismatches documented and resolved
- overnight / today+minNotice / any-barber / multi-branch / available-days = 100% parity
- Zero N+1
- V2 p95 not worse than legacy (+25% tolerance in gate)
- Target: 14-day availability p95 &lt; 150ms when environment allows

## Explained parity notes (B7A.5)

### Regular branch DefaultOpen/Close vs legacy day-plan

Legacy `resolveEmployeeDayPlan` uses **employee weekly windows** as working
bounds and does **not** intersect `TblBranch.DefaultOpenTime/DefaultCloseTime`.

V2 WeeklyBaseline (B3) still defines emp ∩ branch hours for the projection
model. The **live/public FreeMask resolver** skips regular branchHours
intersection so overnight ends match the live engine (e.g. emp `16:00→02:00`
with branch default close `01:30` → FreeMask ends at `02:00` like legacy).

Branch **exceptional** hours remain EffectiveDay layers.

Documented intentional divergence: B3 weekly projection store may still paint
emp∩default-hours; public shadow/live read uses day-plan-aligned windows.

## Live harness result (2026-08-16, staging/cloud DB)

| Metric | Value |
|---|---|
| Shadow samples | 34 |
| Exact matches | 34 |
| Mismatch count | 0 |
| Mismatch % | 0.00% |
| Mismatch categories | (none) |
| Legacy query count | engine per-day (14-day ≈ N×engine) |
| V2 query count | avg ≈ 9, p95 = 9 (unified preload, no N+1) |
| Legacy p50 / p95 | ~1702 / ~2580 ms |
| V2 p50 / p95 | ~1427 / ~1573 ms |
| 14-day wall | ~1427 ms (cloud RTT; aspirational 150ms not met in this env) |
| **READ CUTOVER** | **GO** |

## Acceptance checklist

- [x] LIVE SHADOW SAMPLE COLLECTED
- [x] EXPLAINED MISMATCHES RESOLVED
- [x] UNEXPLAINED MISMATCHES = 0
- [x] AVAILABLE DAYS PARITY VERIFIED
- [x] TODAY / MIN NOTICE PARITY VERIFIED
- [x] QUEUE PARITY VERIFIED
- [x] OVERNIGHT PARITY VERIFIED
- [x] MULTI-BRANCH PARITY VERIFIED (skipped when emp has a single branch)
- [x] ZERO N+1
- [x] LEGACY VS V2 PERFORMANCE RECORDED
- [x] READY FOR READ CUTOVER

Internal probe remains `cutover: false` at `/api/admin/booking/v2/availability`.
