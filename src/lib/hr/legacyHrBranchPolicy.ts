/**
 * DRVO-016 — the single home of CUT (CASHER_BOOT) branch-code assumptions in HR / payroll.
 *
 * - Legacy `TblEmpWorkSchedule` rows predate per-branch schedules and belong to CUT's primary
 *   branch only; they are a read-only fallback for that branch and never for any other tenant.
 * - CUT's established Arabic tab labels are kept; every other branch is labelled by its name.
 *
 * Branch codes are globally unique in TblBranch, so matching a code here can never apply CUT
 * behaviour to another tenant's branch.
 */

export const LEGACY_HR_PRIMARY_BRANCH_CODE = 'GLEEM';

const LEGACY_HR_BRANCH_LABELS: Readonly<Record<string, string>> = {
  GLEEM: 'جليم',
  CAMP_CAESAR: 'كامب شيزار',
};

/** Branch whose employees may fall back to legacy `TblEmpWorkSchedule` rows. */
export function isLegacyHrPrimaryBranch(branchCode: string | null | undefined): boolean {
  return String(branchCode ?? '').trim().toUpperCase() === LEGACY_HR_PRIMARY_BRANCH_CODE;
}

/** Display label for an HR branch tab: CUT's legacy Arabic label, else the branch name, else the code. */
export function hrBranchLabel(branch: { branchCode: string; branchName?: string | null }): string {
  const code = String(branch.branchCode ?? '').trim().toUpperCase();
  return LEGACY_HR_BRANCH_LABELS[code] ?? (branch.branchName?.trim() || branch.branchCode);
}

/**
 * CUT's "all employees" HR view historically meant its two salons only. When a tenant has any of
 * these branches the view keeps that set; every other tenant sees all of its viewable branches.
 */
const LEGACY_HR_ALL_SCOPE_BRANCH_CODES: ReadonlySet<string> = new Set(['GLEEM', 'CAMP_CAESAR']);

export function isLegacyHrAllScopeBranch(branchCode: string | null | undefined): boolean {
  return LEGACY_HR_ALL_SCOPE_BRANCH_CODES.has(String(branchCode ?? '').trim().toUpperCase());
}

export function legacyHrAllScopeBranches<T extends { branchCode: string }>(branches: T[]): T[] {
  const preferred = branches.filter((b) => isLegacyHrAllScopeBranch(b.branchCode));
  return preferred.length > 0 ? preferred : branches;
}

/** Short aliases CUT bookmarks still send as `employeeScope`. */
const LEGACY_HR_BRANCH_CODE_ALIASES: Readonly<Record<string, string>> = {
  CAMP: 'CAMP_CAESAR',
};

export function normalizeHrBranchCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  return LEGACY_HR_BRANCH_CODE_ALIASES[code] ?? code;
}
