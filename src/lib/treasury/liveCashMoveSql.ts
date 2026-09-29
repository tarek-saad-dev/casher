/**
 * Operational income/expense/treasury reads ignore reversed originals and
 * their reversal rows. Both rows stay in TblCashMove for audit.
 * Payment-method balances that sign by inOut still include both, and the
 * reversal stores a negative amount on the same inOut so those balances net.
 */
export function liveCashMovePredicate(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return `ISNULL(${prefix}IsReversed, 0) = 0 AND ${prefix}ReversalOfCashMoveId IS NULL`;
}
