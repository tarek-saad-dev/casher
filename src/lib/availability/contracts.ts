/**
 * Phase 2.5 — Canonical availability contract catalog (documentation + type re-exports).
 *
 * Every canonical function should expose consistent identity fields:
 *   businessDate, branchId, denyReasonCode, effectiveWindows, warnings
 *
 * This module does not change runtime behavior — it documents and re-exports
 * the stable contracts for tooling and tests.
 */

export type {
  DayPlanWindow,
  EmployeeDayPlan,
  DayPlanAttendanceState,
  EmployeeDayPlanBatchInputs,
} from '@/lib/availability/resolveEmployeeDayPlan';

export type { AvailabilityReasonCode, EmployeeAvailabilityReason } from '@/lib/availability/reasonCodes';

export type {
  AvailabilityExplanation,
  AvailabilityExplainResult,
} from '@/lib/availability/explainAvailability';

export type { DayPlanWindow as EffectiveWindow } from '@/lib/availability/resolveEmployeeDayPlan';

/** Required identity fields on any day-scoped availability artifact. */
export type CanonicalAvailabilityIdentity = {
  businessDate: string;
  branchId: number | null;
  employeeId?: number;
};

/** Required outcome fields on day-plan style contracts. */
export type CanonicalDayPlanOutcome = {
  denyReasonCode: import('@/lib/availability/reasonCodes').AvailabilityReasonCode | null;
  effectiveWindows: import('@/lib/availability/resolveEmployeeDayPlan').DayPlanWindow[];
  warnings: string[];
  isWorking: boolean;
};

/**
 * Exported contract inventory (names only — see implementation modules for signatures).
 *
 * Canonical (Production):
 * - resolveEmployeeDayPlan / resolveEmployeeDayPlansBatch
 * - loadEmployeeDayPlanInputsBatch / buildEmployeeDayPlanFromInputs
 * - getEmployeeEffectiveSchedule / assertEmployeeIntervalAvailable / getEmployeeBusyIntervals
 * - explainAvailability / explainEmployeeDayPlan
 * - iterateEffectiveWindows / findContainingWindow / findNextWindow / selectPrimaryEffectiveWindow (display)
 * - findWindowContainingPoint / findWindowContainingInterval / isIntervalInsideAnyEffectiveWindow
 * - findNextEffectiveWindow / findNextAvailablePointInWindows
 * - iterateWindowSlotStarts / findEarliestFitInWindows / getEffectiveWindowsOuterBounds (display outer)
 * - mapEmployeeDayPlanToBarberDayStatus
 * - listAvailableBookingSlots / evaluateBookingSlotAt
 * - createPublicBooking (write path)
 * - getEmployeeEffectiveWindows / explainAvailabilityInterval / explainEmployeeDayPlanInterval
 *
 * Adapter (Production, maps to BarberDayStatus UI contract):
 * - getBarberDayStatus / getBarbersDayStatus / checkBarberAvailableAt
 *
 * Legacy / HR / Debug — see docs/availability-legacy-inventory.md
 */
export const CANONICAL_AVAILABILITY_EXPORTS = [
  'resolveEmployeeDayPlan',
  'resolveEmployeeDayPlansBatch',
  'loadEmployeeDayPlanInputsBatch',
  'buildEmployeeDayPlanFromInputs',
  'applyDailyAdjustments',
  'loadDailyAdjustmentsBatch',
  'getEmployeeEffectiveSchedule',
  'getEmployeeEffectiveWindows',
  'assertEmployeeIntervalAvailable',
  'explainAvailability',
  'explainAvailabilityInterval',
  'explainEmployeeDayPlanInterval',
  'selectPrimaryEffectiveWindow',
  'iterateEffectiveWindows',
  'findContainingWindow',
  'findWindowContainingPoint',
  'findNextWindow',
  'findNextEffectiveWindow',
  'findWindowContainingInterval',
  'isIntervalInsideAnyEffectiveWindow',
  'findNextAvailablePointInWindows',
  'iterateWindowSlotStarts',
  'findEarliestFitInWindows',
  'getEffectiveWindowsOuterBounds',
] as const;
