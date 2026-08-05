# Availability Architecture — Phase 2 Implementation

**Date:** 2026-08-03  
**Status:** Complete  
**Context:** [`docs/availability-phase-2-context-pack.md`](./availability-phase-2-context-pack.md)

---

## 1. Executive summary

Phase 2 closes the remaining create + reader gaps left after Phase 0+1:

- Admin `bookings/new` now creates via the **canonical** `POST /api/public/booking/create` path (with optional `leadSource` + additive `booking.id`).
- Day-plan resolution is **batch-optimized** (`loadEmployeeDayPlanInputsBatch` + pure `buildEmployeeDayPlanFromInputs`).
- Singular/batch **day status**, **queue timeline/estimate**, and **reschedule precheck/write guard** all use the canonical day plan (branch-aware when `branchId` is available).
- Empty-slot **`employeeReasons`** are enriched from day-plan `denyReasonCode` via `resolveEmployeeDayPlansBatch`.
- Legacy `POST /api/bookings` remains available behind `LEGACY_BOOKINGS_CREATE_ENABLED` (default **true**). No schema consolidation and no centralized workforce UI.

**Internal production create callers of legacy `fetch('/api/bookings', { method: 'POST' })` are now zero.**

---

## 2. Files added and modified

### Added

| File | Role |
|------|------|
| `src/lib/availability/loadEmployeeDayPlanInputsBatch.ts` | Shared batch inputs loader |
| `src/lib/availability/mapEmployeeDayPlanToBarberDayStatus.ts` | Day-plan → `BarberDayStatus` mapper |
| `src/lib/__tests__/availabilityPhase2.test.ts` | Phase 2 contract + parity tests |
| `docs/availability-phase-2-implementation.md` | This report |

### Modified (production)

| File | Change |
|------|--------|
| `src/app/bookings/new/page.tsx` | Canonical create payload; no separate customer POST |
| `src/lib/booking/publicBookingCreate.ts` | `leadSource` + `booking.id` in success body |
| `src/app/api/public/booking/create/route.ts` | Pass internal-only `leadSource` |
| `src/lib/availability/resolveEmployeeDayPlan.ts` | Shared loader + pure builder; batch TX support |
| `src/lib/availabilityEngine.ts` | `getBarberDayStatus` / batch / `checkBarberAvailableAt` → day plan |
| `src/app/api/operations/schedule-control/apply/route.ts` | Pass `branchId` into day status |
| `src/app/api/operations/schedule-control/restore-present/route.ts` | Pass `branchId` into day status |
| `src/lib/queueEstimateEngine.ts` | `hasAnyAvailableSlotForBarberOnDay` → day plan + blocks |
| `src/lib/operationsQueueTimeline.ts` | Timeline/simulate → day plan; optional `branchId` |
| `src/app/api/operations/queue/simulate/route.ts` | Thread session `branchId` |
| `src/lib/operationsQueueCreateCore.ts` | Thread `branchId` into simulate |
| `src/app/api/bookings/estimate/route.ts` | Display window from day plan |
| `src/lib/bookingRescheduleCore.ts` | Day-plan shift bounds; branch on assert; no local overrides |
| `src/lib/scheduleIntegrity.ts` | `branchId` on busy-interval schedule resolve |
| `src/lib/bookingAvailabilityEngine.ts` | Empty-slot reasons from day-plan batch |

### Modified (tests)

| File | Change |
|------|--------|
| `src/lib/__tests__/bookingReschedule.test.ts` | Safe `server-only` Vitest mock |
| `src/lib/__tests__/phase1qEmployeeBranchSchedule.test.ts` | Assert shared evaluator service, not thin route string |
| `src/lib/__tests__/phase1rEmployeeScheduleOperations.test.ts` | Assert `loadFlowBoardForBranch`; quote-flexible SETUP filter |
| `src/lib/__tests__/availabilityPhase01.test.ts` | Day-status batch now expects `resolveEmployeeDayPlansBatch` |
| `src/lib/__tests__/bookingMoveValidation.test.ts` | Day-plan mock respects `hasSchedule` / `isWorkingDay` |

---

## 3. Admin create migration and source mapping

`src/app/bookings/new/page.tsx` posts:

```ts
{
  customer: { name, phone },
  serviceIds,
  date, time, dayOffset: 0,
  mode: 'specific',
  empId,
  notes,
  source: 'admin',
  leadSource: originalSelectedSource // phone|whatsapp|website|admin|walk_in
}
```

- Existing client: current name + mobile.
- New client: no separate `POST /api/customers` — upsert handled inside `createPublicBooking`.
- Conflict preview GET `/api/bookings?...` unchanged.
- Client prices/durations/totals/`endTime` are not sent on create.

`resolvePersistedBookingSource`:

- Public / non-internal → persisted `bookingSource` only (public cannot override).
- Authenticated admin/ops (`purpose: internal_preview`) → valid `leadSource` when present, else `bookingSource`.

---

## 4. Canonical response compatibility

Success body remains additive:

```ts
booking: {
  id: number;   // NEW — numeric BookingID for admin navigation
  code: string; // existing
  status, branch, barber, times, …
}
```

Public contracts otherwise unchanged. Idempotent replays of bodies stored before `id` existed may omit `id`; new creates always include it.

Admin UX reads `data.booking.id` / `data.booking.code` and navigates to `/bookings/{id}`.

---

## 5. Reader migrations

| Reader | Before | After |
|--------|--------|-------|
| `getBarberDayStatus` / `getBarbersDayStatus` | Local weekly + overrides | `resolveEmployeeDayPlan(sBatch)` + mapper |
| `checkBarberAvailableAt` | Day status (legacy) | Day status (canonical) + optional `branchId` |
| `hasAnyAvailableSlotForBarberOnDay` | `getBarberWorkingWindow` | Day plan effective window + `blockedIntervals` |
| `buildBarberOperationalTimeline` / `simulateQueueInsertion` | Weekly window | Day plan; optional `branchId` |
| `bookingRescheduleCore` precheck | Local window + `applyOverrides` | `resolveEmployeeDayPlan` |
| TX `assertEmployeeIntervalAvailable` | No booking branch | `branchId: booking.branchId` |
| Empty-slot `employeeReasons` | Slot rejections only | Day-plan denies + slot rejections |

`getDefaultSchedule` remains exported for unrelated legacy/debug paths; booking/ops availability paths no longer use it.

---

## 6. Batch query design and query-count improvement

`loadEmployeeDayPlanInputsBatch({ branchId, empIds, businessDate, transaction? })` loads once:

- Weekly windows (`loadWorkingWindowsBatch`)
- Schedule overrides
- Freelance unlocks *(pool — see limitation)*
- Attendance + absent (folded into one attendance query)
- Day-off set
- Global timing / timezone *(pool — see limitation)*

Then `buildEmployeeDayPlanFromInputs` builds each plan in memory.

- `resolveEmployeeDayPlan` → loader for `[empId]` + builder.
- `resolveEmployeeDayPlansBatch` → **one** loader call for all IDs + N pure builds.

Employee IDs are deduplicated/validated before SQL. Parameterized dates/branch; `IN (...)` follows existing repository style. Optional `mssql.Transaction` is preferred for reads when supplied.

---

## 7. Reschedule parity

- Removed local `getBarberWorkingWindow` + `loadBookingOverridesForDate` + `applyOverrides` path.
- Removed `TblEmpWorkSchedule` “has any row?” probe.
- Uses day-plan fields (`baseScheduleSource`, `denyReasonCode`, `effSched`) for `NO_SCHEDULE` / off / absent / outside-shift messages.
- Precheck and TX assert share the same branch-scoped plan via `Bookings.BranchID`.
- `excludeBookingId` preserved on busy intervals and assert.
- Error priority unchanged: editable → eligibility → services → schedule → conflicts.

---

## 8. Reason-code improvements

When `availableSlots.length === 0`:

1. Collect `candidateEmpIds` from context building.
2. `resolveEmployeeDayPlansBatch` for those IDs.
3. Prefer plan `denyReasonCode` when the employee has no usable working day.
4. Otherwise map slot rejection reasons (booking/queue/break/min notice/contiguous).
5. Envelope prefers day-plan denies over generic `NO_EMPLOYEE_AVAILABLE` / `SLOT_UNAVAILABLE`.

Arabic `noSlotsReason` text preserved unless the underlying cause mapping was wrong.

---

## 9. Legacy paths intentionally retained

- `POST /api/bookings` still exists; fenced by `LEGACY_BOOKINGS_CREATE_ENABLED` (default **true**).
- No redirect inside the legacy route.
- External unknown callers of the legacy route remain supported.
- `getDefaultSchedule` / `getBarberWorkingWindow` may still be used by HR/debug/legacy helpers outside the migrated readers.

---

## 10. API compatibility

- Additive only: `booking.id`, optional request `leadSource` (internal).
- Public response fields unchanged aside from additive `id`.
- Admin creates may persist `Status = confirmed` via the canonical path (intentional).
- No client-supplied price, duration, total, branch ID, or end time on create.

---

## 11. Tests and exact results

Commands run:

```text
npx vitest run src/lib/__tests__/availabilityPhase2.test.ts
npx vitest run src/lib/__tests__/availabilityPhase01.test.ts src/lib/__tests__/bookingOperationalDate.test.ts src/lib/__tests__/bookingAvailabilityEngine.test.ts src/lib/__tests__/bookingCreateCanonicalContract.test.ts src/lib/__tests__/bookingMoveValidation.test.ts src/lib/__tests__/bookingAvailabilityDuration.test.ts
npx vitest run src/lib/__tests__/bookingReschedule.test.ts src/lib/__tests__/phase1qEmployeeBranchSchedule.test.ts src/lib/__tests__/phase1rEmployeeScheduleOperations.test.ts src/lib/__tests__/attendance-shift-schedule-sync.test.ts src/lib/__tests__/phase1oCampCaesarOvernightHours.test.ts
```

**Combined result:** **12 files / 152 tests passed.**

`availabilityPhase2.test.ts` alone: **19/19 passed.**

`npx tsc --noEmit`: fails due to **pre-existing** errors largely in unrelated `__tests__` files. **No remaining errors** in Phase 2 production modules after fixing:

- `queueEstimateEngine` reason-code union (`ABSENT` → existing `DAY_OFF` with Arabic “غائب”)
- Phase 2 test regex `s` flag (TS target)

---

## 12. Pre-existing failures fixed or remaining

| Issue | Resolution |
|-------|------------|
| `bookingReschedule.test.ts` `server-only` | Added `vi.mock('server-only', () => ({}))` |
| phase1q/phase1r stale route string asserts for `BARBER_AVAILABLE_AT_DIFFERENT_BRANCH` / flow-board | Pointed at shared services (`publicBookingSelectionEvaluator`, `loadFlowBoardForBranch`) |
| phase1r SETUP quote style | Flexible regex |
| Phase 01 day-status contract expecting `loadWorkingWindowsBatch` in `availabilityEngine` | Updated to `resolveEmployeeDayPlansBatch` |
| Move-validation scenario 8 always-working day-plan mock | Mock now honors `hasSchedule` / `isWorkingDay` |
| Unrelated `tsc` failures in other test files | **Remaining** (not introduced by Phase 2) |

---

## 13. Known limitations

1. **Single outer working window:** timeline/estimate/slot helpers use `effectiveWindows[0]` while preserving all `blockedIntervals`.
2. **Batch loader TX gaps:** `loadFreelanceBookingUnlocks` and `getGlobalTimingDefaults` still use the **pool**, not the optional transaction (documented in the loader module).
3. **Legacy create still enabled by default** until a later deliberate cutover.
4. **Schedule-control override DELETE** has no session branch context today — singular day status there may omit `branchId`.
5. **Product still allows multi-window day plans in the type**, but consumers that assume one outer window continue that assumption.
6. No schema migration / no `TblEmpDailyAdjustment` / no centralized workforce UI / payroll 5 AM business-date behavior unchanged.

---

## 14. Recommended Phase 3 scope

1. Default-disable `LEGACY_BOOKINGS_CREATE_ENABLED` after monitoring legacy POST metrics; keep route for 410 fence.
2. Make freelance unlock + timing defaults transaction-aware in the batch loader.
3. Multi-window slot generation (consume all `effectiveWindows`, not only `[0]`).
4. Migrate remaining `getBarberWorkingWindow` call sites (HR resolver fallbacks, debug tools) or mark them explicitly legacy.
5. Centralized workforce / day-adjustment UI only if product prioritizes it (out of Phase 2).
6. Optional booking holds / stronger public reason localization.

---

## Confirmation

**Internal production create callers of legacy `POST /api/bookings` via `fetch(..., { method: 'POST' })` are zero** (proven by repository walk in `availabilityPhase2.test.ts`). Tests and docs may still mention the legacy route.

```text
PHASE 2 COMPLETE
BOOKING CREATE CALLERS AND AVAILABILITY READERS MIGRATED
NO SCHEMA CONSOLIDATION OR CENTRALIZED UI IMPLEMENTED
```
