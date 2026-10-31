export const LATE_DEDUCTION_REF_TYPE = 'LateDeductionAttendance';
export const LATE_DEDUCTION_ENTRY_REASON = 'deduction' as const;

export const LATE_DEDUCTION_CONFIG_KEY_ENABLED = 'late_deduction_enabled';
export const LATE_DEDUCTION_CONFIG_KEY_ACTIVATED_ON = 'late_deduction_activated_on';

export type LateDeductionCaseStatus =
  | 'alerting'
  | 'applied'
  | 'pending_manager'
  | 'manager_applied'
  | 'exempt'
  | 'skipped'
  | 'cancelled';

export const LATE_DEDUCTION_CASE_STATUSES: readonly LateDeductionCaseStatus[] = [
  'alerting',
  'applied',
  'pending_manager',
  'manager_applied',
  'exempt',
  'skipped',
  'cancelled',
] as const;
