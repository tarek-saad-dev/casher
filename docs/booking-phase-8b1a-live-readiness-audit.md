# Booking Phase 8B1A — Live Readiness Audit

**Date:** 2026-07-27 (Cairo)  
**Alias:** `https://casher-five.vercel.app`  
**Local HEAD at probe:** `39b38174d6701ba2199012badf065732e345c516`  
**Contract mode:** `compat` (not changed)  
**Cairo business date:** `2026-07-27`

## Exact live environment

| Field | Value |
|---|---|
| Production alias | `https://casher-five.vercel.app` |
| Allowed origins | `https://cutsaloon.com`, `https://www.cutsaloon.com` |
| Contract mode | `compat` |
| DB | cloud SQL (`newserverr` / env `DB_*`, secrets redacted) |
| GLEEM BranchID | 1 |
| GLEEM LifecycleStatus | `PUBLIC_LIVE` |
| GLEEM PublicBookingEnabled | **true** |
| GLEEM QueueBookingSettings.BookingEnabled | **false** |
| MaxBookingDaysAhead | 365 |
| MinNoticeMinutes | 15 |
| SlotIntervalMinutes | 15 |
| Camp Caesar | `SETUP`, PublicBookingEnabled=false, IsActive=false |

## Executive root causes

### 1) Empty branches + 409 services/barbers (deterministic)

**Root cause:** `dbo.QueueBookingSettings.BookingEnabled = 0` for GLEEM.

Effects:

| Endpoint | Result |
|---|---|
| `GET /api/public/branches` | `200` `{ branches: [] }` |
| `GET .../config?branchCode=GLEEM` | `200` `BOOKING_PAUSED`, `salon.bookingEnabled=false` |
| `GET .../status?branchCode=GLEEM` | `200` `bookingEnabled=false` |
| `GET .../services?branchCode=GLEEM` | `409` **`BRANCH_BOOKING_DISABLED`** |
| `GET .../barbers?branchCode=GLEEM` | `409` **`BRANCH_BOOKING_DISABLED`** |

Reproduced **3×** with spacing; identical codes. Not intermittent, not rate-limit, not empty-catalog normalization.

Discovery list is empty because `canBranchAppearInPublicBooking` requires `BookingEnabled=1`.

### 2) Earlier `global_leave` on available-days

**Root cause (mechanism):** specific-barber day classifier maps `resolveEmployeeGlobalSchedule(...).isGlobalDayOff === true` → status `global_leave`.

`isGlobalDayOff` is true when:

1. an approved day-off override exists, **or**
2. **no working branches remain after resolution** (`branches.length === 0`)

While booking is paused, `canBranchAppearInPublicBooking(GLEEM)` is **false**, so `publicOnly: true` schedule resolution returns **no public working branches** for every employee → every specific-barber day looks like `global_leave`.

Additionally on `2026-07-27`, EmpID **12 (زياد)** has `TblEmpScheduleOverrides` `Type=day_off`.

Weekly schedules **do exist** (75 working rows at GLEEM; e.g. Emp 7 Sun–Sat 11:00–23:00). The catalog/schedule data is not “empty”; public visibility collapses while booking is paused.

## What was NOT run

Because booking is paused, controlled live create/plan/slot proofs are **NOT RUN** (would require operator re-enable of `BookingEnabled` without inventing availability).

## Privacy

Camp Caesar remains non-public (`BRANCH_NOT_PUBLIC` on config). Contract mode remains `compat`.

## Artifacts

- `_booking-phase8b1a-live-probe.json`
- `_booking-phase8b1a-sql-spot.json`
- Scripts: `scripts/probe-booking-phase8b1a-live.ts`, `scripts/audit-booking-phase8b1a-sql-spot.ts`
