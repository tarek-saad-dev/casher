/**
 * DayOffPolicy backfill mapping (mirrors SQL migration).
 */

import type { EmploymentType } from '@/lib/hr/employee-hr-model';
import type { DayOffPolicy } from '@/lib/hr/employee-hr-model';

export interface DayOffPolicyBackfillInput {
  employmentType: EmploymentType;
  workingDayCount: number | null;
}

/**
 * Maps EmploymentType + schedule working-day count → DayOffPolicy.
 *
 * full_time + 6 working days => fixed_weekly
 * full_time + 7 working days => flexible_weekly (e.g. محمد)
 * freelance / part_time => none
 */
export function mapDayOffPolicyForBackfill(
  input: DayOffPolicyBackfillInput,
): DayOffPolicy {
  if (input.employmentType === 'freelance' || input.employmentType === 'part_time') {
    return 'none';
  }
  if (input.employmentType === 'full_time') {
    if (input.workingDayCount === 7) return 'flexible_weekly';
    if (input.workingDayCount === 6) return 'fixed_weekly';
    return 'fixed_weekly';
  }
  return 'none';
}

export const DAY_OFF_POLICY_TBL_EMP_COLUMN = 'DayOffPolicy' as const;
