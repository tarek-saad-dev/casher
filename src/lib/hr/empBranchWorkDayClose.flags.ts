/**
 * Soft switch for BranchID+WorkDate payroll day close lock.
 *
 * When false (default for now): days stay editable — assertEmpBranchWorkDayMutable
 * does not block, and new close attempts are rejected.
 * Set EMP_BRANCH_WORK_DAY_CLOSE_ENFORCED=true to re-enable locking.
 */
export function isEmpBranchWorkDayCloseEnforced(): boolean {
  const raw = String(process.env.EMP_BRANCH_WORK_DAY_CLOSE_ENFORCED ?? '')
    .trim()
    .toLowerCase();
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  // Default: lock disabled so all days remain mutable until explicitly re-enabled.
  return false;
}
