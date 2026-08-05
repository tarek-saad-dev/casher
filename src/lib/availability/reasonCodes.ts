/**
 * Structured availability reason codes (Phase 1C).
 * Keep Arabic/English messages for clients; codes are machine-readable.
 */

export const AVAILABILITY_REASON_CODES = [
  'BRANCH_CLOSED',
  'EMPLOYEE_INACTIVE',
  'NOT_ASSIGNED_TO_BRANCH',
  'SCHEDULE_NOT_CONFIGURED',
  'EMPLOYEE_OFF_DAY',
  'EMPLOYEE_ABSENT',
  'FREELANCER_NOT_PLANNED',
  /** Alias preferred in product copy — same semantics as FREELANCER_NOT_PLANNED when hours missing. */
  'FREELANCER_HOURS_NOT_CONFIGURED',
  'SERVICE_NOT_SUPPORTED',
  'OUTSIDE_WORKING_WINDOW',
  'OUTSIDE_BRANCH_HOURS',
  'BLOCKED_BY_BREAK',
  'BLOCKED_BY_OVERRIDE',
  'BLOCKED_BY_DAILY_ADJUSTMENT',
  'DAY_CLOSED_BY_ADJUSTMENT',
  'NO_USABLE_WINDOW_AFTER_ADJUSTMENTS',
  'BOOKING_CONFLICT',
  'QUEUE_CONFLICT',
  'HOLD_CONFLICT',
  'TRAVEL_BUFFER',
  'NO_CONTIGUOUS_WINDOW',
  'NO_EMPLOYEE_AVAILABLE',
  'MIN_NOTICE_NOT_MET',
  'MAX_ADVANCE_EXCEEDED',
  'SLOT_UNAVAILABLE',
  'BOOKING_TEMPORARILY_DISABLED',
  'AT_RISK',
] as const;

export type AvailabilityReasonCode = (typeof AVAILABILITY_REASON_CODES)[number];

export type EmployeeAvailabilityReason = {
  empId: number;
  reasonCode: AvailabilityReasonCode;
  message?: string;
};

/** Map legacy slot-plan reason strings to Phase-1 machine codes. */
export function mapLegacySlotReason(
  legacy?: string | null,
): AvailabilityReasonCode | undefined {
  switch (legacy) {
    case 'past':
    case 'outside_working_hours':
      return 'OUTSIDE_WORKING_WINDOW';
    case 'minimum_notice':
      return 'MIN_NOTICE_NOT_MET';
    case 'booking_conflict':
      return 'BOOKING_CONFLICT';
    case 'queue_conflict':
      return 'QUEUE_CONFLICT';
    case 'break':
      return 'BLOCKED_BY_BREAK';
    case 'daily_adjustment':
      return 'BLOCKED_BY_DAILY_ADJUSTMENT';
    case 'insufficient_continuous_time':
      return 'NO_CONTIGUOUS_WINDOW';
    case 'barber_unavailable':
      return 'EMPLOYEE_OFF_DAY';
    default:
      return undefined;
  }
}

/**
 * Infer a day-level deny code from day-plan flags when no slots/contexts remain.
 * Prefer specific causes over NO_EMPLOYEE_AVAILABLE.
 */
export function inferDayDenyReason(input: {
  contextsEmpty: boolean;
  specificEmp?: boolean;
  dayOff?: boolean;
  absent?: boolean;
  notWorking?: boolean;
  scheduleMissing?: boolean;
}): AvailabilityReasonCode {
  if (input.absent) return 'EMPLOYEE_ABSENT';
  if (input.dayOff) return 'EMPLOYEE_OFF_DAY';
  if (input.scheduleMissing) return 'SCHEDULE_NOT_CONFIGURED';
  if (input.notWorking) return 'EMPLOYEE_OFF_DAY';
  if (input.contextsEmpty && input.specificEmp) return 'EMPLOYEE_OFF_DAY';
  if (input.contextsEmpty) return 'NO_EMPLOYEE_AVAILABLE';
  return 'NO_CONTIGUOUS_WINDOW';
}
