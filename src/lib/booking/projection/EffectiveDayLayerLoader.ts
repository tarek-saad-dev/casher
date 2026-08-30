/**
 * Booking V2 B4 — load date-specific layers from SoT (not final day-plan).
 * Does NOT call ensure/create-table. Not used by public routes in this phase.
 */

import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { EffectiveDayLayerInputs } from '@/lib/booking/domain/EffectiveDay';
import { parseBusinessDate } from '@/lib/booking/domain/BusinessDate';

function fmtTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return null;
}

export async function loadEffectiveDayLayerInputs(args: {
  employeeId: number;
  branchId: number;
  businessDate: string;
}): Promise<EffectiveDayLayerInputs> {
  const businessDate = String(parseBusinessDate(args.businessDate));
  const db = await getPool();
  const layers: EffectiveDayLayerInputs = {
    blockRanges: [],
    dailyAdjustments: [],
  };

  // Attendance absent
  try {
    const att = await db
      .request()
      .input('empId', sql.Int, args.employeeId)
      .input('day', sql.Date, businessDate)
      .query(`
        SELECT TOP 1 Status
        FROM dbo.TblEmpAttendance
        WHERE EmpID = @empId AND WorkDate = @day
        ORDER BY AttendanceID DESC
      `);
    const status = String(att.recordset[0]?.Status ?? '');
    if (status.toLowerCase() === 'absent') {
      layers.absent = true;
    }
  } catch {
    /* optional */
  }

  // Temporary transfer away / in
  try {
    const away = await db
      .request()
      .input('empId', sql.Int, args.employeeId)
      .input('branchId', sql.Int, args.branchId)
      .input('day', sql.Date, businessDate)
      .query(`
        SELECT TOP 1 1 AS X
        FROM dbo.TblEmpTemporaryBranchTransfer
        WHERE EmpID = @empId AND FromBranchID = @branchId AND WorkDate = @day AND IsActive = 1
      `);
    if (away.recordset[0]) {
      layers.assignmentDayRule = { kind: 'transferred_away' };
    }
    const into = await db
      .request()
      .input('empId', sql.Int, args.employeeId)
      .input('branchId', sql.Int, args.branchId)
      .input('day', sql.Date, businessDate)
      .query(`
        SELECT TOP 1 StartTime, EndTime
        FROM dbo.TblEmpTemporaryBranchTransfer
        WHERE EmpID = @empId AND ToBranchID = @branchId AND WorkDate = @day AND IsActive = 1
      `);
    const tin = into.recordset[0] as
      | { StartTime: unknown; EndTime: unknown }
      | undefined;
    if (tin) {
      const start = fmtTime(tin.StartTime);
      const end = fmtTime(tin.EndTime);
      layers.assignmentDayRule = {
        kind: 'transferred_in',
        windows: start && end ? [{ startHhmm: start, endHhmm: end }] : [],
      };
    }
  } catch {
    /* optional */
  }

  // Schedule overrides (ops)
  try {
    const ov = await db
      .request()
      .input('empId', sql.Int, args.employeeId)
      .input('day', sql.Date, businessDate)
      .query(`
        SELECT Type, StartTime, EndTime
        FROM dbo.TblEmpScheduleOverrides
        WHERE EmpID = @empId AND OverrideDate = @day AND IsActive = 1
      `);
    for (const row of ov.recordset as Array<{
      Type: string;
      StartTime: unknown;
      EndTime: unknown;
    }>) {
      const type = String(row.Type);
      const start = fmtTime(row.StartTime);
      const end = fmtTime(row.EndTime);
      if (type === 'day_off') layers.closeDay = true;
      if (type === 'late_start' && start) layers.lateStartHhmm = start;
      if (type === 'early_leave' && end) layers.earlyLeaveHhmm = end;
      if (type === 'block_range' && start && end) {
        layers.blockRanges = layers.blockRanges ?? [];
        layers.blockRanges.push({ startHhmm: start, endHhmm: end });
      }
      if (type === 'custom_hours' && start && end) {
        // May represent present-on-day-off unlock
        layers.presentOnDayOff = { startHhmm: start, endHhmm: end };
      }
    }
  } catch {
    /* optional */
  }

  // Daily adjustments (canonical window-table loader)
  try {
    const { loadDailyAdjustmentsBatch } = await import(
      '@/lib/availability/loadDailyAdjustmentsBatch'
    );
    const { mapEmployeeDailyAdjustmentsToEffectiveLayers } = await import(
      '@/lib/booking/projection/mapDailyAdjustmentsToEffectiveLayers'
    );
    const adjMap = await loadDailyAdjustmentsBatch({
      branchId: args.branchId,
      empIds: [args.employeeId],
      businessDate,
    });
    const adjustments = adjMap.get(args.employeeId) ?? [];
    if (adjustments.length) {
      layers.dailyAdjustments = mapEmployeeDailyAdjustmentsToEffectiveLayers(adjustments);
    }
  } catch {
    /* table may not exist yet */
  }

  // Branch exceptional hours (best-effort)
  try {
    const ex = await db
      .request()
      .input('branchId', sql.Int, args.branchId)
      .input('day', sql.Date, businessDate)
      .query(`
        SELECT TOP 1 IsClosed, OpenTime, CloseTime, EndDayOffset
        FROM dbo.TblBranchExceptionalHours
        WHERE BranchID = @branchId AND BusinessDate = @day AND IsActive = 1
        ORDER BY ExceptionID DESC
      `);
    const row = ex.recordset[0] as
      | {
          IsClosed: boolean | number;
          OpenTime: unknown;
          CloseTime: unknown;
          EndDayOffset: number | null;
        }
      | undefined;
    if (row) {
      layers.branchException = {
        isClosed: !!(row.IsClosed === true || row.IsClosed === 1),
        openHhmm: fmtTime(row.OpenTime),
        closeHhmm: fmtTime(row.CloseTime),
        endDayOffset: row.EndDayOffset === 1 ? 1 : 0,
      };
    }
  } catch {
    /* optional */
  }

  // Freelance unlock
  try {
    const { loadFreelanceBookingUnlocks } = await import(
      '@/lib/hr/freelanceBookingUnlock'
    );
    const map = await loadFreelanceBookingUnlocks([args.employeeId], businessDate);
    const unlock = map.get(args.employeeId);
    if (unlock?.start && unlock?.end) {
      layers.freelancerUnlock = {
        startHhmm: unlock.start.slice(0, 5),
        endHhmm: unlock.end.slice(0, 5),
      };
    }
  } catch {
    /* optional */
  }

  return layers;
}
