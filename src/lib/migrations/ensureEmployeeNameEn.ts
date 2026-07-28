import type { ConnectionPool } from 'mssql';

let columnReady: boolean | null = null;

async function tblEmpHasNameEn(db: ConnectionPool): Promise<boolean> {
  const result = await db.request().query(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'TblEmp'
      AND COLUMN_NAME = 'EmpNameEn'
  `);
  return (result.recordset[0]?.cnt ?? 0) > 0;
}

/** Idempotent — adds TblEmp.EmpNameEn if missing. */
export async function ensureTblEmpNameEnColumn(db: ConnectionPool): Promise<boolean> {
  if (columnReady === true) return true;
  if (columnReady === false) return false;

  try {
    await db.request().query(`
      IF COL_LENGTH(N'dbo.TblEmp', N'EmpNameEn') IS NULL
      BEGIN
        ALTER TABLE dbo.TblEmp
        ADD EmpNameEn NVARCHAR(200) NULL;
      END;
    `);
  } catch (err) {
    console.warn('[ensureTblEmpNameEnColumn] ALTER TABLE failed:', err);
  }

  try {
    columnReady = await tblEmpHasNameEn(db);
    if (!columnReady) {
      console.warn('[ensureTblEmpNameEnColumn] EmpNameEn column still missing after migration attempt');
    }
    return columnReady;
  } catch (err) {
    console.warn('[ensureTblEmpNameEnColumn] column check failed:', err);
    columnReady = false;
    return false;
  }
}

export function tblEmpNameEnSelect(hasColumn: boolean, alias = 'e'): string {
  return hasColumn
    ? `${alias}.EmpNameEn`
    : 'CAST(NULL AS NVARCHAR(200)) AS EmpNameEn';
}

export function normalizeEmpNameEn(raw: string | null | undefined): string | null {
  const t = String(raw ?? '').trim();
  return t || null;
}
