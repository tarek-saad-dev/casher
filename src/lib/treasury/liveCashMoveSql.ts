/**
 * Operational income/expense/treasury reads ignore reversed originals and
 * their reversal rows. Both rows stay in TblCashMove for audit.
 * Payment-method balances that sign by inOut still include both, and the
 * reversal stores a negative amount on the same inOut so those balances net.
 *
 * Columns are added by DRVO-007 / treasury-movement-registry migration.
 * Until that schema exists, callers must use `liveCashMoveAndClause` so pages
 * like expense categories do not fail with Invalid column name.
 */
import type { ConnectionPool } from 'mssql';

let reversalColumnsCache: boolean | null = null;

export function liveCashMovePredicate(alias?: string): string {
  const prefix = alias ? `${alias}.` : '';
  return `ISNULL(${prefix}IsReversed, 0) = 0 AND ${prefix}ReversalOfCashMoveId IS NULL`;
}

/** Reset cache (tests only). */
export function resetCashMoveReversalColumnsCache(): void {
  reversalColumnsCache = null;
}

export async function cashMoveHasReversalColumns(pool: ConnectionPool): Promise<boolean> {
  if (reversalColumnsCache != null) return reversalColumnsCache;
  const result = await pool.request().query(`
    SELECT
      CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'ReversalOfCashMoveId') IS NULL THEN 0 ELSE 1 END AS reversalOf,
      CASE WHEN COL_LENGTH(N'dbo.TblCashMove', N'IsReversed') IS NULL THEN 0 ELSE 1 END AS isReversed;
  `);
  const row = result.recordset[0] as { reversalOf?: number; isReversed?: number } | undefined;
  reversalColumnsCache =
    !!row && Number(row.reversalOf) === 1 && Number(row.isReversed) === 1;
  return reversalColumnsCache;
}

/**
 * SQL AND-fragment for live cash moves.
 * Returns empty string when reversal columns are absent (pre-migration DBs).
 * Example: `WHERE … ${await liveCashMoveAndClause(pool, 'cm')}`
 */
export async function liveCashMoveAndClause(
  pool: ConnectionPool,
  alias?: string,
): Promise<string> {
  if (!(await cashMoveHasReversalColumns(pool))) return '';
  return ` AND ${liveCashMovePredicate(alias)}`;
}
