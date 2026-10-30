/** Repayment reduces an existing debt; it never creates a new employee credit. */
export function getMaxEmployeeAdvanceRepayment(
  branchBalance: number,
  currentMonthBranchBalance: number,
): number {
  if (!Number.isFinite(branchBalance) || !Number.isFinite(currentMonthBranchBalance)) {
    return 0;
  }
  return Math.round(
    Math.min(Math.max(0, -branchBalance), Math.max(0, -currentMonthBranchBalance)) * 100,
  ) / 100;
}
