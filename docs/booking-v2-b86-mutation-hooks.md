# Booking V2 — Phase B8.6 Central Availability Mutation Hooks

## Goal

Prevent Hawai availability-affecting writes from forgetting revision /
hot-cache invalidation by routing through one API:

```ts
import { AvailabilityMutationNotifier } from '@/lib/booking/AvailabilityMutationNotifier';
```

| Method | Scope |
|---|---|
| `employeeDayChanged` | Emp × BusinessDate (effective work / attendance / overrides) |
| `employeeWeeklyScheduleChanged` | Emp × Branch × horizon |
| `employeeBranchAssignmentChanged` | Emp × Branch × horizon |
| `branchHoursChanged` | Branch × roster × horizon |
| `branchExceptionalHoursChanged` | Branch × roster × dates |
| `bookingOccupancyChanged` | **Emp-global** occupancy (all branch L1 for Emp×Date) |
| `holdOccupancyChanged` | Emp-global |
| `queueOccupancyChanged` | Emp-global |

## Transaction semantics

```ts
await AvailabilityMutationNotifier.runWithPostCommit(async () => {
  // SoT writes…
  await AvailabilityMutationNotifier.queueOccupancyChanged({ … }); // queued
  // throw → discard (no invalidate on rollback)
});
// flush after success
```

Existing `notifyHot*` helpers delegate to the notifier, so any caller wrapped
in `runWithPostCommit` automatically defers.

## Audit inventory (app writes)

| Path | Mutates | Status |
|---|---|---|
| `employeeBranchScheduleSave` / global weekly | weekly schedule | **wired** (via notifyHotWeeklyBaseline → notifier) |
| `commitEmployeeBranchAssignment` | assignment + schedule | **wired** (`runWithPostCommit` + assignment changed) |
| `removeLaunchRosterAssignment` | deactivate assignment/schedule | **wired** |
| schedule-control / booking-control overrides | overrides | **wired** |
| daily adjustments | daily adjustment | **wired** |
| admin attendance + shift/break sync | attendance / overrides | **wired** |
| `workOnDayOff` / unlockSchedule | overrides | **wired** |
| auto-absence | attendance + day_off | **wired** |
| `employees/attendance*` | attendance (freelance unlock) | **wired** (B8.6) |
| `finalize-incomplete-attendance` | attendance | **wired** (B8.6) |
| `updateBranchSetup` hours | branch hours | **wired** |
| `upsertBranchExceptionalHours` | exceptional hours | **wired** (helper; no public route yet) |
| public booking create/cancel/reschedule | bookings | **wired** |
| booking holds | holds | **wired** |
| queue create / `[id]` transfer/terminal | queue | **wired** |
| ops `queue/[id]/cancel` | queue (+ optional booking) | **wired** (B8.6) |
| `queue/settle-expired` | queue no_show | **wired** (B8.6) |
| ops `bookings/[id]/arrive` | queue + booking status | **wired** (B8.6) |
| `admin/cleanup-queue` | queue cancel | **wired** (B8.6) |
| legacy `/api/bookings` create + PATCH | bookings | **wired** (B8.6) |
| ops affected-bookings cancel | booking cancel | **wired** (B8.6) |
| temporary branch transfer | day rules | **wired** |
| announce / called-only status | status still occupying | **n/a** |

## Unsafe / manual scripts

These mutate SoT **without** the notifier. Operators must call the notifier or
run an explicit revision rebuild afterward:

| Script / harness | Risk |
|---|---|
| `scripts/branch-smoke/*` | assignment / schedule / attendance / bookings / queue |
| `scripts/verify-availability-phase3c.ts` | attendance / bookings |
| `scripts/cleanup-auto-absence-live-test.ts` | attendance + overrides |
| `scripts/verify-karim-booking-e2e.ts` | booking cancel |
| `src/lib/__tests__/helpers/phase6cSmokeHarness.ts` | raw assignment/schedule |
| `empBranchWorkSchedule.backfillGleem…` | schedule backfill |
| legacy `upsertEmployeeSchedule` via `/api/employees*` | legacy `TblEmpWorkSchedule` (prefer branch schedule) |

## Stale verifier

```bash
npx tsx scripts/verify-booking-v2-stale-projections.ts
# optional repair (revision bump only):
BOOKING_V2_STALE_FIX=1 npx tsx scripts/verify-booking-v2-stale-projections.ts
```

Compares SoT occupancy counts vs `TblBookingAvailabilityRevision` layers.
Default: **report only** (exit 2 if stale candidates).

## Remaining gaps (accepted / low)

1. Legacy global `TblEmpWorkSchedule` writers — prefer branch-owned schedule; still document as weak if used.
2. `branchAttendance.service` check-in/out — no live callers found.
3. Historical occupancy created before B8.6 may show as stale until `BOOKING_V2_STALE_FIX=1` or natural rewrites.
4. Scripts listed above — intentional; document, do not silently auto-wire.

## Acceptance

| Gate | |
|---|---|
| ALL APP WRITE PATHS AUDITED | ✓ |
| CENTRAL MUTATION NOTIFIER VERIFIED | ✓ |
| ADMIN ASSIGNMENT WIRED | ✓ |
| FREELANCE PATH WIRED | ✓ |
| LEGACY QUEUE PATHS WIRED | ✓ |
| ROLLBACK DOES NOT INVALIDATE | ✓ (`runWithPostCommit` discard) |
| CROSS-BRANCH OCCUPANCY | ✓ (Emp-global invalidate in HotAvailabilityInvalidation) |
| RAW SCRIPT RISKS DOCUMENTED | ✓ |
| STALE PROJECTION VERIFIER AVAILABLE | ✓ |

**BOOKING V2 INVALIDATION COVERAGE VERIFIED**
