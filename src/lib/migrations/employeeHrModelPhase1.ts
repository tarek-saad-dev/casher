/**
 * Phase 1 HR model — pure backfill mapping rules (mirrors SQL migration).
 * Used by unit tests; runtime behavior unchanged until later phases.
 */

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'freelance'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const PAYROLL_METHODS = ['hourly', 'daily', 'monthly'] as const;
export type PayrollMethod = (typeof PAYROLL_METHODS)[number];

export interface EmploymentTypeBackfillInput {
  isAttendanceExempt: boolean;
  workingDayCount: number | null;
}

/**
 * Maps legacy schedule / exempt flag → EmploymentType for backfill.
 * Priority: IsAttendanceExempt → 6 days → 1–5 days → default full_time.
 */
export function mapEmploymentTypeForBackfill(
  input: EmploymentTypeBackfillInput,
): EmploymentType {
  if (input.isAttendanceExempt) {
    return 'freelance';
  }
  if (input.workingDayCount === 6) {
    return 'full_time';
  }
  if (
    input.workingDayCount != null &&
    input.workingDayCount >= 1 &&
    input.workingDayCount <= 5
  ) {
    return 'part_time';
  }
  return 'full_time';
}

/**
 * Maps legacy SalaryType → PayrollMethod for backfill.
 * Daily (legacy daily payroll) → hourly because current generate uses HourlyRate × hours.
 */
export function mapPayrollMethodForBackfill(
  salaryType: string | null | undefined,
): PayrollMethod {
  const normalized = String(salaryType ?? '').trim().toLowerCase();
  if (normalized === 'monthly') return 'monthly';
  if (normalized === 'daily') return 'hourly';
  if (normalized === 'hourly') return 'hourly';
  return 'hourly';
}

/** True when freelance + monthly combination is blocked by CK_TblEmp_Freelance_NoMonthly. */
export function isFreelanceMonthlyBlocked(
  employmentType: EmploymentType | null | undefined,
  payrollMethod: PayrollMethod | null | undefined,
): boolean {
  return employmentType === 'freelance' && payrollMethod === 'monthly';
}

export function isValidEmploymentType(value: string | null | undefined): value is EmploymentType {
  return EMPLOYMENT_TYPES.includes(value as EmploymentType);
}

export function isValidPayrollMethod(value: string | null | undefined): value is PayrollMethod {
  return PAYROLL_METHODS.includes(value as PayrollMethod);
}

/** Phase 1 column names added to TblEmp (for audit scripts). */
export const PHASE1_TBL_EMP_COLUMNS = [
  'EmploymentType',
  'PayrollMethod',
  'DailyRate',
  'ManualHourlyRate',
] as const;

/** Legacy columns intentionally preserved in Phase 1. */
export const PHASE1_PRESERVED_TBL_EMP_COLUMNS = [
  'SalaryType',
  'Salary',
  'BaseSalary',
  'HourlyRate',
  'IsPayrollEnabled',
  'IsAttendanceExempt',
] as const;
