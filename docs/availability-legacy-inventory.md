# Availability Legacy Inventory

**Date:** 2026-08-03  
**Phase:** 2.5 Hardening  
**Policy:** Do not delete. Mark classification. Prefer canonical day-plan for new work.

---

## Classification legend

| Tag | Meaning |
|-----|---------|
| **Production** | Still on a hot booking/ops path |
| **Legacy** | Superseded by canonical APIs; retained for compatibility |
| **Debug only** | Admin/debug tooling |
| **HR only** | HR schedule / attendance ownership, not booking write guards |

---

## Inventory

| Symbol | File | Classification | Notes |
|--------|------|----------------|-------|
| `resolveEmployeeDayPlan` / `resolveEmployeeDayPlansBatch` | `src/lib/availability/resolveEmployeeDayPlan.ts` | **Production** | Canonical day-plan reader |
| `loadEmployeeDayPlanInputsBatch` | `src/lib/availability/loadEmployeeDayPlanInputsBatch.ts` | **Production** | Shared batch inputs |
| `buildEmployeeDayPlanFromInputs` | same | **Production** | Pure builder |
| `getEmployeeEffectiveSchedule` | `src/lib/scheduleIntegrity.ts` | **Production** | Write-guard windows |
| `assertEmployeeIntervalAvailable` | same | **Production** | SERIALIZABLE write guard |
| `getEmployeeBusyIntervals` | same | **Production** | Occupancy + blocks |
| `explainAvailability` | `src/lib/availability/explainAvailability.ts` | **Production** (debug/tooling) | Read-only explain; no API yet |
| `selectPrimaryEffectiveWindow` / `iterateEffectiveWindows` / `findContainingWindow` / `findNextWindow` | `src/lib/availability/effectiveWindows.ts` | **Production** | Multi-window foundation |
| `getBarberDayStatus` / `getBarbersDayStatus` | `src/lib/availabilityEngine.ts` | **Production** | Adapter → BarberDayStatus UI |
| `checkBarberAvailableAt` | same | **Production** (compat) | Thin day-status check |
| `listAvailableBookingSlots` | `src/lib/bookingAvailabilityEngine.ts` | **Production** | Public/ops slot grid |
| `createPublicBooking` | `src/lib/booking/publicBookingCreate.ts` | **Production** | Canonical create |
| `buildBarberOperationalTimeline` / `simulateQueueInsertion` | `src/lib/operationsQueueTimeline.ts` | **Production** | Ops queue |
| `hasAnyAvailableSlotForBarberOnDay` | `src/lib/queueEstimateEngine.ts` | **Production** | Day availability helper |
| `loadWorkingWindowsBatch` | `src/lib/availability/loadWorkingWindowsBatch.ts` | **Production** | Shared weekly loader |
| `loadFreelanceBookingUnlocks` | `src/lib/hr/freelanceBookingUnlock.ts` | **Production** | TX-aware as of 2.5 |
| `getGlobalTimingDefaults` | `src/lib/publicBookingHelpers.ts` | **Production** | TX-aware as of 2.5 |
| `getDefaultSchedule` | `src/lib/availabilityEngine.ts` | **Legacy** | `@deprecated` — schedule-control preview only |
| `getDayOff` / `getAttendanceStatus` / `getScheduleOverrides` | same | **Legacy** | Prefer day-plan batch inputs |
| `getBarberWorkingWindow` | `src/lib/barberAvailability.ts` | **Legacy** / **HR only** / **Debug only** | `@deprecated` — GLEEM HR fallback + admin overnight debug |
| `getBarberAvailabilityReason` / `isBarberWorkingAt` | same | **Legacy** | Older weekly-window helpers |
| `POST /api/bookings` (create) | `src/app/api/bookings/route.ts` | **Legacy** | Fenced by `LEGACY_BOOKINGS_CREATE_ENABLED` (default on) |
| `ensureEmpBranchWorkScheduleTable` | `src/lib/hr/empBranchWorkSchedule.ts` | **Production** (DDL) | May use pool even inside TX — intentional exception |
| Admin overnight debug route | `src/app/api/admin/debug/overnight-availability/route.ts` | **Debug only** | Still calls `getBarberWorkingWindow` |
| `employeeBranchScheduleResolver` legacy fallback | `src/lib/hr/employeeBranchScheduleResolver.ts` | **HR only** | GLEEM-only `getBarberWorkingWindow` fallback |
| `scheduleControlPreview` / `computePreview` | `src/lib/scheduleControlPreview.ts` | **Legacy** / **Production** (ops UI) | Still uses `getDefaultSchedule` — migrate in Phase 3 |

---

## Migration guidance

1. New booking/ops availability code → `resolveEmployeeDayPlan` / batch.
2. Effective hours (overrides, absence, transfers) → never `getBarberWorkingWindow`.
3. UI day status → `getBarberDayStatus` (already day-plan backed).
4. Debugging → `explainAvailability` (preferred over ad-hoc SQL).
5. Do not remove legacy exports until Phase 3 cutover metrics are green.

---

## Intentionally retained exceptions

| Exception | Why |
|-----------|-----|
| Legacy create route | External unknown callers; flag-gated |
| `getDefaultSchedule` | schedule-control preview not yet migrated |
| `getBarberWorkingWindow` | HR GLEEM fallback + debug route |
| DDL ensure on pool during TX | Schema ensure must not run inside SERIALIZABLE booking TX |
