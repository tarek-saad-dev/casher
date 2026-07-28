# Booking Phase 10C — Cross-Branch Barber Availability API

**Date:** 2026-07-28  
**Endpoint:** `POST /api/public/booking/barbers/[empId]/cross-branch-availability`  
**Contract body:** `xbranch-v1` · header `X-Booking-Contract-Version: booking-public-v1`

## Goal

One fast public call returning a barber’s available slots across **all public-eligible bookable branches** (no internal `BranchID`).

## Input

```json
{
  "serviceIds": [9],
  "dateFrom": "2026-07-28",
  "days": 7
}
```

Limits: **max 14 days**, **max 12 services**.

## Response shape

```json
{
  "ok": true,
  "barber": { "empId": 18, "nameAr": "احمد" },
  "branches": [{ "branchCode": "CAMP_CAESAR", "branchName": "كامب شيزار" }],
  "days": ["2026-07-28", "2026-07-29"],
  "slots": [
    {
      "branchCode": "CAMP_CAESAR",
      "branchName": "كامب شيزار",
      "date": "2026-07-28",
      "time": "11:00",
      "dayOffset": 0
    }
  ],
  "meta": {
    "slotCount": 12,
    "branchCount": 1,
    "dayCount": 2,
    "queryCount": 24,
    "timingMs": { "barberMs": 12, "eligibilityMs": 40, "slotsMs": 400, "totalMs": 480 },
    "cacheHit": false,
    "failedBranchCodes": [],
    "contractVersion": "xbranch-v1",
    "generatedAt": "2026-07-28T01:00:00.000Z"
  }
}
```

Slots are sorted by **date → dayOffset → time → branchCode**. Overnight `dayOffset: 1` is preserved.

## Rules

| Rule | Behavior |
|---|---|
| Eligible branches | Public discoverable ∩ effective `CanReceiveBookings` assignment overlapping the window |
| Paused / non-public | Excluded (QBS pause / lifecycle) |
| Parallelism | Branches evaluated with `Promise.all` |
| Batching | Assignment window + schedule hints batched; services resolved once per branch; days parallel |
| Failure isolation | One branch error → empty slots for that branch only (`failedBranchCodes`); never invents slots |
| Cache | 8s in-process; cleared with `invalidatePublicBookingAvailabilityCache` on create/cancel |

## CORS / rate limit / errors

- Route key: `cross-branch-availability`
- Methods: `POST`, `OPTIONS`
- Rate family: `availability` (30/min)
- Nested error catalog via `finalizePublicBookingError` (same as booking-public-v1)

## Verify

```bash
BOOKING_PHASE_10C_DOMAIN=enabled npx tsx scripts/probe-booking-phase10c-cross-branch-domain.ts
BOOKING_PHASE_10C_SMOKE=enabled npx tsx scripts/verify-booking-phase10c-cross-branch-availability.ts
```

Expected proofs (domain probe 2026-07-28):

| Check | Result |
|---|---|
| Ahmed (18) | Camp only |
| Ziad (12) | GLEEM + Camp |
| Saturday | Ahmed slotCount=0 |
| Slot → plan | available=true (Camp 11:00) |
| Query count (Ahmed 7d) | **20** |
| Cold (warm infra, cold cache) | **1860ms** (&lt;3s) |
| Warm (cache hit) | **0ms** (&lt;1.2s) |

Artifacts: `_booking-phase10c-domain-probe.json`, `_booking-phase10c-cross-branch-availability.json` (after HTTP deploy smoke)

## GO / NO-GO

**GO** — correctness proofs pass; warm/cold timing targets met on domain probe; unit tests + ESLint (route/domain) + production build green.

HTTP live smoke against production requires deploy of this route first.
