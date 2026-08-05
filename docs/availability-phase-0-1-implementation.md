# Availability Architecture — Phase 0 + Phase 1 Implementation

**Date:** 2026-08-02  
**Scope:** Safety fence + observability (Phase 0), canonical availability reads (Phase 1).  
**Out of scope:** Centralized workforce UI, `TblEmpDailyAdjustment`, day-off/override table migration, schema consolidation, booking holds, service capability tables, payroll behavior changes, retiring legacy create.

---

## Files changed

### New modules

| File | Role |
|------|------|
| `src/lib/availability/reasonCodes.ts` | Machine-readable availability reason codes + legacy slot reason mapping |
| `src/lib/availability/legacyBookingCreateFence.ts` | `LEGACY_BOOKINGS_CREATE_ENABLED` flag + structured logging helpers |
| `src/lib/availability/operationalDateContext.ts` | `{ businessDate, timezone, cutoffHour }` for APIs |
| `src/lib/availability/loadWorkingWindowsBatch.ts` | Shared branch-first weekly window batch loader (engine + day plan + board) |
| `src/lib/availability/resolveEmployeeDayPlan.ts` | Canonical employee day-plan reader |
| `src/lib/availability/dayPlanParity.ts` | Dev / flagged parity diagnostics |
| `src/lib/__tests__/availabilityPhase01.test.ts` | Focused Phase 0+1 tests |
| `docs/availability-phase-0-1-implementation.md` | This report |

### Modified

| File | Change |
|------|--------|
| `src/app/api/bookings/route.ts` | Phase 0 fence, deprecation markers, structured logs on POST create |
| `src/lib/bookingAvailabilityEngine.ts` | Import shared window loader; add `reasonCode` / `employeeReasons` on slot results |
| `src/lib/booking/publicBookingAvailability.ts` | Forward reason codes on empty public slots |
| `src/app/api/public/booking/available-slots/route.ts` | Include `reasonCode` / `employeeReasons` for ops/admin path |
| `src/lib/availabilityEngine.ts` | `getBarbersDayStatus` uses `loadWorkingWindowsBatch`; optional `branchId` |
| `src/lib/operations/loadFlowBoardForBranch.ts` | Passes `branchId` into day-status |
| `src/app/api/operations/schedule-control/route.ts` | Passes session `branchId` into day-status |
| `src/lib/scheduleIntegrity.ts` | `getEmployeeEffectiveSchedule` → `resolveEmployeeDayPlan`; optional `branchId` on assert |
| `src/lib/booking/publicBookingCreate.ts` | Passes `branchId` into write guard |
| `src/lib/operationsQueueCreateCore.ts` | Passes `branchId` into write guard |
| `src/lib/barberAvailability.ts` | `getBarberWorkingWindow` delegates to shared loader |
| `src/lib/businessDate.ts` | (unchanged owner) — canonical operational date |
| `src/components/operations/schedulerUtils.ts` | Delegates Cairo business date to `businessDate.ts` |
| `src/app/api/operations/flow-board/route.ts` | Returns `businessDate`, `timezone`, `cutoffHour` |
| `src/app/queue/new/page.tsx` | Uses `getOperationalDate` instead of UTC `toISOString` |
| `src/components/hr/AttendancePanel.tsx` | Active work date via `getOperationalDate` |
| `src/components/pos/AttendancePanelModal.tsx` | Same |
| `src/lib/__tests__/bookingMoveValidation.test.ts` | Mocks updated for day-plan dependency |

**Not changed (intentional):** `DailyPayrollPanel` / payroll `getBusinessDateStr` (5 AM local payroll day semantics).

---

## Canonical resolver contract

```ts
resolveEmployeeDayPlan({
  branchId?,      // preferred for branch-scoped weekly + transfers
  empId,
  businessDate,   // YYYY-MM-DD operational date
  source?,        // 'public' | 'operations' | 'admin'
  transaction?,   // optional TX connection for reads
}) → EmployeeDayPlan
```

`EmployeeDayPlan` includes:

- `employeeId`, `branchId`, `businessDate`
- `isWorking`, `effectiveWindows[]` (start/end/endDayOffset/startMs/endMs)
- `baseScheduleSource`: `BRANCH_WEEKLY` | `LEGACY_WEEKLY` | `TEMPORARY_TRANSFER` | `FREELANCE_UNLOCK` | `NONE`
- `weeklyWindows`, `appliedOverrides`, `attendanceState`
- `denyReasonCode`, `warnings`, `effSched`, `isOvernight`

**Proven behavior reused (not rewritten):**

- `loadWorkingWindowsBatch` (branch table + temporary transfers + legacy fallback / assignment-scoped branch when `branchId` omitted)
- Freelance unlock merge
- `applyOverrides` (day_off, custom_hours, late_start, early_leave, block_range)
- Overnight end ≤ start → next-day `endMs`
- Day-off / Absent exclusion

Batch helper: `resolveEmployeeDayPlansBatch`.

---

## Old readers replaced

| Former reader | Replacement |
|---------------|-------------|
| Flow-board `getBarbersDayStatus` → `TblEmpWorkSchedule` only | Same function, now `loadWorkingWindowsBatch` + `branchId` from flow-board / schedule-control |
| `scheduleIntegrity.getEmployeeEffectiveSchedule` → `getBarberWorkingWindow` + local overrides | `resolveEmployeeDayPlan` |
| Engine-private duplicate `loadWorkingWindowsBatch` | Shared `src/lib/availability/loadWorkingWindowsBatch.ts` |
| `getBarberWorkingWindow` independent SQL | Shared loader (+ freelance unlock) |
| Client duplicate Cairo 4 AM in `schedulerUtils` | Re-export of `getOperationalDate` / `getCairoBusinessDate` |
| Queue new UTC calendar date | `getOperationalDate` |
| Attendance panel 5 AM `getBusinessDateStr` for ops work day | `getOperationalDate` (Cairo 4) |

---

## Remaining legacy readers

| Path | Why not fully migrated |
|------|------------------------|
| `getBarberDayStatus` (singular) in `availabilityEngine.ts` | Still used by `checkBarberAvailableAt`; batch path is the ops board SoT. Singular can be migrated in Phase 2. |
| `queueEstimateEngine` / `operationsQueueTimeline` / `bookingRescheduleCore` pre-checks | Still call `getBarberWorkingWindow` for **base** weekly windows; write path uses `assertEmployeeIntervalAvailable` → day plan. Base loader is now shared. |
| `employeeBranchScheduleResolver` | HR global calendar reporting — not a booking write guard. |
| Admin debug overnight route | Diagnostic only. |
| Payroll / `getBusinessDateStr` (5 AM) | Explicitly preserved payroll day semantics. |

---

## Legacy endpoint callers

Confirmed **create** callers of `POST /api/bookings`:

| Caller | Migratable to canonical create? |
|--------|----------------------------------|
| `src/app/bookings/new/page.tsx` | **Yes** — should move to `POST /api/public/booking/create` (`source=admin` or ops) once fence is validated in prod |
| Direct/API clients / scripts hitting the same route | Unknown — fence logging + `canonicalCreateEligible` flag measures them |

Non-create usages (GET list, PATCH cancel/update, convert) are **out of fence scope**.

Canonical create already used by operations booking workspace / public booking.

---

## Feature flag behavior

```text
LEGACY_BOOKINGS_CREATE_ENABLED
```

- **Default:** enabled (`true`) — preserves production.
- **Disable:** `false` / `0` / `off` / `no` → HTTP **410** with:

```json
{
  "success": false,
  "code": "LEGACY_BOOKING_CREATE_DISABLED",
  "message": "This booking path is no longer available."
}
```

Every call logs JSON under `[legacy-booking-create]` with path, caller/source headers, branchId, empId, booking date/time, userId, requestId, outcome, and `canonicalCreateEligible` — **no customer PII**.

Parity diagnostics: `AVAILABILITY_PARITY_DIAG=1` or `NODE_ENV=development` (mismatch-only logs).

---

## Business-date call sites changed

| Site | Before | After |
|------|--------|-------|
| `schedulerUtils.getCairoBusinessDate` | Local duplicate Cairo&lt;4 | `businessDate.getCairoBusinessDate` |
| `GET /api/operations/flow-board` | `date` only | + `businessDate`, `timezone`, `cutoffHour` |
| `src/app/queue/new/page.tsx` | UTC `toISOString().slice(0,10)` | `getOperationalDate()` |
| `AttendancePanel` / `AttendancePanelModal` | `getBusinessDateStr` (local 5 AM) | `getOperationalDate()` (Cairo 4) |
| Booking workspace | Already on `getOperationalDate` | Unchanged |

Canonical policy (unchanged owner `getOperationalDate`):

```text
Branch timezone / Cairo
Before 04:00 → previous calendar date
At or after 04:00 → current calendar date
```

---

## Reason codes introduced

Constants in `AVAILABILITY_REASON_CODES` (including `NO_EMPLOYEE_AVAILABLE`).

APIs:

- `listAvailableBookingSlots` → `reasonCode`, `employeeReasons[]`, keeps `noSlotsReason`
- Ops/admin available-slots JSON includes the new fields
- Public slots response adds `reasonCode` / `message` / `employeeReasons` when empty

Legacy per-slot codes (`booking_conflict`, etc.) still exist on slot plans; envelope maps them via `mapLegacySlotReason`.

---

## API compatibility notes

- Existing clients that only read `slots` / `noSlotsReason` / `availableSlots` keep working.
- New optional fields are additive.
- Legacy POST create when enabled behaves as before (plus logs).
- Flow-board payload gains fields; existing `date` / `barbers` unchanged.
- No schema migrations.

---

## Tests added

`src/lib/__tests__/availabilityPhase01.test.ts`:

- Business date 03:59 / 04:00 Cairo
- Ops/queue/attendance call-site contracts
- Reason code catalog + mapping + deny inference
- Legacy fence default/disable + route markers
- Wiring contracts (integrity, flow-board, shared loader)
- Override math: off-day, custom_hours, late_start, early_leave, block_range, day_off, overnight
- Parity category constants

Regression suites re-run: `bookingOperationalDate`, `bookingAvailabilityEngine`, `bookingCreateCanonicalContract`, `bookingMoveValidation`, `bookingAvailabilityDuration`.

---

## Commands executed

```text
npx vitest run src/lib/__tests__/availabilityPhase01.test.ts src/lib/__tests__/bookingOperationalDate.test.ts src/lib/__tests__/bookingAvailabilityEngine.test.ts
npx vitest run src/lib/__tests__/bookingCreateCanonicalContract.test.ts src/lib/__tests__/bookingMoveValidation.test.ts src/lib/__tests__/bookingAvailabilityDuration.test.ts
npx vitest run src/lib/__tests__/bookingMoveValidation.test.ts   # after mock fix
```

---

## Known limitations

1. Singular `getBarberDayStatus` not yet on branch-scoped batch loader.
2. Reschedule pre-validation still uses base `getBarberWorkingWindow` + local overrides; final write uses day plan.
3. `resolveEmployeeDayPlansBatch` is N parallel day-plan calls — fine for board sizes; can be optimized later.
4. Per-employee reason codes on empty nearest mode are best-effort from rejected slot plans (not full day-plan deny for every emp).
5. Legacy create is **fenced**, not redirected to canonical create (zero behavioral ambiguity).
6. Payroll 5 AM business date intentionally untouched.
7. No live DB integration tests for transfer / dual-branch schedules in this phase (contract + override unit coverage).

---

## Recommended Phase 2 scope

1. Redirect or migrate `bookings/new` → canonical `createPublicBooking`; then default-disable legacy flag.
2. Introduce daily adjustment model / close triple day-off sources.
3. Centralized workforce availability admin UI.
4. Migrate singular day-status + estimate timeline fully onto `resolveEmployeeDayPlan`.
5. Richer public reason codes without collapsing distinct causes.
6. Optional holds / service capability tables as previously blueprinted.

---

```text
PHASE 0 + PHASE 1 COMPLETE
NO SCHEMA CONSOLIDATION OR CENTRALIZED UI IMPLEMENTED
```
