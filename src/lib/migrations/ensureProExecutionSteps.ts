import type { ConnectionPool } from 'mssql';

let tableReady: boolean | null = null;

async function executionStepsTableExists(db: ConnectionPool): Promise<boolean> {
  const result = await db.request().query(`
    SELECT
      CASE WHEN OBJECT_ID(N'dbo.TblProExecutionStep', N'U') IS NOT NULL THEN 1 ELSE 0 END AS hasTable
  `);
  return Number(result.recordset[0]?.hasTable) === 1;
}

/** Idempotent — creates TblProExecutionStep if missing. Returns whether it is usable. */
export async function ensureProExecutionStepsTable(db: ConnectionPool): Promise<boolean> {
  if (tableReady === true) return true;
  if (tableReady === false) return false;

  try {
    await db.request().query(`
      IF OBJECT_ID(N'dbo.TblProExecutionStep', N'U') IS NULL
      BEGIN
        CREATE TABLE dbo.TblProExecutionStep (
          StepID             INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
          ProID              INT NOT NULL,
          SortOrder          INT NOT NULL CONSTRAINT DF_TblProExecutionStep_SortOrder DEFAULT (0),
          TitleAr            NVARCHAR(200) NULL,
          TitleEn            NVARCHAR(200) NULL,
          DetailAr           NVARCHAR(1000) NULL,
          DetailEn           NVARCHAR(1000) NULL,
          DurationMinutes    INT NULL,
          CreatedAt          DATETIME2 NOT NULL CONSTRAINT DF_TblProExecutionStep_CreatedAt DEFAULT (SYSDATETIME()),
          UpdatedAt          DATETIME2 NULL,
          CONSTRAINT FK_TblProExecutionStep_Pro
            FOREIGN KEY (ProID) REFERENCES dbo.TblPro (ProID)
        );

        CREATE NONCLUSTERED INDEX IX_TblProExecutionStep_ProID_SortOrder
          ON dbo.TblProExecutionStep (ProID, SortOrder);
      END;
    `);
  } catch (err) {
    console.warn('[ensureProExecutionStepsTable] create failed:', err);
  }

  try {
    tableReady = await executionStepsTableExists(db);
    if (!tableReady) {
      console.warn('[ensureProExecutionStepsTable] table still missing after migration attempt');
    }
    return tableReady;
  } catch (err) {
    console.warn('[ensureProExecutionStepsTable] existence check failed:', err);
    tableReady = false;
    return false;
  }
}
