/**
 * Phase 1K/1L — payroll attendance aggregates.
 *
 * Phase 1L: branch/day is the writable payroll input.
 * Employee/day aggregate remains available for consolidated reads only.
 */
import 'server-only';

import { sql } from '@/lib/db';
import { isPayableAttendanceStatus } from '@/lib/payroll/dailyPayrollHrRules';

export type EmpDayAttendanceAggregate = {
  empId: number;
  workDate: string;
  primaryAttendanceId: number;
  /** Real Status from PrimaryAttendanceID (Present/Late/Absent/…). */
  primaryStatus: string | null;
  sessionCount: number;
  netMinutes: number;
  breakMinutesTotal: number;
  hasOpenSession: boolean;
  hasAnyCheckIn: boolean;
  branchId?: number;
};

function mapAggregateRow(row: {
  EmpID: number;
  WorkDate: Date | string;
  PrimaryAttendanceID: number;
  PrimaryStatus: string | null;
  SessionCount: number;
  NetMinutesRaw: number;
  BreakMinutesTotal: number;
  HasOpenSession: number;
  HasAnyCheckIn: number;
  BranchID?: number;
}): EmpDayAttendanceAggregate {
  const workDateStr =
    row.WorkDate instanceof Date
      ? row.WorkDate.toISOString().slice(0, 10)
      : String(row.WorkDate).slice(0, 10);
  return {
    empId: Number(row.EmpID),
    workDate: workDateStr,
    primaryAttendanceId: Number(row.PrimaryAttendanceID),
    primaryStatus: row.PrimaryStatus != null ? String(row.PrimaryStatus) : null,
    sessionCount: Number(row.SessionCount) || 0,
    netMinutes: Math.max(0, Number(row.NetMinutesRaw) || 0),
    breakMinutesTotal: Number(row.BreakMinutesTotal) || 0,
    hasOpenSession: Number(row.HasOpenSession) === 1,
    hasAnyCheckIn: Number(row.HasAnyCheckIn) === 1,
    ...(row.BranchID != null ? { branchId: Number(row.BranchID) } : {}),
  };
}

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
        v.EmpID,
        v.WorkDate,
        v.PrimaryAttendanceID,
        a.Status AS PrimaryStatus,
        v.SessionCount,
        ISNULL(v.NetMinutesRaw, 0) AS NetMinutesRaw,
        ISNULL(v.BreakMinutesTotal, 0) AS BreakMinutesTotal,
        CAST(v.HasOpenSession AS INT) AS HasOpenSession,
        CAST(v.HasAnyCheckIn AS INT) AS HasAnyCheckIn
      FROM dbo.vw_EmpAttendancePayrollDay v
      INNER JOIN dbo.TblEmpAttendance a ON a.ID = v.PrimaryAttendanceID
      WHERE v.WorkDate = @WorkDate
    `);

  const map = new Map<number, EmpDayAttendanceAggregate>();
  for (const row of result.recordset as Array<{
    EmpID: number;
    WorkDate: Date | string;
    PrimaryAttendanceID: number;
    PrimaryStatus: string | null;
    SessionCount: number;
    NetMinutesRaw: number;
    BreakMinutesTotal: number;
    HasOpenSession: number;
    HasAnyCheckIn: number;
  }>) {
    map.set(Number(row.EmpID), mapAggregateRow(row));
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
        v.BranchID,
        v.EmpID,
        v.WorkDate,
        v.PrimaryAttendanceID,
        a.Status AS PrimaryStatus,
        v.SessionCount,
        ISNULL(v.NetMinutesRaw, 0) AS NetMinutesRaw,
        ISNULL(v.BreakMinutesTotal, 0) AS BreakMinutesTotal,
        CAST(v.HasOpenSession AS INT) AS HasOpenSession,
        CAST(v.HasAnyCheckIn AS INT) AS HasAnyCheckIn
      FROM dbo.vw_EmpAttendancePayrollBranchDay v
      INNER JOIN dbo.TblEmpAttendance a ON a.ID = v.PrimaryAttendanceID
      WHERE v.WorkDate = @WorkDate AND v.BranchID = @BranchID
    `);

  const map = new Map<number, EmpDayAttendanceAggregate>();
  for (const row of result.recordset as Array<{
    BranchID: number;
    EmpID: number;
    WorkDate: Date | string;
    PrimaryAttendanceID: number;
    PrimaryStatus: string | null;
    SessionCount: number;
    NetMinutesRaw: number;
    BreakMinutesTotal: number;
    HasOpenSession: number;
    HasAnyCheckIn: number;
  }>) {
    map.set(Number(row.EmpID), mapAggregateRow(row));
  }
  return map;
}

/**
 * Synthetic attendance for payroll validation.
 * Uses the real primary Status — never force Present.
 * Absent/Leave/etc. without punches return null so they do not block generate.
 */
export function aggregateToValidationAttendance(
  agg: EmpDayAttendanceAggregate | undefined,
): {
  Status: string;
  CheckInTime: unknown;
  CheckOutTime: unknown;
} | null {
  if (!agg || agg.sessionCount === 0) return null;

  const status = (agg.primaryStatus ?? '').trim() || 'Present';

  // Placeholder non-payable rows (e.g. Absent with no punches) must not enter
  // the generate gate as incomplete Present — that blocked the whole day.
  if (!isPayableAttendanceStatus(status) && !agg.hasAnyCheckIn) {
    return null;
  }

  return {
    Status: status,
    CheckInTime: agg.hasAnyCheckIn ? '00:00' : null,
    CheckOutTime: !agg.hasAnyCheckIn ? null : agg.hasOpenSession ? null : '00:00',
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
