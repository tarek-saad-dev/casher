/**
 * Bidirectional sync: وقت مستقطع (TblEmpAttendanceBreak)
 * ↔ غير متاح لفترة / block_range (TblEmpScheduleOverrides)
 *
 * Also: وقت البريك (TblEmpAttendanceBreakTime) → block_range
 * (HR → Ops for بريك; ops-authored block_range still mirrors to مستقطع)
 *
 * Tags:
 * - Overrides CreatedBy: "attendance-break" | "attendance-break-time" | "schedule-control block_range"
 * - Break Notes: "schedule-control block_range" when authored from ops
 */

import { sql } from '@/lib/db';
import {
  type AttendanceBreakInterval,
  breakIntervalMinutes,
  normalizeTimeHHmm,
  timeToMinutes,
} from '@/lib/hr/attendance-breaks';
import {
  ensureAttendanceBreakSchema,
  loadBreaksByAttendanceIds,
  replaceAttendanceBreaks,
} from '@/lib/hr/attendance-breaks-db';
import {
  ensureAttendanceBreakTimeSchema,
  loadBreakTimesByAttendanceIds,
  replaceAttendanceBreakTimes,
} from '@/lib/hr/attendance-break-time-db';
import { ensureOverridesTable } from '@/lib/scheduleOverrides';

type DbLike = { request: () => sql.Request };

async function resolveGleemBranchId(db: DbLike): Promise<number> {
  const result = await db.request().query(`
    SELECT TOP 1 BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
  `);
  const id = Number(result.recordset[0]?.BranchID);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('GLEEM branch required for attendance row create');
  }
  return id;
}

/** Prefer explicit branch, else existing emp/date row, else home assignment, else GLEEM. */
async function resolveAttendanceBranchId(
  db: DbLike,
  empId: number,
  date: string,
  branchId?: number | null,
): Promise<number> {
  if (branchId != null && Number(branchId) > 0) return Number(branchId);

  const existing = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('workDate', sql.Date, date)
    .query(`
      SELECT TOP 1 BranchID
      FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND WorkDate = @workDate
      ORDER BY ID
    `);
  if (existing.recordset[0]?.BranchID != null) {
    return Number(existing.recordset[0].BranchID);
  }

  const home = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('day', sql.Date, date)
    .query(`
      SELECT TOP 1 ea.BranchID
      FROM dbo.TblEmpBranchAssignment ea
      INNER JOIN dbo.TblBranch b ON b.BranchID = ea.BranchID
      WHERE ea.EmpID = @empId
        AND ea.IsActive = 1
        AND b.IsActive = 1
        AND ea.EffectiveFrom <= @day
        AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @day)
      ORDER BY ea.IsHomeBranch DESC, ea.ID
    `);
  if (home.recordset[0]?.BranchID != null) {
    return Number(home.recordset[0].BranchID);
  }

  return resolveGleemBranchId(db);
}

export const SC_BLOCK_RANGE_SOURCE = 'schedule-control block_range';
export const ATTENDANCE_BREAK_SOURCE = 'attendance-break';
export const ATTENDANCE_BREAK_TIME_SOURCE = 'attendance-break-time';

export function isSyncedBlockRangeCreatedBy(createdBy: string | null | undefined): boolean {
  if (!createdBy) return false;
  return (
    createdBy === ATTENDANCE_BREAK_SOURCE ||
    createdBy === ATTENDANCE_BREAK_TIME_SOURCE ||
    createdBy.startsWith(SC_BLOCK_RANGE_SOURCE)
  );
}

/** Same-day intervals only (block_range cannot span overnight). */
export function isSameDayBlockInterval(
  leaveAt: string | null | undefined,
  returnAt: string | null | undefined,
): boolean {
  const leave = normalizeTimeHHmm(leaveAt);
  const ret = normalizeTimeHHmm(returnAt);
  if (!leave || !ret) return false;
  const leaveMin = timeToMinutes(leave);
  const retMin = timeToMinutes(ret);
  if (leaveMin == null || retMin == null) return false;
  return retMin > leaveMin;
}

export function intervalKey(start: string, end: string): string {
  return `${normalizeTimeHHmm(start) ?? ''}-${normalizeTimeHHmm(end) ?? ''}`;
}

export function breaksToSyncableIntervals(
  breaks: AttendanceBreakInterval[],
): Array<{ startTime: string; endTime: string; minutes: number; notes: string | null }> {
  const out: Array<{ startTime: string; endTime: string; minutes: number; notes: string | null }> = [];
  for (const b of breaks) {
    if (!isSameDayBlockInterval(b.LeaveAt, b.ReturnAt)) continue;
    const startTime = normalizeTimeHHmm(b.LeaveAt)!;
    const endTime = normalizeTimeHHmm(b.ReturnAt)!;
    out.push({
      startTime,
      endTime,
      minutes: b.Minutes ?? breakIntervalMinutes(startTime, endTime),
      notes: b.Notes ?? null,
    });
  }
  return out;
}

/**
 * HR → Ops: rebuild synced block_range overrides to match وقت مستقطع.
 * Also deactivates schedule-control–authored block_ranges for this date
 * (they are mirrored as مستقطع rows and rebuilt from the breaks payload).
 * Does NOT touch attendance-break-time (وقت البريك) overrides.
 */
export async function syncBlockRangesFromBreaks(
  db: DbLike,
  empId: number,
  date: string,
  breaks: AttendanceBreakInterval[],
): Promise<{ deactivated: number; inserted: number }> {
  await ensureOverridesTable(db as Parameters<typeof ensureOverridesTable>[0]);

  const deactivateRes = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('odate', sql.Date, date)
    .input('attSrc', sql.NVarChar(100), ATTENDANCE_BREAK_SOURCE)
    .input('scSrc', sql.NVarChar(100), SC_BLOCK_RANGE_SOURCE)
    .query(`
      UPDATE dbo.TblEmpScheduleOverrides
      SET IsActive = 0
      WHERE EmpID = @empId
        AND OverrideDate = @odate
        AND Type = N'block_range'
        AND IsActive = 1
        AND (
          CreatedBy = @attSrc
          OR CreatedBy LIKE @scSrc + N'%'
        )
    `);

  const deactivated = deactivateRes.rowsAffected?.[0] ?? 0;
  const intervals = breaksToSyncableIntervals(breaks);
  let inserted = 0;

  for (const iv of intervals) {
    const reason =
      iv.notes && !iv.notes.startsWith(SC_BLOCK_RANGE_SOURCE)
        ? iv.notes.slice(0, 300)
        : 'وقت مستقطع';
    await db
      .request()
      .input('empId', sql.Int, empId)
      .input('odate', sql.Date, date)
      .input('startT', sql.NVarChar(5), iv.startTime)
      .input('endT', sql.NVarChar(5), iv.endTime)
      .input('reason', sql.NVarChar(300), reason)
      .input('createdBy', sql.NVarChar(100), ATTENDANCE_BREAK_SOURCE)
      .query(`
        INSERT INTO dbo.TblEmpScheduleOverrides
          (EmpID, OverrideDate, Type, StartTime, EndTime, Reason, IsActive, CreatedBy)
        VALUES
          (@empId, @odate, N'block_range',
           TRY_CAST(@startT AS TIME),
           TRY_CAST(@endT AS TIME),
           @reason, 1, @createdBy)
      `);
    inserted += 1;
  }

  return { deactivated, inserted };
}

/**
 * HR → Ops: rebuild block_range overrides for وقت البريك only.
 * Does not touch مستقطع or schedule-control overrides.
 */
export async function syncBlockRangesFromBreakTimes(
  db: DbLike,
  empId: number,
  date: string,
  breakTimes: AttendanceBreakInterval[],
): Promise<{ deactivated: number; inserted: number }> {
  await ensureOverridesTable(db as Parameters<typeof ensureOverridesTable>[0]);

  const deactivateRes = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('odate', sql.Date, date)
    .input('attSrc', sql.NVarChar(100), ATTENDANCE_BREAK_TIME_SOURCE)
    .query(`
      UPDATE dbo.TblEmpScheduleOverrides
      SET IsActive = 0
      WHERE EmpID = @empId
        AND OverrideDate = @odate
        AND Type = N'block_range'
        AND IsActive = 1
        AND CreatedBy = @attSrc
    `);

  const deactivated = deactivateRes.rowsAffected?.[0] ?? 0;
  const intervals = breaksToSyncableIntervals(breakTimes);
  let inserted = 0;

  for (const iv of intervals) {
    const reason =
      iv.notes && !iv.notes.startsWith(SC_BLOCK_RANGE_SOURCE)
        ? iv.notes.slice(0, 300)
        : 'وقت البريك';
    await db
      .request()
      .input('empId', sql.Int, empId)
      .input('odate', sql.Date, date)
      .input('startT', sql.NVarChar(5), iv.startTime)
      .input('endT', sql.NVarChar(5), iv.endTime)
      .input('reason', sql.NVarChar(300), reason)
      .input('createdBy', sql.NVarChar(100), ATTENDANCE_BREAK_TIME_SOURCE)
      .query(`
        INSERT INTO dbo.TblEmpScheduleOverrides
          (EmpID, OverrideDate, Type, StartTime, EndTime, Reason, IsActive, CreatedBy)
        VALUES
          (@empId, @odate, N'block_range',
           TRY_CAST(@startT AS TIME),
           TRY_CAST(@endT AS TIME),
           @reason, 1, @createdBy)
      `);
    inserted += 1;
  }

  return { deactivated, inserted };
}

async function ensureAttendanceRow(
  db: DbLike,
  empId: number,
  date: string,
  branchId: number,
): Promise<number> {
  const existing = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('workDate', sql.Date, date)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT ID FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND WorkDate = @workDate AND BranchID = @branchId
    `);

  if (existing.recordset.length > 0) {
    return existing.recordset[0].ID as number;
  }

  const inserted = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('workDate', sql.Date, date)
    .input('branchId', sql.Int, branchId)
    .query(`
      INSERT INTO dbo.TblEmpAttendance (BranchID, EmpID, WorkDate, Status, Notes, CreatedAt)
      OUTPUT INSERTED.ID
      VALUES (@branchId, @empId, @workDate, N'Present', NULL, GETDATE())
    `);

  return inserted.recordset[0].ID as number;
}

/**
 * Ops → HR: add a matching وقت مستقطع row for a block_range interval.
 */
export async function syncBreakFromBlockRange(
  db: DbLike,
  empId: number,
  date: string,
  startTime: string,
  endTime: string,
  reason?: string | null,
  branchId?: number | null,
): Promise<{ attendanceId: number; added: boolean }> {
  await ensureAttendanceBreakSchema(db);

  const leaveAt = normalizeTimeHHmm(startTime);
  const returnAt = normalizeTimeHHmm(endTime);
  if (!leaveAt || !returnAt || !isSameDayBlockInterval(leaveAt, returnAt)) {
    return { attendanceId: 0, added: false };
  }

  const resolvedBranchId = await resolveAttendanceBranchId(db, empId, date, branchId);
  const attendanceId = await ensureAttendanceRow(db, empId, date, resolvedBranchId);
  const breaksMap = await loadBreaksByAttendanceIds(db, [attendanceId]);
  const existing = breaksMap.get(attendanceId) ?? [];
  const key = intervalKey(leaveAt, returnAt);

  if (existing.some((b) => intervalKey(b.LeaveAt, b.ReturnAt ?? '') === key)) {
    return { attendanceId, added: false };
  }

  const notes = reason
    ? `${SC_BLOCK_RANGE_SOURCE}: ${reason}`.slice(0, 200)
    : SC_BLOCK_RANGE_SOURCE;

  const next: AttendanceBreakInterval[] = [
    ...existing,
    {
      LeaveAt: leaveAt,
      ReturnAt: returnAt,
      Minutes: breakIntervalMinutes(leaveAt, returnAt),
      Notes: notes,
    },
  ];

  await replaceAttendanceBreaks(db, attendanceId, next);
  return { attendanceId, added: true };
}

/**
 * Ops DELETE → HR: remove matching وقت مستقطع interval.
 */
export async function removeBreakMatchingBlockRange(
  db: DbLike,
  empId: number,
  date: string,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): Promise<{ removed: boolean }> {
  await ensureAttendanceBreakSchema(db);

  const leaveAt = normalizeTimeHHmm(startTime);
  const returnAt = normalizeTimeHHmm(endTime);
  if (!leaveAt || !returnAt) return { removed: false };

  const existingAtt = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('workDate', sql.Date, date)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND WorkDate = @workDate
      ORDER BY ID
    `);

  if (!existingAtt.recordset.length) return { removed: false };

  const attendanceId = existingAtt.recordset[0].ID as number;
  const breaksMap = await loadBreaksByAttendanceIds(db, [attendanceId]);
  const existing = breaksMap.get(attendanceId) ?? [];
  const key = intervalKey(leaveAt, returnAt);
  const next = existing.filter((b) => intervalKey(b.LeaveAt, b.ReturnAt ?? '') !== key);

  if (next.length === existing.length) return { removed: false };

  await replaceAttendanceBreaks(db, attendanceId, next);
  return { removed: true };
}

/**
 * Ops DELETE → HR: remove matching وقت البريك interval.
 */
export async function removeBreakTimeMatchingBlockRange(
  db: DbLike,
  empId: number,
  date: string,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): Promise<{ removed: boolean }> {
  await ensureAttendanceBreakTimeSchema(db);

  const leaveAt = normalizeTimeHHmm(startTime);
  const returnAt = normalizeTimeHHmm(endTime);
  if (!leaveAt || !returnAt) return { removed: false };

  const existingAtt = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('workDate', sql.Date, date)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND WorkDate = @workDate
      ORDER BY ID
    `);

  if (!existingAtt.recordset.length) return { removed: false };

  const attendanceId = existingAtt.recordset[0].ID as number;
  const map = await loadBreakTimesByAttendanceIds(db, [attendanceId]);
  const existing = map.get(attendanceId) ?? [];
  const key = intervalKey(leaveAt, returnAt);
  const next = existing.filter((b) => intervalKey(b.LeaveAt, b.ReturnAt ?? '') !== key);

  if (next.length === existing.length) return { removed: false };

  await replaceAttendanceBreakTimes(db, attendanceId, next);
  return { removed: true };
}
