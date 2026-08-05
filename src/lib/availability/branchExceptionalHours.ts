import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  windowWithinBranchHours,
  type BranchExceptionalHoursLike,
} from '@/lib/availability/branchExceptionalHoursPure';

export type BranchExceptionalHours = BranchExceptionalHoursLike & {
  exceptionId: number;
  branchId: number;
  businessDate: string;
  reasonText: string | null;
};

export { windowWithinBranchHours };

let ensured = false;

export async function ensureBranchExceptionalHoursTable(): Promise<void> {
  if (ensured) return;
  const db = await getPool();
  await db.request().query(`
    IF OBJECT_ID(N'dbo.TblBranchExceptionalHours', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.TblBranchExceptionalHours (
        ExceptionID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        BranchID INT NOT NULL,
        BusinessDate DATE NOT NULL,
        IsClosed BIT NOT NULL CONSTRAINT DF_TblBranchExHours_Closed DEFAULT (0),
        OpenTime TIME NULL,
        CloseTime TIME NULL,
        EndDayOffset TINYINT NOT NULL CONSTRAINT DF_TblBranchExHours_Offset DEFAULT (0),
        ReasonText NVARCHAR(300) NULL,
        IsActive BIT NOT NULL CONSTRAINT DF_TblBranchExHours_Active DEFAULT (1),
        CreatedByUserID INT NULL,
        CreatedAt DATETIME2 NOT NULL CONSTRAINT DF_TblBranchExHours_Created DEFAULT (SYSUTCDATETIME()),
        CancelledAt DATETIME2 NULL,
        CancelledByUserID INT NULL,
        CONSTRAINT UQ_TblBranchExHours UNIQUE (BranchID, BusinessDate, IsActive)
      );
      CREATE INDEX IX_TblBranchExHours_BranchDate
        ON dbo.TblBranchExceptionalHours (BranchID, BusinessDate)
        WHERE IsActive = 1;
    END
  `);
  ensured = true;
}

function hhmmFromSqlTime(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  const s = String(v);
  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}`;
}

export async function getBranchExceptionalHours(
  branchId: number,
  businessDate: string,
): Promise<BranchExceptionalHours | null> {
  await ensureBranchExceptionalHoursTable();
  const db = await getPool();
  const r = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('date', sql.Date, businessDate)
    .query(`
      SELECT TOP 1 ExceptionID, BranchID, BusinessDate, IsClosed,
        OpenTime, CloseTime, EndDayOffset, ReasonText
      FROM dbo.TblBranchExceptionalHours
      WHERE BranchID = @branchId AND BusinessDate = @date
        AND IsActive = 1 AND CancelledAt IS NULL
      ORDER BY ExceptionID DESC
    `);
  const row = r.recordset[0];
  if (!row) return null;
  return {
    exceptionId: Number(row.ExceptionID),
    branchId: Number(row.BranchID),
    businessDate: String(row.BusinessDate).slice(0, 10),
    isClosed: Boolean(row.IsClosed),
    openTime: hhmmFromSqlTime(row.OpenTime),
    endTime: hhmmFromSqlTime(row.CloseTime),
    endDayOffset: Number(row.EndDayOffset) === 1 ? 1 : 0,
    reasonText: row.ReasonText != null ? String(row.ReasonText) : null,
  };
}

export async function upsertBranchExceptionalHours(input: {
  branchId: number;
  businessDate: string;
  isClosed: boolean;
  openTime?: string | null;
  closeTime?: string | null;
  endDayOffset?: 0 | 1;
  reasonText?: string | null;
  actorUserId: number;
}): Promise<BranchExceptionalHours> {
  await ensureBranchExceptionalHoursTable();
  const db = await getPool();
  await db
    .request()
    .input('branchId', sql.Int, input.branchId)
    .input('date', sql.Date, input.businessDate)
    .input('actor', sql.Int, input.actorUserId)
    .query(`
      UPDATE dbo.TblBranchExceptionalHours
      SET IsActive = 0, CancelledAt = SYSUTCDATETIME(), CancelledByUserID = @actor
      WHERE BranchID = @branchId AND BusinessDate = @date AND IsActive = 1
    `);

  const ins = await db
    .request()
    .input('branchId', sql.Int, input.branchId)
    .input('date', sql.Date, input.businessDate)
    .input('closed', sql.Bit, input.isClosed ? 1 : 0)
    .input('open', sql.NVarChar(8), input.openTime ?? null)
    .input('close', sql.NVarChar(8), input.closeTime ?? null)
    .input('offset', sql.TinyInt, input.endDayOffset ?? 0)
    .input('reason', sql.NVarChar(300), input.reasonText ?? null)
    .input('actor', sql.Int, input.actorUserId)
    .query(`
      INSERT INTO dbo.TblBranchExceptionalHours (
        BranchID, BusinessDate, IsClosed, OpenTime, CloseTime, EndDayOffset,
        ReasonText, IsActive, CreatedByUserID
      )
      OUTPUT INSERTED.ExceptionID
      VALUES (
        @branchId, @date, @closed,
        CASE WHEN @open IS NULL THEN NULL ELSE CAST(@open AS time) END,
        CASE WHEN @close IS NULL THEN NULL ELSE CAST(@close AS time) END,
        @offset, @reason, 1, @actor
      )
    `);

  return {
    exceptionId: Number(ins.recordset[0].ExceptionID),
    branchId: input.branchId,
    businessDate: input.businessDate,
    isClosed: input.isClosed,
    openTime: input.openTime ?? null,
    endTime: input.closeTime ?? null,
    endDayOffset: input.endDayOffset ?? 0,
    reasonText: input.reasonText ?? null,
  };
}
