/**
 * Booking V2 B3 — optional DB projection table (not a new Source of Truth).
 * Idempotent ensure. Do not call from SERIALIZABLE booking transactions.
 */

import 'server-only';
import type { ConnectionPool } from 'mssql';
import { getPool } from '@/lib/db';

let tablesReady: boolean | null = null;

export async function ensureWeeklyBaselineProjectionTables(
  db?: ConnectionPool,
): Promise<boolean> {
  if (tablesReady === true) return true;
  const pool = db ?? (await getPool());
  try {
    await pool.request().query(`
      IF OBJECT_ID(N'dbo.TblBookingWeeklyBaselineProjection', N'U') IS NULL
      BEGIN
        CREATE TABLE dbo.TblBookingWeeklyBaselineProjection (
          EmpID              INT NOT NULL,
          BranchID           INT NOT NULL,
          DayOfWeek          TINYINT NOT NULL
            CONSTRAINT CK_WBBaseline_DayOfWeek CHECK (DayOfWeek BETWEEN 0 AND 6),
          Revision           BIGINT NOT NULL,
          SourceFingerprint  VARCHAR(64) NOT NULL,
          BitmapBase64       VARCHAR(256) NOT NULL,
          FreeRangesJson     NVARCHAR(MAX) NOT NULL,
          PlanJson           NVARCHAR(MAX) NOT NULL,
          BuiltAtUtc         DATETIME2 NOT NULL
            CONSTRAINT DF_WBBaseline_BuiltAt DEFAULT (SYSUTCDATETIME()),
          CONSTRAINT PK_TblBookingWeeklyBaselineProjection
            PRIMARY KEY (EmpID, BranchID, DayOfWeek)
        );

        CREATE NONCLUSTERED INDEX IX_WBBaseline_Branch_Dow
          ON dbo.TblBookingWeeklyBaselineProjection (BranchID, DayOfWeek)
          INCLUDE (EmpID, Revision, SourceFingerprint);

        CREATE NONCLUSTERED INDEX IX_WBBaseline_Emp_Branch
          ON dbo.TblBookingWeeklyBaselineProjection (EmpID, BranchID)
          INCLUDE (DayOfWeek, Revision);
      END
    `);
    tablesReady = true;
    return true;
  } catch {
    tablesReady = null;
    return false;
  }
}

/** Test helper — reset ensure cache. */
export function __resetWeeklyBaselineTablesReadyForTests(): void {
  tablesReady = null;
}
