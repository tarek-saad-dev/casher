/**
 * Keep non-posted daily payroll ActualHours/DailyWage aligned with live attendance.
 * Fixes overnight OT cases where NightlyClose D-filled checkout early, then punches
 * were corrected later without regenerating payroll.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { loadEmpBranchDayAttendanceAggregates } from '@/lib/payroll/attendancePayrollAggregate';

const SYNCABLE_STATUSES = new Set(['Generated', 'Earned', 'PendingCheckout']);

export async function syncNonPostedPayrollHoursFromAttendance(args: {
  empId: number;
  workDate: string;
  branchId: number;
}): Promise<{
  updated: boolean;
  payrollId: number | null;
  actualHours: number | null;
  dailyWage: number | null;
}> {
  const empId = Number(args.empId);
  const branchId = Number(args.branchId);
  if (
    !Number.isFinite(empId) ||
    !Number.isFinite(branchId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(args.workDate)
  ) {
    return { updated: false, payrollId: null, actualHours: null, dailyWage: null };
  }

  const db = await getPool();
  const aggs = await loadEmpBranchDayAttendanceAggregates(db, args.workDate, branchId);
  const agg = aggs.get(empId);
  if (!agg || agg.hasOpenSession || !agg.hasAnyCheckIn) {
    return { updated: false, payrollId: null, actualHours: null, dailyWage: null };
  }

  const actualHours = Math.round((Math.max(0, agg.netMinutes) / 60) * 100) / 100;

  const pay = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('day', sql.Date, args.workDate)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT TOP 1 ID, Status, ActualHours, DailyWage, HourlyRateSnapshot, Notes
      FROM dbo.TblEmpDailyPayroll
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID = @branchId
      ORDER BY ID DESC
    `);

  const row = pay.recordset[0] as
    | {
        ID: number;
        Status: string;
        ActualHours: number | null;
        DailyWage: number | null;
        HourlyRateSnapshot: number | null;
        Notes: string | null;
      }
    | undefined;

  if (!row || !SYNCABLE_STATUSES.has(String(row.Status))) {
    return { updated: false, payrollId: row?.ID ?? null, actualHours, dailyWage: null };
  }

  const prevHours =
    row.ActualHours != null && Number.isFinite(Number(row.ActualHours))
      ? Number(row.ActualHours)
      : null;
  if (prevHours != null && Math.abs(prevHours - actualHours) < 0.05) {
    return {
      updated: false,
      payrollId: row.ID,
      actualHours,
      dailyWage: row.DailyWage != null ? Number(row.DailyWage) : null,
    };
  }

  const rate =
    row.HourlyRateSnapshot != null && Number(row.HourlyRateSnapshot) > 0
      ? Number(row.HourlyRateSnapshot)
      : null;
  const dailyWage =
    rate != null ? Math.round(rate * actualHours * 100) / 100 : row.DailyWage;

  const syncNote = `HoursSync: ${prevHours ?? '—'}→${actualHours.toFixed(2)}h`;
  const notes =
    row.Notes && String(row.Notes).trim()
      ? `${row.Notes} | ${syncNote}`
      : syncNote;

  await db
    .request()
    .input('id', sql.Int, row.ID)
    .input('hours', sql.Decimal(10, 2), actualHours)
    .input('wage', sql.Decimal(18, 2), dailyWage)
    .input('notes', sql.NVarChar(500), notes.slice(0, 500))
    .query(`
      UPDATE dbo.TblEmpDailyPayroll
      SET ActualHours = @hours,
          DailyWage = @wage,
          Notes = @notes,
          UpdatedAt = GETDATE()
      WHERE ID = @id
        AND Status IN (N'Generated', N'Earned', N'PendingCheckout')
    `);

  return {
    updated: true,
    payrollId: row.ID,
    actualHours,
    dailyWage: dailyWage != null ? Number(dailyWage) : null,
  };
}
