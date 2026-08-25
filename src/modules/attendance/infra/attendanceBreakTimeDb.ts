/**
 * DB helpers for TblEmpAttendanceBreakTime (وقت البريك).
 * Same interval shape as وقت مستقطع, but NEVER deducted from worked hours.
 */

import { sql } from '@/lib/db';
import {
  type AttendanceBreakInterval,
  sumBreakMinutes,
} from '@/lib/hr/attendance-breaks';

type DbLike = { request: () => sql.Request };

function timeToDate(timeStr: string | null | undefined): Date | null {
  if (!timeStr || timeStr.trim() === '') return null;
  const parts = timeStr.split(':').map(Number);
  const h = parts[0] ?? 0;
  const m = parts[1] ?? 0;
  const s = parts[2] ?? 0;
  const d = new Date(0);
  d.setUTCHours(h, m, s, 0);
  return d;
}

export async function ensureAttendanceBreakTimeSchema(db: DbLike): Promise<void> {
  await db.request().query(`
    IF COL_LENGTH('dbo.TblEmpAttendance', 'BreakTimeMinutesTotal') IS NULL
    BEGIN
      ALTER TABLE dbo.TblEmpAttendance
        ADD BreakTimeMinutesTotal INT NOT NULL
          CONSTRAINT DF_TblEmpAttendance_BreakTimeMinutesTotal DEFAULT 0;
    END

    IF NOT EXISTS (
      SELECT 1 FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'TblEmpAttendanceBreakTime'
    )
    BEGIN
      CREATE TABLE dbo.TblEmpAttendanceBreakTime (
        ID INT IDENTITY(1,1) PRIMARY KEY,
        AttendanceID INT NOT NULL,
        LeaveAt TIME NOT NULL,
        ReturnAt TIME NOT NULL,
        Minutes INT NOT NULL DEFAULT 0,
        Notes NVARCHAR(200) NULL,
        CreatedAt DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedAt DATETIME NULL,
        CONSTRAINT FK_TblEmpAttendanceBreakTime_Attendance
          FOREIGN KEY (AttendanceID) REFERENCES dbo.TblEmpAttendance(ID) ON DELETE CASCADE
      );
      CREATE INDEX IX_TblEmpAttendanceBreakTime_AttendanceID
        ON dbo.TblEmpAttendanceBreakTime (AttendanceID);
    END
  `);
}

export async function replaceAttendanceBreakTimes(
  db: DbLike,
  attendanceId: number,
  breaks: AttendanceBreakInterval[],
): Promise<number> {
  const total = sumBreakMinutes(breaks);

  await db
    .request()
    .input('attendanceId', sql.Int, attendanceId)
    .query(`DELETE FROM dbo.TblEmpAttendanceBreakTime WHERE AttendanceID = @attendanceId`);

  for (const b of breaks) {
    await db
      .request()
      .input('attendanceId', sql.Int, attendanceId)
      .input('leaveAt', sql.Time, timeToDate(b.LeaveAt))
      .input('returnAt', sql.Time, timeToDate(b.ReturnAt))
      .input('minutes', sql.Int, b.Minutes ?? 0)
      .input('notes', sql.NVarChar(200), b.Notes ?? null)
      .query(`
        INSERT INTO dbo.TblEmpAttendanceBreakTime
          (AttendanceID, LeaveAt, ReturnAt, Minutes, Notes, CreatedAt)
        VALUES
          (@attendanceId, @leaveAt, @returnAt, @minutes, @notes, GETDATE())
      `);
  }

  await db
    .request()
    .input('attendanceId', sql.Int, attendanceId)
    .input('breakTimeMinutes', sql.Int, total)
    .query(`
      UPDATE dbo.TblEmpAttendance
      SET BreakTimeMinutesTotal = @breakTimeMinutes, UpdatedAt = GETDATE()
      WHERE ID = @attendanceId
    `);

  return total;
}

export async function loadBreakTimesByAttendanceIds(
  db: DbLike,
  attendanceIds: number[],
): Promise<Map<number, AttendanceBreakInterval[]>> {
  const map = new Map<number, AttendanceBreakInterval[]>();
  if (attendanceIds.length === 0) return map;

  const idList = attendanceIds.map((id) => Number(id)).filter((id) => id > 0);
  if (idList.length === 0) return map;

  const result = await db.request().query(`
    SELECT
      b.ID,
      b.AttendanceID,
      CONVERT(VARCHAR(5), b.LeaveAt, 108) AS LeaveAt,
      CONVERT(VARCHAR(5), b.ReturnAt, 108) AS ReturnAt,
      b.Minutes,
      b.Notes
    FROM dbo.TblEmpAttendanceBreakTime b
    WHERE b.AttendanceID IN (${idList.join(',')})
    ORDER BY b.LeaveAt, b.ID
  `);

  for (const row of result.recordset as Array<{
    ID: number;
    AttendanceID: number;
    LeaveAt: string;
    ReturnAt: string;
    Minutes: number;
    Notes: string | null;
  }>) {
    const list = map.get(row.AttendanceID) ?? [];
    list.push({
      ID: row.ID,
      LeaveAt: row.LeaveAt,
      ReturnAt: row.ReturnAt,
      Minutes: row.Minutes,
      Notes: row.Notes,
    });
    map.set(row.AttendanceID, list);
  }

  return map;
}
