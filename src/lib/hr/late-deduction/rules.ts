/**
 * Pure late-deduction boundary + amount rules.
 * Spec: 1–60 → 25%, 61–120 → 50%, 121+ → manager review (no auto amount).
 */

import { roundMoney } from '@/lib/reportMonthUtils';
import { scheduledHoursFromTimes } from '@/lib/payroll/dailyPayrollHrRules';

export const LATE_DEDUCTION_MONTHLY_DIVISOR = 26;

export type LateDeductionBracket =
  | 'none'
  | 'quarter'
  | 'half'
  | 'manager_review';

export type LateDeductionKind = LateDeductionBracket | 'exempt' | 'missing_pay_data';

export function resolveLateDeductionBracket(lateMinutes: number): LateDeductionBracket {
  const mins = Math.max(0, Math.floor(Number(lateMinutes) || 0));
  if (mins <= 0) return 'none';
  if (mins <= 60) return 'quarter';
  if (mins <= 120) return 'half';
  return 'manager_review';
}

export function fractionForBracket(bracket: LateDeductionBracket): number | null {
  if (bracket === 'quarter') return 0.25;
  if (bracket === 'half') return 0.5;
  return null;
}

export function labelForBracket(bracket: LateDeductionBracket): string {
  switch (bracket) {
    case 'quarter':
      return 'Quarter-day';
    case 'half':
      return 'Half-day';
    case 'manager_review':
      return 'Manager review';
    default:
      return 'None';
  }
}

export function dailyBasePayFromMonthlySalary(monthlySalary: number): number {
  return roundMoney(Number(monthlySalary) / LATE_DEDUCTION_MONTHLY_DIVISOR);
}

export function dailyBasePayFromHourly(params: {
  hourlyRate: number;
  scheduledStart: string | null | undefined;
  scheduledEnd: string | null | undefined;
}): number | null {
  const hours = scheduledHoursFromTimes(params.scheduledStart, params.scheduledEnd);
  if (hours == null || hours <= 0) return null;
  if (!(Number(params.hourlyRate) > 0)) return null;
  return roundMoney(Number(params.hourlyRate) * hours);
}

export function calculateLateDeductionAmount(params: {
  lateMinutes: number;
  dailyBasePay: number;
}): { bracket: LateDeductionBracket; amount: number | null; fraction: number | null } {
  const bracket = resolveLateDeductionBracket(params.lateMinutes);
  const fraction = fractionForBracket(bracket);
  if (fraction == null) {
    return { bracket, amount: null, fraction: null };
  }
  if (!(Number(params.dailyBasePay) > 0)) {
    return { bracket, amount: null, fraction };
  }
  return {
    bracket,
    amount: roundMoney(Number(params.dailyBasePay) * fraction),
    fraction,
  };
}

/** Threshold minutes that trigger progressive pre-check-in alerts. */
export const LATE_ALERT_THRESHOLDS = [1, 61, 121] as const;
export type LateAlertThreshold = (typeof LATE_ALERT_THRESHOLDS)[number];

export function alertThresholdReached(lateMinutes: number): LateAlertThreshold | null {
  const mins = Math.max(0, Math.floor(Number(lateMinutes) || 0));
  if (mins >= 121) return 121;
  if (mins >= 61) return 61;
  if (mins >= 1) return 1;
  return null;
}

export function thresholdsDueForLateMinutes(lateMinutes: number): LateAlertThreshold[] {
  const mins = Math.max(0, Math.floor(Number(lateMinutes) || 0));
  return LATE_ALERT_THRESHOLDS.filter((t) => mins >= t);
}

export interface LateDeductionConfigLike {
  enabled: boolean;
  activatedOn: string | null;
}

/** Pure gate: feature on + work date on/after activation (no retroactive charges). */
export function isWorkDateEligibleForLateDeduction(
  workDate: string,
  config: LateDeductionConfigLike,
): boolean {
  if (!config.enabled) return false;
  if (!config.activatedOn) return false;
  return workDate >= config.activatedOn;
}
