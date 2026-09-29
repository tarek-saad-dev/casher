/**
 * Operational income/expense/treasury reads ignore reversed originals and
 * their reversal rows. Both rows stay in TblCashMove for audit.
 * Payment-method balances that sign by inOut still include both, and the
 * reversal stores a negative amount on the same inOut so those balances net.
 *
 * Columns are added by DRVO-007 / treasury-movement-registry migration.
 * Until that schema exists, predicates must NOT reference the columns
 * (SQL Server rejects unknown names even inside OR branches).
 */
import type { ConnectionPool } from 'mssql';

let reversalColumnsCache: boolean | null = null;

/**
 * Live-cash filter fragment.
 * Safe default: `1=1` until columns are proven present (via prime / async check).
 * Sync callers stay production-safe on pre-migration databases.
 */
export function liveCashMovePredicate(alias?: string): string {
  if (reversalColumnsCache !== true) {
    return '1=1';
  }
  const prefix = alias ? `${alias}.` : '';
  return `ISNULL(${prefix}IsReversed, 0) = 0 AND ${prefix}ReversalOfCashMoveId IS NULL`;
}

/** Reset cache (tests only). */
export function resetCashMoveReversalColumnsCache(): void {
  reversalColumnsCache = null;
}

/** Test helper: force known schema state. */
export function setCashMoveReversalColumnsCacheForTests(value: boolean | null): void {
  reversalColumnsCache = value;
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

/** Prime cache from getPool() so sync predicates become accurate for the process. */
export async function primeCashMoveReversalColumnsCache(
  pool: ConnectionPool,
): Promise<boolean> {
  return cashMoveHasReversalColumns(pool);
}

/**
 * SQL AND-fragment for live cash moves.
 * Empty when columns absent; otherwise ` AND <predicate>`.
 */
export async function liveCashMoveAndClause(
  pool: ConnectionPool,
  alias?: string,
): Promise<string> {
  await cashMoveHasReversalColumns(pool);
  if (reversalColumnsCache !== true) return '';
  return ` AND ${liveCashMovePredicate(alias)}`;
}
