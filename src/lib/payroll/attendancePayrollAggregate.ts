/**
 * Phase 1K/1L — payroll attendance aggregates.
 *
 * Phase 1L: branch/day is the writable payroll input.
 * Employee/day aggregate remains available for consolidated reads only.
 */
import 'server-only';

import { sql } from '@/lib/db';

export type EmpDayAttendanceAggregate = {
  empId: number;
  workDate: string;
  primaryAttendanceId: number;
  sessionCount: number;
  netMinutes: number;
  breakMinutesTotal: number;
  hasOpenSession: boolean;
  hasAnyCheckIn: boolean;
  branchId?: number;
};

/**
 * Load employee/day aggregates from vw_EmpAttendancePayrollDay (cross-branch).
 * Prefer branch-day aggregates for payroll generation (Phase 1L).
 */
export async function loadEmpDayAttendanceAggregates(
  pool: { request: () => sql.Request },
  workDate: string,
): Promise<Map<number, EmpDayAttendanceAggregate>> {
  const result = await pool
    .request()
    .input('WorkDate', sql.Date, workDate)
    .query(`
      SELECT
        EmpID,
        WorkDate,
        PrimaryAttendanceID,
        SessionCount,
        ISNULL(NetMinutesRaw, 0) AS NetMinutesRaw,
        ISNULL(BreakMinutesTotal, 0) AS BreakMinutesTotal,
        CAST(HasOpenSession AS INT) AS HasOpenSession,
        CAST(HasAnyCheckIn AS INT) AS HasAnyCheckIn
      FROM dbo.vw_EmpAttendancePayrollDay
      WHERE WorkDate = @WorkDate
    `);

  const map = new Map<number, EmpDayAttendanceAggregate>();
  for (const row of result.recordset as Array<{
    EmpID: number;
    WorkDate: Date | string;
    PrimaryAttendanceID: number;
    SessionCount: number;
    NetMinutesRaw: number;
    BreakMinutesTotal: number;
    HasOpenSession: number;
    HasAnyCheckIn: number;
  }>) {
    const workDateStr =
      row.WorkDate instanceof Date
        ? row.WorkDate.toISOString().slice(0, 10)
        : String(row.WorkDate).slice(0, 10);
    map.set(Number(row.EmpID), {
      empId: Number(row.EmpID),
      workDate: workDateStr,
      primaryAttendanceId: Number(row.PrimaryAttendanceID),
      sessionCount: Number(row.SessionCount) || 0,
      netMinutes: Math.max(0, Number(row.NetMinutesRaw) || 0),
      breakMinutesTotal: Number(row.BreakMinutesTotal) || 0,
      hasOpenSession: Number(row.HasOpenSession) === 1,
      hasAnyCheckIn: Number(row.HasAnyCheckIn) === 1,
    });
  }
  return map;
}

/** Branch/day aggregates — Phase 1L payroll input. */
export async function loadEmpBranchDayAttendanceAggregates(
  pool: { request: () => sql.Request },
  workDate: string,
  branchId: number,
): Promise<Map<number, EmpDayAttendanceAggregate>> {
  const result = await pool
    .request()
    .input('WorkDate', sql.Date, workDate)
    .input('BranchID', sql.Int, branchId)
    .query(`
      SELECT
        BranchID,
        EmpID,
        WorkDate,
        PrimaryAttendanceID,
        SessionCount,
        ISNULL(NetMinutesRaw, 0) AS NetMinutesRaw,
        ISNULL(BreakMinutesTotal, 0) AS BreakMinutesTotal,
        CAST(HasOpenSession AS INT) AS HasOpenSession,
        CAST(HasAnyCheckIn AS INT) AS HasAnyCheckIn
      FROM dbo.vw_EmpAttendancePayrollBranchDay
      WHERE WorkDate = @WorkDate AND BranchID = @BranchID
    `);

  const map = new Map<number, EmpDayAttendanceAggregate>();
  for (const row of result.recordset as Array<{
    BranchID: number;
    EmpID: number;
    WorkDate: Date | string;
    PrimaryAttendanceID: number;
    SessionCount: number;
    NetMinutesRaw: number;
    BreakMinutesTotal: number;
    HasOpenSession: number;
    HasAnyCheckIn: number;
  }>) {
    const workDateStr =
      row.WorkDate instanceof Date
        ? row.WorkDate.toISOString().slice(0, 10)
        : String(row.WorkDate).slice(0, 10);
    map.set(Number(row.EmpID), {
      empId: Number(row.EmpID),
      workDate: workDateStr,
      primaryAttendanceId: Number(row.PrimaryAttendanceID),
      sessionCount: Number(row.SessionCount) || 0,
      netMinutes: Math.max(0, Number(row.NetMinutesRaw) || 0),
      breakMinutesTotal: Number(row.BreakMinutesTotal) || 0,
      hasOpenSession: Number(row.HasOpenSession) === 1,
      hasAnyCheckIn: Number(row.HasAnyCheckIn) === 1,
      branchId: Number(row.BranchID),
    });
  }
  return map;
}

/** Synthetic attendance row shape for existing payroll validation helpers. */
export function aggregateToValidationAttendance(
  agg: EmpDayAttendanceAggregate | undefined,
): {
  Status: string;
  CheckInTime: unknown;
  CheckOutTime: unknown;
} | null {
  if (!agg || agg.sessionCount === 0) return null;
  return {
    Status: 'Present',
    CheckInTime: agg.hasAnyCheckIn ? '00:00' : null,
    CheckOutTime: agg.hasOpenSession ? null : '00:00',
  };
}

/**
 * Actual hours expression when joining aggregate view alias `v`
 * (NetMinutesRaw already subtracts breaks).
 */
export const AGGREGATE_ACTUAL_HOURS_EXPR = `
  CASE
    WHEN v.NetMinutesRaw IS NULL THEN NULL
    ELSE CAST(
      CASE WHEN v.NetMinutesRaw < 0 THEN 0 ELSE v.NetMinutesRaw END
      AS DECIMAL(10, 2)
    ) / CAST(60 AS DECIMAL(10, 2))
  END
`;
