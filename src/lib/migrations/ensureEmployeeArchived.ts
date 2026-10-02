import type { ConnectionPool } from 'mssql';

let columnReady: boolean | null = null;

async function tblEmpHasArchivedFlag(db: ConnectionPool): Promise<boolean> {
  const result = await db.request().query(`
    SELECT COUNT(*) AS cnt
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = 'dbo'
      AND TABLE_NAME = 'TblEmp'
      AND COLUMN_NAME = 'IsArchived'
  `);
  return (result.recordset[0]?.cnt ?? 0) > 0;
}

/**
 * Idempotent archive flag for employees that must remain in historical records
 * but should no longer appear in employee-management activity lists.
 */
export async function ensureTblEmpArchivedColumn(
  db: ConnectionPool,
): Promise<boolean> {
  if (columnReady === true) return true;
  if (columnReady === false) return false;

  try {
    await db.request().query(`
      IF COL_LENGTH(N'dbo.TblEmp', N'IsArchived') IS NULL
      BEGIN
        ALTER TABLE dbo.TblEmp
        ADD IsArchived BIT NOT NULL
          CONSTRAINT DF_TblEmp_IsArchived DEFAULT (0);
      END;
    `);
  } catch (err) {
    console.warn('[ensureTblEmpArchivedColumn] ALTER TABLE failed:', err);
  }

  try {
    columnReady = await tblEmpHasArchivedFlag(db);
    if (!columnReady) {
      console.warn('[ensureTblEmpArchivedColumn] IsArchived still missing after migration attempt');
    }
    return columnReady;
  } catch (err) {
    console.warn('[ensureTblEmpArchivedColumn] column check failed:', err);
    columnReady = false;
    return false;
  }
}
