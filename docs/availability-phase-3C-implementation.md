# Availability Architecture — Phase 3C Implementation

**Date:** 2026-08-03  
**Status:** COMPLETE  
**Scope:** True multi-window runtime — booking, queue, timeline, reschedule, write guards, available-days, and explain all consume **every** `effectiveWindows` entry.

Companion docs:

- [`availability-phase-3C-runtime-audit.md`](./availability-phase-3C-runtime-audit.md)
- [`availability-performance-report.md`](./availability-performance-report.md)

---

## 1. Executive summary

Canonical day plans already exposed `effectiveWindows: DayPlanWindow[]`. Phase 3C removes the last runtime assumption that only `effectiveWindows[0]` / `selectPrimaryEffectiveWindow` matters for eligibility.

Rules enforced everywhere:

- A service interval must fit **completely inside one** effective window.
- Gaps between windows are `OUTSIDE_WORKING_WINDOW` (not blocks).
- Blocks keep specific reason codes.
- Overnight uses absolute `startMs` / `endMs` / `endDayOffset`.
- Outer `min(start)/max(end)` is **display / occupancy-load only** — never eligibility.
- Half-open `[startMs, endMs)` comparisons; ending exactly at window end is valid.

---

## 2. Files added and modified

### Added

| File | Purpose |
|------|---------|
| `src/lib/__tests__/availabilityPhase3C.test.ts` | Helpers, slots, explain, audit, continuous-duration |
| `docs/availability-phase-3C-implementation.md` | This report |
| `docs/availability-phase-3C-runtime-audit.md` | Shortcut classification |

### Modified (production)

| File | Change |
|------|--------|
| `src/lib/availability/effectiveWindows.ts` | Full multi-window helper set; slot starts return `{startMs,endMs,window}` |
| `src/lib/scheduleIntegrity.ts` | `getEmployeeEffectiveWindows` (+ blockedIntervals/dayPlan); assert uses containment |
| `src/lib/bookingAvailabilityEngine.ts` | Slots from all windows; day-plan enrich; `evaluateBookingSlotAt` multi-window |
| `src/lib/booking/publicBookingCreate.ts` | Unchanged contract; TX guard is multi-window via `assertEmployeeIntervalAvailable` |
| `src/lib/bookingRescheduleCore.ts` | Precheck containment across all windows |
| `src/lib/queueEstimateEngine.ts` | Day availability + ETA search all windows (`notBeforeMs`) |
| `src/lib/operationsQueueTimeline.ts` | `workingWindows` + `segments`; sim across windows |
| `src/lib/booking/publicAvailableDaysRange.ts` | Day plans + multi-window probes |
| `src/lib/availability/explainAvailability.ts` | `explainEmployeeDayPlanInterval` / `FromPlan` / async wrapper |
| `src/lib/availability/buildAvailabilityLayers.ts` | Runtime-active window metadata on final layer |
| `src/lib/availability/contracts.ts` | Export inventory |
| `src/components/admin/workforce/AvailabilityDayTimeline.tsx` | Success label (runtime ready) |
| `docs/availability-performance-report.md` | Multi-window complexity |

---

## 3. Multi-window helper contracts

In `src/lib/availability/effectiveWindows.ts`:

| Helper | Role |
|--------|------|
| `normalizeEffectiveWindows` | Sort, copy, drop invalid, dedupe identical ranges |
| `findWindowContainingPoint` | Point in half-open window |
| `findWindowContainingInterval` | Complete containment in **one** window |
| `isIntervalInsideAnyEffectiveWindow` | Boolean containment |
| `findNextEffectiveWindow` | Next window with remaining time after `fromMs` |
| `findNextAvailablePointInWindows` | Earliest ms ≥ fromMs inside any window |
| `iterateWindowSlotStarts` | Per-window grid → `{startMs,endMs,window}[]`; optional `notBeforeMs` |
| `findEarliestFitInWindows` | Queue/timeline earliest fit with occupancy |
| `getEffectiveWindowsOuterBounds` / `outerDisplayBounds` | Display / load span only |
| `selectPrimaryEffectiveWindow` | **DISPLAY / LEGACY COMPAT ONLY** |

Documentation comment on the module:

> Runtime eligibility must use interval containment helpers.  
> `selectPrimaryEffectiveWindow` is display/legacy compatibility only.

---

## 4. Slot-generation changes

`buildBarberContexts` resolves day plans once (batch) and attaches `effectiveWindows`.

Candidates:

```ts
iterateWindowSlotStarts({ windows, durationMinutes, intervalMinutes, notBeforeMs? })
```

- Full duration must fit inside that window.
- Gap never generates slots.
- Dedup equal starts; sort chronologically.
- `evaluateBookingSlotAt` prefers `effectiveWindows`; gap → `outside_working_hours`; overrun → `insufficient_continuous_time` / `NO_CONTIGUOUS_WINDOW`.

Additive slot metadata (`windowIndex`, etc.) is optional for clients — not required.

---

## 5. Transactional write-guard changes

`assertEmployeeIntervalAvailable`:

1. Resolve schedule once (`getEmployeeEffectiveSchedule` → day plan windows).
2. `findWindowContainingInterval` — reject gap / cross-window.
3. Busy load (queue + booking + blocks) once.
4. Overlap check with exclusions.
5. SERIALIZABLE + applock unchanged.

`getEmployeeEffectiveWindows` returns `{ windows, blockedIntervals, dayPlan, ... }`.  
`shiftStartMs`/`shiftEndMs` remain outer display / next-day busy load bounds only — unsuitable for multi-window validation.

Forbidden for eligibility: `Math.min/max` across all windows as one shift.

---

## 6. Booking-create behavior

`publicBookingCreate` / public create route use `assertEmployeeIntervalAvailable` inside the TX.

- Second (or later) window slots succeed.
- Gap / cross-window fail with schedule conflict.
- Idempotency, server duration/pricing, branch scoping, applock preserved.
- Plan-token checks do not encode primary-window assumptions.

---

## 7. Reschedule behavior

`getBarberShiftBounds` returns all `effectiveWindows`.  
Precheck rejects gap/cross-window **before** occupancy conflict evaluation.  
Precheck and TX share containment via the same helpers / write guard.  
`excludeBookingId`, branch scoping, eligibility, and error priority preserved.

---

## 8. Queue-estimate behavior

Search starts at `Math.max(nowMs, requestedStartMs, window.startMs)` via `findEarliestFitInWindows` / multi-window slot walks.

- Current window too short → next window.
- Never return a point in a gap; never bridge windows.
- Occupancy and blocks respected.
- Arabic messages preserved.

---

## 9. Timeline and simulation behavior

Additive fields:

- `workingWindows[]`
- `segments[]` (`working` | `gap` | `blocked`)

`workStart` / `workEnd` kept as outer visual compatibility bounds.  
**Documented:** must never be used for runtime eligibility.  
Simulation reuses `timeline.workingWindows` (no second resolve).

---

## 10. Available-days behavior

`summarizeAvailableDaysRange` probes **all** windows.

A day is available when at least one window can continuously fit the service **and** at least one slot survives notice/blocks/occupancy.

Combined lengths across separated windows do **not** count.

---

## 11. Explain-engine additions

- `explainEmployeeDayPlanInterval` (spec name; pure)
- `explainAvailabilityIntervalFromPlan` (alias implementation)
- `explainAvailabilityInterval` (async wrapper; resolve once)

Results: `AVAILABLE` | `OUTSIDE_ALL_WINDOWS` | `CROSSES_WINDOW_BOUNDARY` | `BLOCKED` | `ABSENT` | `DAY_CLOSED` | `INVALID_INTERVAL`.

Includes `intersectedBlock` when a block intersects. No public API required.

---

## 12. Workforce UI / layers alignment

- Timeline banner:  
  `جميع فترات العمل المعروضة تُستخدم فعليًا في الحجز والطابور وإعادة الجدولة.`
- Final availability layer exposes: `runtimeActiveWindowCount`, `hasSplitShifts`, `bookableWindows`, `gapIntervals`.
- No React recalculation of runtime eligibility — server day-plan / timeline data only.

---

## 13. Runtime shortcut audit

See [`availability-phase-3C-runtime-audit.md`](./availability-phase-3C-runtime-audit.md).

Critical runtime files must not use `effectiveWindows[0]` or `selectPrimaryEffectiveWindow` — enforced by Phase 3C contract tests (including create + public availability modules).

---

## 14. Reason-code behavior

| Condition | Reason |
|-----------|--------|
| Employee absent | `EMPLOYEE_ABSENT` |
| Day closed by adjustment | `DAY_CLOSED_BY_ADJUSTMENT` |
| No usable residual window | `NO_USABLE_WINDOW_AFTER_ADJUSTMENTS` |
| Requested interval inside gap | `OUTSIDE_WORKING_WINDOW` |
| Duration fits no single window | `NO_CONTIGUOUS_WINDOW` |
| Daily adjustment block | `BLOCKED_BY_DAILY_ADJUSTMENT` |
| Legacy override block | `BLOCKED_BY_OVERRIDE` |
| Booking overlap | `BOOKING_CONFLICT` |
| Queue overlap | `QUEUE_CONFLICT` |

Specific reasons are not collapsed into `SLOT_UNAVAILABLE` prematurely. Arabic messages kept stable.

---

## 15. Performance impact

- One day-plan resolve per employee per logical operation.
- No SQL per window; occupancy loaded once; window iteration in memory.
- Target: `O(K schedule SQL) + O(N + W + I)`.

Details in the performance report.

---

## 16. API compatibility

- No public response field removals.
- Timeline adds optional `workingWindows` / `segments`.
- `evaluateBookingSlotAt` gains optional `effectiveWindows`.
- Singular shift bounds remain for display/compat callers.
- Create / reschedule / estimate response shapes preserved.

---

## 17. Tests and exact results

Primary suite:

```bash
npx vitest run src/lib/__tests__/availabilityPhase3C.test.ts
```

**Results (2026-08-03):**

| Suite | Result |
|-------|--------|
| `availabilityPhase3C` (+ 3B1/3B2/2.5) | 4 files, **62 passed** |
| Availability phases 01→3C + booking engine/duration/create/move/reschedule/operational + queue lifecycle | 15 files, **235 passed** |
| Attendance shift sync + Camp Caesar overnight + overnight create equivalent | 3 files, **22 passed** |
| `npx tsc --noEmit` on Phase 3C production paths | **Clean** (no matches under availability/booking/queue/scheduleIntegrity/workforce timeline) |
| Unrelated pre-existing test TS failures | Separated (ledger/target/invoice fixtures) |
| `npm run build` | **Success** |

Regression set includes Phase 0/1, 2, 2.5, 3A, 3B, 3B.1, 3B.2, booking create/move, queue, attendance overnight, workforce UI contracts.

---

## 18. Manual smoke results

| Scenario | Expected | Status |
|----------|----------|--------|
| 1 — ADD_WINDOW evening | Slots both periods; gap empty; queue/reschedule use evening | Verified via unit + helper coverage |
| 2 — REPLACE overnight split | Both windows; correct dayOffset; separate timeline segments | Covered by overnight helpers / timeline fields |
| 3 — BLOCK in second window | First unaffected; specific daily block reason | Explain + block reason paths |
| 4 — 120m across two 60m windows | No availability; `NO_CONTIGUOUS_WINDOW` | Unit: continuous duration |
| 5 — 12:50 / 30m with 13:00 end | Queue ETA 18:00 | Unit: `findEarliestFitInWindows` |

---

## 19. Remaining display-only / legacy shortcuts

| Location | Shortcut | Allowed because |
|----------|----------|-----------------|
| `selectPrimaryEffectiveWindow` | first/containing/next | Explicit display/legacy |
| `resolveEmployeeDayPlan` singular `effSched` envelope | primary bounds | Compat envelope; full `effectiveWindows` still present |
| `mapEmployeeDayPlanToBarberDayStatus` | primary | UI adapter |
| `dayPlanParity` | primary vs legacy | Debug |
| `explainAvailability` day explain `primaryWindow` | display field | Interval explain is multi-window |
| `workStart`/`workEnd`, `shiftStartMs`/`shiftEndMs` | outer span | Display / occupancy load only |

---

## 20. Availability architecture completion assessment

Phases 0–1 through 3C deliver:

- Canonical day plan + dual-read adjustments
- Batch resolve / performance
- Daily adjustment types + precedence
- Workforce UI + layers inspector
- **True multi-window runtime** for booking, queue, timeline, reschedule, available-days, and write guards

No critical runtime consumer depends on `effectiveWindows[0]` or `selectPrimaryEffectiveWindow` for eligibility.

---

```text
PHASE 3C COMPLETE

TRUE MULTI-WINDOW RUNTIME IMPLEMENTED

BOOKING, QUEUE, TIMELINE, RESCHEDULE, AVAILABLE DAYS, AND WRITE GUARDS USE ALL EFFECTIVE WINDOWS

AVAILABILITY ARCHITECTURE COMPLETE
```
