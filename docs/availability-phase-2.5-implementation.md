# Availability Architecture — Phase 2.5 Implementation

**Date:** 2026-08-03  
**Status:** Complete  
**Base:** [`docs/availability-phase-2-implementation.md`](./availability-phase-2-implementation.md)  
**Companions:** [`availability-legacy-inventory.md`](./availability-legacy-inventory.md), [`availability-performance-report.md`](./availability-performance-report.md)

This phase is **hardening & performance** — not a product feature release. No schema redesign, no workforce UI, no intentional behavior regressions.

---

## 1. Executive summary

Phase 2.5 closes the architectural debt called out at the end of Phase 2:

| Theme | Outcome |
|-------|---------|
| **Transaction context** | Freelance unlocks + global timing bind to optional `Transaction`; day-plan batch runs sequentially on TX |
| **Multi-window foundation** | Shared helpers replace `effectiveWindows[0]` indexing; product still selects **first** window |
| **Explain engine** | Read-only `explainAvailability` / `explainEmployeeDayPlan` over canonical plans |
| **Performance** | Documented O(K) schedule SQL vs former O(N·K); benchmark harness added |
| **Legacy isolation** | Inventory + `@deprecated` on remaining weekly helpers |
| **Contracts** | Canonical export catalog + identity field norms |

Production APIs remain backward-compatible. No end-user-visible features.

---

## 2. Files changed

### Added

| File | Role |
|------|------|
| `src/lib/availability/effectiveWindows.ts` | Multi-window helpers |
| `src/lib/availability/explainAvailability.ts` | Explain engine |
| `src/lib/availability/contracts.ts` | Contract catalog / type re-exports |
| `src/lib/__tests__/availabilityPhase25.test.ts` | Hardening tests |
| `src/lib/__tests__/availabilityBenchmarks.test.ts` | Non-gating benchmarks |
| `docs/availability-phase-2.5-implementation.md` | This report |
| `docs/availability-legacy-inventory.md` | Legacy inventory |
| `docs/availability-performance-report.md` | Performance report |

### Modified

| File | Change |
|------|--------|
| `src/lib/hr/freelanceBookingUnlock.ts` | `transaction?` in options; sequential on TX |
| `src/lib/publicBookingHelpers.ts` | `getGlobalTimingDefaults({ transaction? })` |
| `src/lib/availability/loadEmployeeDayPlanInputsBatch.ts` | Full TX binding; sequential path |
| `src/lib/scheduleIntegrity.ts` | Window helper; timing via TX |
| `src/lib/bookingRescheduleCore.ts` | Window helper |
| `src/lib/operationsQueueTimeline.ts` | Window helper |
| `src/lib/queueEstimateEngine.ts` | Window helper |
| `src/lib/availability/mapEmployeeDayPlanToBarberDayStatus.ts` | Window helper |
| `src/lib/availability/dayPlanParity.ts` | Window helper |
| `src/app/api/bookings/estimate/route.ts` | Window helper |
| `src/lib/availabilityEngine.ts` | `transaction?` on day-status; deprecate `getDefaultSchedule` |
| `src/lib/barberAvailability.ts` | Deprecate `getBarberWorkingWindow` |

---

## 3. Transaction improvements

**Before (Phase 2 limitation):** day-plan batch accepted `transaction` for windows/overrides/attendance/day-off but **always** called `getGlobalTimingDefaults()` and `loadFreelanceBookingUnlocks()` on the pool.

**After (2.5):**

- `loadFreelanceBookingUnlocks(..., { transaction })` uses the TX connection; queries are **sequential** on TX (mssql one-request rule).
- `getGlobalTimingDefaults({ transaction })` reads settings on the TX (bypasses process cache for consistency).
- `loadEmployeeDayPlanInputsBatch` on TX runs the full input load **sequentially** on that connection.
- `getEmployeeEffectiveSchedule` / `getEmployeeBusyIntervals` / `assertEmployeeIntervalAvailable` pass TX into timing defaults.
- `getBarberDayStatus` / `getBarbersDayStatus` accept optional `transaction`.

### Remaining intentional exception

`ensureEmpBranchWorkScheduleTable` (DDL) inside `loadWorkingWindowsBatch` may still use the **pool**. Schema ensure must not participate in SERIALIZABLE booking transactions. Documented in the batch loader header and legacy inventory.

---

## 4. Multi-window foundation

New helpers (`src/lib/availability/effectiveWindows.ts`):

- `iterateEffectiveWindows` — chronological copy
- `findContainingWindow(pointMs)`
- `findNextWindow(fromMs)`
- `selectPrimaryEffectiveWindow` — default policy **`first`** (preserves current product behavior)

All former `effectiveWindows[0]` production call sites now use `selectPrimaryEffectiveWindow`. **Public slot/timeline behavior unchanged** (still one outer window). Architecture is ready for multi-window generators in Phase 3.

---

## 5. Explain engine

`src/lib/availability/explainAvailability.ts`:

- `explainAvailability({ empId, businessDate, branchId?, transaction? })` → resolve once → explain
- `explainEmployeeDayPlan(plan)` — pure, no DB

Produces `AvailabilityExplanation` with result, reasonCode, scheduleSource, windows, attendance, overrides, transfer/freelance flags, blockedIntervals, warnings, evaluationTimeline. **No HTTP API** in this phase.

---

## 6. Performance report summary

See [`docs/availability-performance-report.md`](./availability-performance-report.md).

| | Before batch | After Phase 2/2.5 |
|--|--------------|-------------------|
| Schedule SQL | O(N·K) | O(K) shared |
| Plan CPU | O(N) | O(N) pure |
| TX freelance/timing | Pool leak | TX-bound |

---

## 7. Legacy inventory

See [`docs/availability-legacy-inventory.md`](./availability-legacy-inventory.md).

Notable `@deprecated` markers:

- `getDefaultSchedule` — Legacy (schedule-control preview)
- `getBarberWorkingWindow` — Legacy / HR / Debug

Not deleted; behavior unchanged.

---

## 8. Benchmarks

`src/lib/__tests__/availabilityBenchmarks.test.ts` — always passes; optional:

```text
AVAILABILITY_BENCH=1 npx vitest run src/lib/__tests__/availabilityBenchmarks.test.ts
```

Covers pure plan build, explain, window helpers. Live DB targets listed for staging measurement.

---

## 9. Tests run

```text
npx vitest run src/lib/__tests__/availabilityPhase25.test.ts src/lib/__tests__/availabilityBenchmarks.test.ts src/lib/__tests__/availabilityPhase2.test.ts src/lib/__tests__/availabilityPhase01.test.ts src/lib/__tests__/bookingOperationalDate.test.ts src/lib/__tests__/bookingAvailabilityEngine.test.ts src/lib/__tests__/bookingCreateCanonicalContract.test.ts src/lib/__tests__/bookingMoveValidation.test.ts src/lib/__tests__/bookingAvailabilityDuration.test.ts src/lib/__tests__/bookingReschedule.test.ts src/lib/__tests__/phase1qEmployeeBranchSchedule.test.ts src/lib/__tests__/phase1rEmployeeScheduleOperations.test.ts src/lib/__tests__/attendance-shift-schedule-sync.test.ts src/lib/__tests__/phase1oCampCaesarOvernightHours.test.ts
```

**Result: 14 files / 164 tests passed.**

---

## 10. Remaining technical debt

1. `scheduleControlPreview` still uses `getDefaultSchedule`.
2. `buildBarberContexts` still loads windows/overrides separately from day-plan reason enrichment.
3. Slot/timeline generators still **select** one primary window (by design until product multi-window).
4. Legacy create flag still default-enabled.
5. Live staging p95 timings not yet appended to the performance report.
6. Admin overnight debug still calls `getBarberWorkingWindow`.

---

## 11. Readiness assessment for Phase 3

| Prerequisite | Status |
|--------------|--------|
| Canonical create + readers | Done (Phase 2) |
| Batch day-plan + TX-consistent reads | Done (2.5) |
| Multi-window helper surface | Done (behavior still first-window) |
| Explain / debug without duplicate math | Done |
| Legacy labeled, not deleted | Done |
| Safe to plan legacy create cutover | **Ready** |
| Safe to plan multi-window slot gen | **Ready** |
| Workforce UI / Daily Adjustment | Out of scope — Phase 3+ product |

**Verdict:** Canonical availability is hardened for Phase 3 feature work (legacy fence cutover, multi-window generation, preview migration) without schema consolidation.

---

```text
PHASE 2.5 COMPLETE

CANONICAL AVAILABILITY HARDENED

READY FOR PHASE 3
```
