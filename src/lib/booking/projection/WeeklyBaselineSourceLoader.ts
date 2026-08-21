/**
 * Booking V2 B3/B4 — real Source-of-Truth loader for WeeklyBaseline.
 *
 * Loads ONLY:
 * - employee ↔ branch assignment
 * - weekly work schedule (branch-owned)
 * - regular branch hours (TblBranch defaults)
 *
 * Does NOT load day-plan, overrides, attendance, bookings, or holds.
 * Does NOT call ensure/create-table (deploy-time migrations assumed).
 */

import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  parseDayOfWeek,
  type DayOfWeek,
  type WeeklyBaselineSourceInputs,
} from '@/lib/booking/domain/WeeklyBaseline';

function fmtTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return null;
}

export type WeeklyBaselineSoTLoadArgs = {
  employeeId: number;
  branchId: number;
  dayOfWeek: DayOfWeek | number;
  /** As-of date for assignment / schedule effective windows (YYYY-MM-DD). */
  asOfDate: string;
};

/**
 * Load weekly baseline SoT inputs for one Emp × Branch × DOW.
 * Temporary transfers are intentionally excluded here — they are date-specific (B4 layers).
 */
export async function loadWeeklyBaselineSourceInputs(
  args: WeeklyBaselineSoTLoadArgs,
): Promise<WeeklyBaselineSourceInputs> {
  const dayOfWeek = parseDayOfWeek(args.dayOfWeek);
  const db = await getPool();

  const branchRes = await db
    .request()
    .input('branchId', sql.Int, args.branchId)
    .query(`
      SELECT DefaultOpenTime, DefaultCloseTime, IsActive
      FROM dbo.TblBranch
      WHERE BranchID = @branchId
    `);
  const branch = branchRes.recordset[0] as
    | { DefaultOpenTime: unknown; DefaultCloseTime: unknown; IsActive: boolean | number }
    | undefined;

  const open = branch ? fmtTime(branch.DefaultOpenTime) : null;
  const close = branch ? fmtTime(branch.DefaultCloseTime) : null;
  const branchIsOpen = !!branch && (branch.IsActive === true || branch.IsActive === 1);
  const branchHours =
    open && close
      ? {
          startHhmm: open,
          endHhmm: close,
        }
      : null;

  const assignRes = await db
    .request()
    .input('empId', sql.Int, args.employeeId)
    .input('branchId', sql.Int, args.branchId)
    .input('day', sql.Date, args.asOfDate)
    .query(`
      SELECT TOP 1 AssignmentID
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
        AND EffectiveFrom <= @day
        AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
      ORDER BY EffectiveFrom DESC, AssignmentID DESC
    `);
  const assigned = !!assignRes.recordset[0];

  let isEmployeeWorkingDay = false;
  let employeeWindows: WeeklyBaselineSourceInputs['employeeWindows'] = [];

  if (assigned) {
    const schedRes = await db
      .request()
      .input('empId', sql.Int, args.employeeId)
      .input('branchId', sql.Int, args.branchId)
      .input('dow', sql.TinyInt, dayOfWeek)
      .input('day', sql.Date, args.asOfDate)
      .query(`
        SELECT TOP 1 IsWorking, StartTime, EndTime
        FROM dbo.TblEmpBranchWorkSchedule
        WHERE EmpID = @empId AND BranchID = @branchId AND DayOfWeek = @dow
          AND IsActive = 1
          AND EffectiveFrom <= @day
          AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
        ORDER BY EffectiveFrom DESC, ScheduleID DESC
      `);
    const row = schedRes.recordset[0] as
      | { IsWorking: boolean | number; StartTime: unknown; EndTime: unknown }
      | undefined;
    if (row) {
      isEmployeeWorkingDay = !!(row.IsWorking === true || row.IsWorking === 1);
      const start = fmtTime(row.StartTime);
      const end = fmtTime(row.EndTime);
      if (isEmployeeWorkingDay && start && end) {
        employeeWindows = [{ startHhmm: start, endHhmm: end }];
      }
    } else {
      // Assigned but no branch schedule row — try legacy weekly (read-only, no ensure).
      try {
        const legacy = await db
          .request()
          .input('empId', sql.Int, args.employeeId)
          .input('dow', sql.TinyInt, dayOfWeek)
          .query(`
            SELECT TOP 1 IsWorking, StartTime, EndTime
            FROM dbo.TblEmpWorkSchedule
            WHERE EmpID = @empId AND DayOfWeek = @dow
          `);
        const lr = legacy.recordset[0] as
          | { IsWorking: boolean | number; StartTime: unknown; EndTime: unknown }
          | undefined;
        if (lr) {
          isEmployeeWorkingDay = !!(lr.IsWorking === true || lr.IsWorking === 1);
          const start = fmtTime(lr.StartTime);
          const end = fmtTime(lr.EndTime);
          if (isEmployeeWorkingDay && start && end) {
            employeeWindows = [{ startHhmm: start, endHhmm: end }];
          }
        }
      } catch {
        /* legacy table optional */
      }
    }
  }

  return {
    key: {
      employeeId: args.employeeId,
      branchId: args.branchId,
      dayOfWeek,
    },
    employeeWindows,
    isEmployeeWorkingDay: assigned && isEmployeeWorkingDay,
    branchHours,
    branchIsOpen,
  };
}
