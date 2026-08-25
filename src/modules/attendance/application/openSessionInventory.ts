/**
 * Read-only OPEN session inventory helpers (Phase 1 / Phase 7).
 * No mutations. For audits and future HR stale-cleanup UI.
 */
import type { AttendanceDb } from '../infra/AttendanceRepository';
import { sql } from '@/lib/db';
import {
  type OpenAttendanceSession,
  ymdWorkDate,
  classifyOpenSession,
} from '../domain/attendanceSessionPolicy';

function mapOpenRow(row: Record<string, unknown>): OpenAttendanceSession {
  return {
    attendanceId: Number(row.ID),
    employeeId: Number(row.EmpID),
    branchId: Number(row.BranchID),
    workDate: ymdWorkDate(row.WorkDate),
    checkInTime:
      row.CheckInTime == null ? null : String(row.CheckInTime).slice(0, 8),
  };
}

/** All OPEN rows for an employee (any WorkDate / branch). */
export async function listOpenSessionsForEmployee(
  db: AttendanceDb,
  empId: number,
): Promise<OpenAttendanceSession[]> {
  const result = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`
      SELECT
        ID, EmpID, BranchID, WorkDate,
        CONVERT(VARCHAR(8), CheckInTime, 108) AS CheckInTime
      FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId
        AND CheckInTime IS NOT NULL
        AND CheckOutTime IS NULL
      ORDER BY WorkDate DESC, ID DESC
    `);
  return (result.recordset as Array<Record<string, unknown>>).map(mapOpenRow);
}

/** OPEN rows whose WorkDate != candidate (STALE). */
export async function listStaleOpenSessionsForEmployee(
  db: AttendanceDb,
  empId: number,
  candidateWorkDate: string,
): Promise<OpenAttendanceSession[]> {
  const all = await listOpenSessionsForEmployee(db, empId);
  return all.filter(
    (s) => classifyOpenSession(s.workDate, candidateWorkDate) === 'STALE_OPEN',
  );
}

export type OpenSessionInventory = {
  totalOpen: number;
  employeesWithMultipleOpen: number;
  byEmpBranchDate: Array<{
    empId: number;
    branchId: number;
    workDate: string;
    count: number;
    ids: number[];
  }>;
  historicalOpenSample: OpenAttendanceSession[];
  sameDateCrossBranchOpen: Array<{
    empId: number;
    workDate: string;
    branchIds: number[];
    ids: number[];
  }>;
};

/**
 * Read-only aggregate inventory. Pass optional candidateWorkDate to classify historical.
 * Intended for scripts/tests — not a production mutation path.
 */
export async function inventoryOpenAttendanceSessions(
  db: AttendanceDb,
  options?: { candidateWorkDate?: string; sampleLimit?: number },
): Promise<OpenSessionInventory> {
  const sampleLimit = options?.sampleLimit ?? 50;
  const candidate = options?.candidateWorkDate
    ? ymdWorkDate(options.candidateWorkDate)
    : null;

  const allOpen = await db.request().query(`
    SELECT
      ID, EmpID, BranchID, WorkDate,
      CONVERT(VARCHAR(8), CheckInTime, 108) AS CheckInTime
    FROM dbo.TblEmpAttendance
    WHERE CheckInTime IS NOT NULL
      AND CheckOutTime IS NULL
    ORDER BY EmpID, WorkDate, BranchID, ID
  `);

  const rows = (allOpen.recordset as Array<Record<string, unknown>>).map(mapOpenRow);
  const byEmp = new Map<number, OpenAttendanceSession[]>();
  const byKey = new Map<string, { empId: number; branchId: number; workDate: string; ids: number[] }>();

  for (const r of rows) {
    const list = byEmp.get(r.employeeId) ?? [];
    list.push(r);
    byEmp.set(r.employeeId, list);

    const key = `${r.employeeId}|${r.branchId}|${r.workDate}`;
    const g = byKey.get(key) ?? {
      empId: r.employeeId,
      branchId: r.branchId,
      workDate: r.workDate,
      ids: [],
    };
    g.ids.push(r.attendanceId);
    byKey.set(key, g);
  }

  let employeesWithMultipleOpen = 0;
  for (const list of byEmp.values()) {
    if (list.length > 1) employeesWithMultipleOpen += 1;
  }

  const sameDateCross = new Map<
    string,
    { empId: number; workDate: string; branchIds: Set<number>; ids: number[] }
  >();
  for (const r of rows) {
    const k = `${r.employeeId}|${r.workDate}`;
    const g = sameDateCross.get(k) ?? {
      empId: r.employeeId,
      workDate: r.workDate,
      branchIds: new Set<number>(),
      ids: [],
    };
    g.branchIds.add(r.branchId);
    g.ids.push(r.attendanceId);
    sameDateCross.set(k, g);
  }

  const historicalOpenSample = candidate
    ? rows
        .filter((r) => classifyOpenSession(r.workDate, candidate) === 'STALE_OPEN')
        .slice(0, sampleLimit)
    : rows.slice(0, sampleLimit);

  return {
    totalOpen: rows.length,
    employeesWithMultipleOpen,
    byEmpBranchDate: [...byKey.values()].map((g) => ({
      empId: g.empId,
      branchId: g.branchId,
      workDate: g.workDate,
      count: g.ids.length,
      ids: g.ids,
    })),
    historicalOpenSample,
    sameDateCrossBranchOpen: [...sameDateCross.values()]
      .filter((g) => g.branchIds.size > 1)
      .map((g) => ({
        empId: g.empId,
        workDate: g.workDate,
        branchIds: [...g.branchIds],
        ids: g.ids,
      })),
  };
}
