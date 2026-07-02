import type { ConnectionPool } from 'mssql';

let columnReady: boolean | null = null;

async function tblProHasImageUrl(db: ConnectionPool): Promise<boolean> {
  const result = await db.request().query(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'TblPro'
      AND COLUMN_NAME = 'ImageUrl'
  `);
  return (result.recordset[0]?.cnt ?? 0) > 0;
}

/** Idempotent — adds TblPro.ImageUrl if missing. Returns whether the column is usable. */
export async function ensureTblProImageUrlColumn(db: ConnectionPool): Promise<boolean> {
  if (columnReady === true) return true;
  if (columnReady === false) return false;

  try {
    await db.request().query(`
      IF COL_LENGTH(N'dbo.TblPro', N'ImageUrl') IS NULL
      BEGIN
        ALTER TABLE dbo.TblPro
        ADD ImageUrl NVARCHAR(1000) NULL;
      END;
    `);
  } catch (err) {
    console.warn('[ensureTblProImageUrlColumn] ALTER TABLE failed:', err);
  }

  try {
    columnReady = await tblProHasImageUrl(db);
    if (!columnReady) {
      console.warn('[ensureTblProImageUrlColumn] ImageUrl column still missing after migration attempt');
    }
    return columnReady;
  } catch (err) {
    console.warn('[ensureTblProImageUrlColumn] column check failed:', err);
    columnReady = false;
    return false;
  }
}

/** SELECT expression for ImageUrl — safe when column may not exist yet. */
export function tblProImageUrlSelect(hasColumn: boolean): string {
  return hasColumn
    ? 'p.ImageUrl'
    : 'CAST(NULL AS NVARCHAR(1000)) AS ImageUrl';
}
