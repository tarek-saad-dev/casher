/**
 * Phase C — Booking Workspace flow gates (presentation orchestration only).
 * Domain availability / create contracts live elsewhere and must stay untouched.
 */

export type OpsBookingFlowStep = 1 | 2 | 3;

export const OPS_BOOKING_FLOW_STEP_COUNT = 3 as const;

export const OPS_BOOKING_FLOW_LABELS = [
  'الخدمات',
  'الموعد',
  'العميل والتأكيد',
] as const;

/** Conflict / duration mismatch returns operator to Time (step 2), not a separate Review. */
export const OPS_BOOKING_CONFLICT_RECOVERY_STEP: OpsBookingFlowStep = 2;

export function opsBookingCanLeaveServices(args: {
  isDatePast: boolean;
  selectedServicesCount: number;
}): boolean {
  return !args.isDatePast && args.selectedServicesCount > 0;
}

export function opsBookingCanLeaveTime(args: {
  selectedSlot: { durationMinutes: number } | null;
  slotsAreCurrent: boolean;
  slotsViewState: 'idle' | 'loading' | 'ready' | 'empty' | 'error';
  totalDuration: number;
  mode: 'nearest' | 'specific';
  selectedBarberId: number | null;
}): boolean {
  if (args.mode === 'specific' && !args.selectedBarberId) return false;
  if (!args.selectedSlot) return false;
  if (!args.slotsAreCurrent) return false;
  if (args.slotsViewState !== 'ready') return false;
  return args.selectedSlot.durationMinutes === args.totalDuration;
}

export function opsBookingHasCustomer(args: {
  customerName: string;
  selectedClient: unknown | null;
}): boolean {
  return !!(args.customerName.trim() || args.selectedClient);
}

export function opsBookingCanSubmit(args: {
  canLeaveTime: boolean;
  hasCustomer: boolean;
}): boolean {
  return args.canLeaveTime && args.hasCustomer;
}

/** Visible fields must match selected client for submit (create uses name/phone). */
export function hydrateCustomerFieldsFromClient(client: {
  Name: string;
  Mobile?: string | null;
}): { customerName: string; customerPhone: string } {
  return {
    customerName: client.Name,
    customerPhone: client.Mobile || '',
  };
}

/**
 * Dependency invalidation (matches useBookingWorkspace behavior — do not invent rules):
 * - services / duration → slot
 * - mode / employee / branch → slot (+ matrix when scope changes)
 * - date → slot
 * - customer → nothing for availability
 */
export type OpsBookingInvalidationTarget = 'slot' | 'none';

export function opsBookingInvalidationForChange(
  change:
    | 'services'
    | 'duration'
    | 'mode'
    | 'employee'
    | 'branch'
    | 'date'
    | 'customer',
): OpsBookingInvalidationTarget {
  if (change === 'customer') return 'none';
  return 'slot';
}
