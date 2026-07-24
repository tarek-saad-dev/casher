/**
 * HR → Ops: mirror check-in / check-out onto TblEmpScheduleOverrides
 * so public `available-slots` reflects the real bookable window.
 *
 * - Late check-in  → late_start  (StartTime = CheckIn)
 * - Early arrival  → custom_hours (StartTime = CheckIn, EndTime = scheduled/checkout end)
 * - Early leave    → early_leave (EndTime = CheckOut)
 *
 * Only touches overrides with CreatedBy = "attendance-shift".
 * Ops-authored late_start / early_leave / custom_hours are left alone.
 */

import { sql } from '@/lib/db';
import { normalizeTimeHHmm, timeToMinutes } from '@/lib/hr/attendance-breaks';
import { ensureOverridesTable } from '@/lib/scheduleOverrides';
import {
  calcEarlyLeaveMinutes,
  calcLateMinutes,
} from '@/lib/timeUtils';

type DbLike = { request: () => sql.Request };

export const ATTENDANCE_SHIFT_SOURCE = 'attendance-shift';

const SHIFT_TYPES = ['late_start', 'early_leave', 'custom_hours'] as const;
type ShiftOverrideType = (typeof SHIFT_TYPES)[number];

export type AttendanceShiftSyncInput = {
  checkInTime: string | null | undefined;
  checkOutTime: string | null | undefined;
  scheduledStart: string | null | undefined;
  scheduledEnd: string | null | undefined;
  /** When Absent / DayOff / Excused — clear attendance-sourced shift overrides. */
  status?: string | null;
};

export type AttendanceShiftOverrideRow = {
  type: ShiftOverrideType;
  startTime: string | null;
  endTime: string | null;
  reason: string;
};

export type AttendanceShiftPlan =
  | { action: 'clear' }
  | { action: 'apply'; overrides: AttendanceShiftOverrideRow[] };

const CLEAR_STATUSES = new Set(['Absent', 'DayOff', 'Excused']);

/**
 * Pure planner: given attendance times, decide which shift overrides to write.
 * Exported for unit tests.
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

  if (!checkIn || !schedStart) {
    // No arrival signal → clear prior attendance late/early-start mirrors.
    // Keep early_leave only if checkout already proves early leave.
    if (checkOut && schedEnd && calcEarlyLeaveMinutes(checkOut, schedEnd) > 0) {
      return {
        action: 'apply',
        overrides: [
          {
            type: 'early_leave',
            startTime: null,
            endTime: checkOut,
            reason: 'انصراف مبكر من الحضور',
          },
        ],
      };
    }
    return { action: 'clear' };
  }

  const lateMinutes = calcLateMinutes(checkIn, schedStart);
  const checkInMin = timeToMinutes(checkIn);
  const schedStartMin = timeToMinutes(schedStart);
  const isEarlyArrival =
    lateMinutes === 0 &&
    checkInMin != null &&
    schedStartMin != null &&
    checkInMin < schedStartMin;

  const earlyLeave =
    checkOut && schedEnd && calcEarlyLeaveMinutes(checkOut, schedEnd) > 0
      ? checkOut
      : null;

  const overrides: AttendanceShiftOverrideRow[] = [];

  if (isEarlyArrival) {
    // Open earlier bookable window; end stays scheduled unless early leave.
    overrides.push({
      type: 'custom_hours',
      startTime: checkIn,
      endTime: earlyLeave ?? schedEnd ?? checkIn,
      reason: earlyLeave
        ? 'حضور مبكر + انصراف مبكر من الحضور'
        : 'حضور مبكر — فتح مواعيد أبكر',
    });
  } else {
    if (lateMinutes > 0) {
      overrides.push({
        type: 'late_start',
        startTime: checkIn,
        endTime: null,
        reason: `تأخير ${lateMinutes} د من الحضور`,
      });
    }
    if (earlyLeave) {
      overrides.push({
        type: 'early_leave',
        startTime: null,
        endTime: earlyLeave,
        reason: 'انصراف مبكر من الحضور',
      });
    }
  }

  if (!overrides.length) return { action: 'clear' };
  return { action: 'apply', overrides };
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
  row: {
    type: ShiftOverrideType;
    startTime: string | null;
    endTime: string | null;
    reason: string;
  },
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
 * Rebuild attendance-sourced shift overrides for one employee/day.
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
