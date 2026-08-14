/**
 * Pure employee-scope helpers (safe for UI + tests).
 * Server resolution lives in dailyPayrollEmployeeScope.ts (server-only).
 */

export const DAILY_PAYROLL_EMPLOYEE_SCOPES = ['all', 'GLEEM', 'CAMP_CAESAR'] as const;
export type DailyPayrollEmployeeScope = (typeof DAILY_PAYROLL_EMPLOYEE_SCOPES)[number];

export function parseDailyPayrollEmployeeScope(
  raw: string | null,
): DailyPayrollEmployeeScope | 'active' {
  if (raw == null || raw === '' || raw === 'active') return 'active';
  const v = raw.trim().toUpperCase();
  if (v === 'ALL') return 'all';
  if (v === 'GLEEM') return 'GLEEM';
  if (v === 'CAMP_CAESAR' || v === 'CAMP') return 'CAMP_CAESAR';
  return 'active';
}
