/**
 * Pure employee-scope helpers (safe for UI + tests).
 * Server resolution lives in dailyPayrollEmployeeScope.ts (server-only).
 *
 * A scope is `all` (every viewable branch of the tenant) or one branch code of the tenant.
 */

import { normalizeHrBranchCode } from '@/lib/hr/legacyHrBranchPolicy';

export type DailyPayrollEmployeeScope = 'all' | (string & {});

const BRANCH_CODE_RE = /^[A-Z0-9_-]{1,40}$/;

export function parseDailyPayrollEmployeeScope(
  raw: string | null,
): DailyPayrollEmployeeScope | 'active' {
  if (raw == null || raw.trim() === '' || raw.trim().toLowerCase() === 'active') return 'active';
  const v = raw.trim().toUpperCase();
  if (v === 'ALL') return 'all';
  const code = normalizeHrBranchCode(v);
  return BRANCH_CODE_RE.test(code) ? code : 'active';
}
