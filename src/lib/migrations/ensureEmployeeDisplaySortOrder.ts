import type { ConnectionPool } from 'mssql';

let columnReady: boolean | null = null;

/** Default when unset — appears after explicitly ordered barbers; ties break by name. */
export const DEFAULT_EMP_DISPLAY_SORT_ORDER = 999;

async function tblEmpHasDisplaySortOrder(db: ConnectionPool): Promise<boolean> {
  const result = await db.request().query(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'TblEmp'
      AND COLUMN_NAME = 'DisplaySortOrder'
  `);
  return (result.recordset[0]?.cnt ?? 0) > 0;
}

/**
 * Idempotent — adds TblEmp.DisplaySortOrder (lower = shown first on public booking).
 */
export async function ensureTblEmpDisplaySortOrderColumn(
  db: ConnectionPool,
): Promise<boolean> {
  if (columnReady === true) return true;
  if (columnReady === false) return false;

  try {
    await db.request().query(`
      IF COL_LENGTH(N'dbo.TblEmp', N'DisplaySortOrder') IS NULL
      BEGIN
        ALTER TABLE dbo.TblEmp
        ADD DisplaySortOrder INT NOT NULL
          CONSTRAINT DF_TblEmp_DisplaySortOrder DEFAULT (999);
      END;
    `);
  } catch (err) {
    console.warn('[ensureTblEmpDisplaySortOrderColumn] ALTER TABLE failed:', err);
  }

  try {
    columnReady = await tblEmpHasDisplaySortOrder(db);
    if (!columnReady) {
      console.warn(
        '[ensureTblEmpDisplaySortOrderColumn] DisplaySortOrder still missing after migration attempt',
      );
    }
    return columnReady;
  } catch (err) {
    console.warn('[ensureTblEmpDisplaySortOrderColumn] column check failed:', err);
    columnReady = false;
    return false;
  }
}

export function tblEmpDisplaySortOrderSelect(
  hasColumn: boolean,
  alias = 'e',
): string {
  return hasColumn
    ? `${alias}.DisplaySortOrder`
    : `CAST(${DEFAULT_EMP_DISPLAY_SORT_ORDER} AS INT) AS DisplaySortOrder`;
}

/** Normalize admin input → non-negative int (default 999). */
export function normalizeDisplaySortOrder(
  raw: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: DEFAULT_EMP_DISPLAY_SORT_ORDER };
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: 'ترتيب العرض يجب أن يكون رقم صحيح' };
  }
  if (n < 0 || n > 999999) {
    return { ok: false, error: 'ترتيب العرض يجب أن يكون بين 0 و 999999' };
  }
  return { ok: true, value: n };
}

export function coerceDisplaySortOrder(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return DEFAULT_EMP_DISPLAY_SORT_ORDER;
  }
  return n;
}
