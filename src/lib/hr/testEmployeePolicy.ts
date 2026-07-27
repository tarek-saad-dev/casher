import { getSmokeExecutionContext } from '@/lib/branch/smokeExecutionContext';

/**
 * Phase 1U — identify disposable smoke/test employees.
 * Schema has no IsTestEmployee column; name prefix is the contract.
 */
export function isTestOrSmokeEmployeeName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = String(name);
  return (
    n.includes('[TEST]') ||
    n.includes('[SMOKE') ||
    n.includes('[TEST ') ||
    /^\s*\[TEST\]/i.test(n) ||
    /^\s*\[SMOKE/i.test(n)
  );
}

/**
 * Smoke execution context may intentionally use disposable employees for a live proof.
 * In that controlled context the public booking engine should see them as eligible.
 */
export function isEmployeeHiddenFromPublicBooking(name: string | null | undefined): boolean {
  if (getSmokeExecutionContext()) return false;
  return isTestOrSmokeEmployeeName(name);
}

/** SQL predicate: employee name is not a disposable test/smoke identity. */
export const SQL_EXCLUDE_TEST_SMOKE_EMP_NAME = `
  AND (e.EmpName IS NULL OR (
    e.EmpName NOT LIKE N'%[[]TEST]%'
    AND e.EmpName NOT LIKE N'%[[]SMOKE%'
  ))
`.trim();

/** Returns the exclusion predicate unless a controlled smoke context is active. */
export function excludeTestSmokeSqlPredicate(): string {
  if (getSmokeExecutionContext()) return '';
  return SQL_EXCLUDE_TEST_SMOKE_EMP_NAME;
}
