import type { ConnectionPool } from 'mssql';

let columnReady: boolean | null = null;

async function tblEmpHasImageUrl(db: ConnectionPool): Promise<boolean> {
  const result = await db.request().query(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'TblEmp'
      AND COLUMN_NAME = 'ImageUrl'
  `);
  return (result.recordset[0]?.cnt ?? 0) > 0;
}

/** Idempotent — adds TblEmp.ImageUrl if missing. Returns whether the column is usable. */
export async function ensureTblEmpImageUrlColumn(db: ConnectionPool): Promise<boolean> {
  if (columnReady === true) return true;
  if (columnReady === false) return false;

  try {
    await db.request().query(`
      IF COL_LENGTH(N'dbo.TblEmp', N'ImageUrl') IS NULL
      BEGIN
        ALTER TABLE dbo.TblEmp
        ADD ImageUrl NVARCHAR(1000) NULL;
      END;
    `);
  } catch (err) {
    console.warn('[ensureTblEmpImageUrlColumn] ALTER TABLE failed:', err);
  }

  try {
    columnReady = await tblEmpHasImageUrl(db);
    if (!columnReady) {
      console.warn('[ensureTblEmpImageUrlColumn] ImageUrl column still missing after migration attempt');
    }
    return columnReady;
  } catch (err) {
    console.warn('[ensureTblEmpImageUrlColumn] column check failed:', err);
    columnReady = false;
    return false;
  }
}

/** SELECT expression for ImageUrl — safe when column may not exist yet. */
export function tblEmpImageUrlSelect(hasColumn: boolean, alias = 'e'): string {
  return hasColumn
    ? `${alias}.ImageUrl`
    : 'CAST(NULL AS NVARCHAR(1000)) AS ImageUrl';
}
