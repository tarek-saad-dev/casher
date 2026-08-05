# Availability Phase 3C — Runtime Shortcut Audit

**Date:** 2026-08-03  
**Goal:** Classify every production use of primary-window / outer-bound shortcuts and migrate runtime eligibility to all `effectiveWindows`.

Search terms:

```text
effectiveWindows[0]
selectPrimaryEffectiveWindow
shiftStartMs / shiftEndMs
workStartAt / workEndAt / workStart / workEnd
getEmployeeEffectiveSchedule
```

---

## Critical runtime files

| File | Classification | After 3C |
|------|----------------|----------|
| `bookingAvailabilityEngine.ts` | **Runtime eligibility / slot generation — migrated** | `iterateWindowSlotStarts` + containment |
| `booking/publicBookingAvailability.ts` | **Slot generation — migrated** (delegates to engine; no primary shortcuts) | Contract-audited |
| `booking/publicBookingCreate.ts` | **Runtime eligibility — migrated** via `assertEmployeeIntervalAvailable` | No primary shortcuts |
| `scheduleIntegrity.ts` | **Runtime eligibility — migrated** | `findWindowContainingInterval` |
| `bookingRescheduleCore.ts` | **Runtime eligibility — migrated** | Multi-window precheck + TX guard |
| `queueEstimateEngine.ts` | **Queue simulation — migrated** | All-window starts + earliest fit |
| `operationsQueueTimeline.ts` | **Queue simulation — migrated**; outer workStart/End display-only | `workingWindows` / `segments` |
| `booking/publicAvailableDaysRange.ts` | **Slot generation / day probe — migrated** | All-window probes |

Contract test in `availabilityPhase3C.test.ts` fails if any critical file contains:

- `effectiveWindows[0]`
- `selectPrimaryEffectiveWindow`

---

## Display / adapter / debug (allowed)

| File | Usage | Classification |
|------|-------|----------------|
| `effectiveWindows.ts` | Defines `selectPrimaryEffectiveWindow` | Legacy/debug helper (documented) |
| `explainAvailability.ts` | `primaryWindow` on day explain | Display-only |
| `mapEmployeeDayPlanToBarberDayStatus.ts` | Primary for UI status card | Display-only |
| `dayPlanParity.ts` | Primary vs legacy compare | Legacy/debug |
| `resolveEmployeeDayPlan.ts` | Singular `effSched` from primary | Compatibility response envelope |
| `AvailabilityDayTimeline.tsx` | Renders **all** windows | Display-only (success label) |
| `api/bookings/estimate/route.ts` | Formats all windows for display | Display-only |

---

## Outer bounds (display / load — not eligibility)

| Symbol | Allowed use | Forbidden use |
|--------|-------------|----------------|
| `shiftStartMs` / `shiftEndMs` | Next-day busy load filter; display | Containment / slot acceptance |
| `workStart` / `workEnd` | Timeline outer labels | Simulation eligibility |
| `getEmployeeEffectiveSchedule` | Compat singular bounds + `effectiveWindows` | Treating singular bounds as sole eligibility |
| `outerDisplayBounds()` / `getEffectiveWindowsOuterBounds()` | Explicit display helper | Runtime write/slot checks |

Flattening multiple windows into one outer range for **eligibility** remains forbidden:

```ts
// FORBIDDEN for eligibility
const shiftStart = Math.min(...windows.map(...));
const shiftEnd = Math.max(...windows.map(...));
```

---

## Test fixtures

| File | Notes |
|------|-------|
| `bookingMoveValidation.test.ts` | Mock windows use real absolute ms |
| `availabilityPhase3C.test.ts` | Helpers, slots, explain, contract audit |
| Phase 2.5 consumer tests | Display paths may still call `selectPrimary` |

---

## Residual risk

1. New consumers calling `selectPrimaryEffectiveWindow` for eligibility — mitigated by contract audit + module comments.
2. Callers that only pass singular `shiftStartMs/EndMs` into `evaluateBookingSlotAt` without `effectiveWindows` — legacy singular path retained; prefer windows.
3. `getEmployeeBusyIntervals` filters next-day busy with outer bounds — correct for loading occupancy; eligibility still uses containment.
