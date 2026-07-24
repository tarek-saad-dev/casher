/**
 * HR → Ops: expand bookable window from attendance (does NOT close slots).
 *
 * Default day hours stay as the weekly schedule.
 * Ops «إدارة مواعيد اليوم» (late_start / early_leave / …) still closes slots.
 *
 * Attendance only OPENS / widens:
 * - Early check-in  → open slots before scheduled start
 * - Late check-out  → open slots after scheduled end («هيمشي متأخر»)
 *
 * Stored as custom_hours with CreatedBy = "attendance-shift".
 * applyOverrides widens only for this source (never shrinks).
 */

import { sql } from '@/lib/db';
import { normalizeTimeHHmm, timeToMinutes } from '@/lib/hr/attendance-breaks';
import {
  ATTENDANCE_SHIFT_OVERRIDE_SOURCE,
  ensureOverridesTable,
  loadOverridesForDate,
  type ScheduleOverride,
} from '@/lib/scheduleOverrides';
import { calcLateMinutes } from '@/lib/timeUtils';

type DbLike = { request: () => sql.Request };

export const ATTENDANCE_SHIFT_SOURCE = ATTENDANCE_SHIFT_OVERRIDE_SOURCE;

export type AttendanceShiftSyncInput = {
  checkInTime: string | null | undefined;
  checkOutTime: string | null | undefined;
  scheduledStart: string | null | undefined;
  scheduledEnd: string | null | undefined;
  /** When Absent / DayOff / Excused — clear attendance-sourced expand overrides. */
  status?: string | null;
};

export type AttendanceShiftOverrideRow = {
  type: 'custom_hours';
  startTime: string | null;
  endTime: string | null;
  reason: string;
};

export type AttendanceShiftPlan =
  | { action: 'clear' }
  | { action: 'apply'; overrides: AttendanceShiftOverrideRow[] };

const CLEAR_STATUSES = new Set(['Absent', 'DayOff', 'Excused']);

/** Minutes past scheduled end (0 if on-time or early leave). Same-day + light overnight. */
export function calcLateLeaveMinutes(
  checkOut: string | null | undefined,
  scheduledEnd: string | null | undefined,
  scheduledStart?: string | null,
): number {
  const out = normalizeTimeHHmm(checkOut);
  const end = normalizeTimeHHmm(scheduledEnd);
  if (!out || !end) return 0;

  const outMin = timeToMinutes(out)!;
  const endMin = timeToMinutes(end)!;
  const startMin = timeToMinutes(normalizeTimeHHmm(scheduledStart) ?? '') ?? null;

  // Normal day shift (end after start)
  if (startMin == null || endMin > startMin) {
    const diff = outMin - endMin;
    return diff > 0 ? diff : 0;
  }

  // Overnight: scheduled end after midnight; late leave is further into morning
  if (outMin > endMin && outMin < startMin) {
    return outMin - endMin;
  }
  return 0;
}

/**
 * Pure planner: expand-only overrides from attendance times.
 */
export function planAttendanceShiftOverrides(
  input: AttendanceShiftSyncInput,
): AttendanceShiftPlan {
  const status = (input.status || '').trim();
  if (CLEAR_STATUSES.has(status)) {
    return { action: 'clear' };
  }

  const checkIn = normalizeTimeHHmm(input.checkInTime);
  const checkOut = normalizeTimeHHmm(input.checkOutTime);
  const schedStart = normalizeTimeHHmm(input.scheduledStart);
  const schedEnd = normalizeTimeHHmm(input.scheduledEnd);

  const lateMinutes =
    checkIn && schedStart ? calcLateMinutes(checkIn, schedStart) : 0;
  const checkInMin = checkIn ? timeToMinutes(checkIn) : null;
  const schedStartMin = schedStart ? timeToMinutes(schedStart) : null;
  const isEarlyArrival =
    !!checkIn &&
    !!schedStart &&
    lateMinutes === 0 &&
    checkInMin != null &&
    schedStartMin != null &&
    checkInMin < schedStartMin;

  const lateLeaveMinutes = calcLateLeaveMinutes(checkOut, schedEnd, schedStart);
  const isLateLeave = lateLeaveMinutes > 0;

  if (!isEarlyArrival && !isLateLeave) {
    return { action: 'clear' };
  }

  const startTime = isEarlyArrival ? checkIn : null;
  const endTime = isLateLeave ? checkOut : null;

  let reason: string;
  if (isEarlyArrival && isLateLeave) {
    reason = 'حضور مبكر + انصراف متأخر من الحضور — فتح مواعيد';
  } else if (isEarlyArrival) {
    reason = 'حضور مبكر — فتح مواعيد أبكر';
  } else {
    reason = `انصراف متأخر ${lateLeaveMinutes} د — فتح مواعيد بعد الشيفت`;
  }

  return {
    action: 'apply',
    overrides: [
      {
        type: 'custom_hours',
        startTime,
        endTime,
        reason,
      },
    ],
  };
}

async function deactivateAttendanceShiftOverrides(
  db: DbLike,
  empId: number,
  date: string,
): Promise<number> {
  const res = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('odate', sql.Date, date)
    .input('src', sql.NVarChar(100), ATTENDANCE_SHIFT_SOURCE)
    .query(`
      UPDATE dbo.TblEmpScheduleOverrides
      SET IsActive = 0
      WHERE EmpID = @empId
        AND OverrideDate = @odate
        AND IsActive = 1
        AND CreatedBy = @src
        AND Type IN (N'late_start', N'early_leave', N'custom_hours')
    `);
  return res.rowsAffected?.[0] ?? 0;
}

async function insertShiftOverride(
  db: DbLike,
  empId: number,
  date: string,
  row: AttendanceShiftOverrideRow,
): Promise<void> {
  await db
    .request()
    .input('empId', sql.Int, empId)
    .input('odate', sql.Date, date)
    .input('type', sql.NVarChar(30), row.type)
    .input('startT', sql.NVarChar(5), row.startTime)
    .input('endT', sql.NVarChar(5), row.endTime)
    .input('reason', sql.NVarChar(300), row.reason.slice(0, 300))
    .input('createdBy', sql.NVarChar(100), ATTENDANCE_SHIFT_SOURCE)
    .query(`
      INSERT INTO dbo.TblEmpScheduleOverrides
        (EmpID, OverrideDate, Type, StartTime, EndTime, Reason, IsActive, CreatedBy)
      VALUES
        (@empId, @odate, @type,
         TRY_CAST(@startT AS TIME),
         TRY_CAST(@endT AS TIME),
         @reason, 1, @createdBy)
    `);
}

/**
 * Rebuild attendance-sourced expand overrides for one employee/day.
 * Safe to call after every attendance save (PUT or bulk).
 */
export async function syncAttendanceShiftToOverrides(
  db: DbLike,
  empId: number,
  date: string,
  input: AttendanceShiftSyncInput,
): Promise<{ deactivated: number; inserted: number; plan: AttendanceShiftPlan }> {
  await ensureOverridesTable(db as Parameters<typeof ensureOverridesTable>[0]);

  const plan = planAttendanceShiftOverrides(input);
  const deactivated = await deactivateAttendanceShiftOverrides(db, empId, date);

  if (plan.action === 'clear') {
    return { deactivated, inserted: 0, plan };
  }

  let inserted = 0;
  for (const row of plan.overrides) {
    await insertShiftOverride(db, empId, date, row);
    inserted += 1;
  }

  return { deactivated, inserted, plan };
}

/**
 * Read-time expand: build synthetic attendance-shift overrides from today's
 * attendance rows so available-slots works even if write-time sync was skipped.
 */
export async function loadAttendanceExpandOverrides(
  db: DbLike,
  empIds: number[],
  dateStr: string,
): Promise<Map<number, ScheduleOverride[]>> {
  const range = await loadAttendanceExpandOverridesRange(db, empIds, dateStr, dateStr);
  return range.get(dateStr) ?? new Map();
}

/**
 * Batch attendance expands for a date range (available-days).
 * Returns Map<dateStr, Map<empId, ScheduleOverride[]>>
 */
export async function loadAttendanceExpandOverridesRange(
  db: DbLike,
  empIds: number[],
  startDate: string,
  endDate: string,
): Promise<Map<string, Map<number, ScheduleOverride[]>>> {
  const byDate = new Map<string, Map<number, ScheduleOverride[]>>();
  if (!empIds.length) return byDate;

  try {
    const res = await db
      .request()
      .input('startDate', sql.Date, startDate)
      .input('endDate', sql.Date, endDate)
      .query(`
        SELECT
          EmpID,
          CONVERT(VARCHAR(10), WorkDate, 120) AS WorkDate,
          Status,
          CASE WHEN CheckInTime IS NOT NULL
               THEN LEFT(CONVERT(VARCHAR(8), CheckInTime, 108), 5) ELSE NULL END AS CheckInTime,
          CASE WHEN CheckOutTime IS NOT NULL
               THEN LEFT(CONVERT(VARCHAR(8), CheckOutTime, 108), 5) ELSE NULL END AS CheckOutTime,
          CASE WHEN ScheduledStartTime IS NOT NULL
               THEN LEFT(CONVERT(VARCHAR(8), ScheduledStartTime, 108), 5) ELSE NULL END AS ScheduledStartTime,
          CASE WHEN ScheduledEndTime IS NOT NULL
               THEN LEFT(CONVERT(VARCHAR(8), ScheduledEndTime, 108), 5) ELSE NULL END AS ScheduledEndTime
        FROM dbo.TblEmpAttendance
        WHERE WorkDate BETWEEN @startDate AND @endDate
          AND EmpID IN (${empIds.join(',')})
      `);

    let syntheticId = -1;
    for (const row of res.recordset) {
      const empId = Number(row.EmpID);
      const dateStr = String(row.WorkDate);
      const plan = planAttendanceShiftOverrides({
        checkInTime: row.CheckInTime,
        checkOutTime: row.CheckOutTime,
        scheduledStart: row.ScheduledStartTime,
        scheduledEnd: row.ScheduledEndTime,
        status: row.Status,
      });
      if (plan.action !== 'apply') continue;

      if (!byDate.has(dateStr)) byDate.set(dateStr, new Map());
      const empMap = byDate.get(dateStr)!;
      const list = empMap.get(empId) ?? [];
      for (const o of plan.overrides) {
        list.push({
          OverrideID: syntheticId--,
          EmpID: empId,
          OverrideDate: dateStr,
          Type: o.type,
          StartTime: o.startTime,
          EndTime: o.endTime,
          Reason: o.reason,
          IsActive: true,
          CreatedAt: new Date().toISOString(),
          CreatedBy: ATTENDANCE_SHIFT_SOURCE,
        });
      }
      empMap.set(empId, list);
    }
  } catch {
    /* attendance table may be unavailable */
  }

  return byDate;
}

/** Prefer live attendance expands over stored attendance-shift rows. */
export function mergeAttendanceExpandOverrides<T extends { CreatedBy: string | null }>(
  existing: Map<number, T[]>,
  fromAttendance: Map<number, T[]>,
): Map<number, T[]> {
  if (!fromAttendance.size) return existing;

  for (const [empId, attList] of fromAttendance) {
    const cur = existing.get(empId) ?? [];
    const withoutStaleAtt = cur.filter(
      (o) => o.CreatedBy !== ATTENDANCE_SHIFT_SOURCE,
    );
    existing.set(empId, [...withoutStaleAtt, ...attList]);
  }
  return existing;
}

/**
 * Canonical booking/ops overrides for a date:
 * schedule-control closes + attendance early-in / late-out opens.
 * Use this (not raw loadOverridesForDate) for any bookable window.
 */
export async function loadBookingOverridesForDate(
  db: DbLike,
  empIds: number[],
  dateStr: string,
): Promise<Map<number, ScheduleOverride[]>> {
  const [raw, expands] = await Promise.all([
    loadOverridesForDate(
      db as Parameters<typeof loadOverridesForDate>[0],
      empIds,
      dateStr,
    ),
    loadAttendanceExpandOverrides(db, empIds, dateStr),
  ]);
  return mergeAttendanceExpandOverrides(raw, expands);
}

/** Single-barber convenience for booking/ops window checks. */
export async function loadBookingOverridesForBarber(
  db: DbLike,
  empId: number,
  dateStr: string,
): Promise<ScheduleOverride[]> {
  const map = await loadBookingOverridesForDate(db, [empId], dateStr);
  return map.get(empId) ?? [];
}
