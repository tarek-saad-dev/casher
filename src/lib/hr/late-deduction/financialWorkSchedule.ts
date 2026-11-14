import 'server-only';

import { getPool, sql } from '@/lib/db';
import { normalizeEmploymentType } from '@/lib/hr/employee-hr-model';
import { resolveScheduleForDay } from '@/lib/hr/attendance-eligibility';
import type { LateCaseDb } from './caseTransaction';

/** HR workdays (TblEmpWorkSchedule), never booking allocation windows. */
export type FinancialWorkSchedule = {
  isScheduledWorkingDay: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
};

export type FinancialScheduleRow = {
  EmploymentType?: string | null;
  ScheduleDayOfWeek?: number | null;
  IsWorkingDay?: boolean | number | null;
  ScheduleStartTime?: string | null;
  ScheduleEndTime?: string | null;
  DefaultCheckInTime?: string | null;
  DefaultCheckOutTime?: string | null;
};

export function resolveFinancialWorkScheduleRow(
  row: FinancialScheduleRow,
): FinancialWorkSchedule {
  const employmentType =
    normalizeEmploymentType(String(row.EmploymentType ?? '')) ?? 'full_time';
  const resolved = resolveScheduleForDay(employmentType, {
    hasScheduleRow: row.ScheduleDayOfWeek != null,
    isWorkingDayFromSchedule:
      row.ScheduleDayOfWeek == null ? null : Boolean(row.IsWorkingDay),
    scheduleStart: row.ScheduleStartTime || null,
    scheduleEnd: row.ScheduleEndTime || null,
    defaultStart: row.DefaultCheckInTime || null,
    defaultEnd: row.DefaultCheckOutTime || null,
  });
  return {
    isScheduledWorkingDay: resolved.isScheduledWorkingDay,
    scheduledStart: resolved.isScheduledWorkingDay ? resolved.scheduledStart : null,
    scheduledEnd: resolved.isScheduledWorkingDay ? resolved.scheduledEnd : null,
  };
}

/**
 * Financial clock is owned by HR. Branch-scoped for authorization only.
 * A missing HR schedule fails closed; never infer pay from booking hours.
 */
export async function resolveEmployeeFinancialWorkSchedule(params: {
  empId: number;
  branchId: number;
  workDate: string;
  db?: LateCaseDb;
}): Promise<FinancialWorkSchedule | null> {
  const db = params.db ?? (await getPool());
  const dow = new Date(params.workDate + 'T12:00:00Z').getUTCDay();
  if (!Number.isFinite(dow)) return null;
  const result = await db.request()
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('dow', sql.TinyInt, dow)
    .query(
      'SELECT TOP 1 e.EmploymentType, ' +
      'CONVERT(VARCHAR(5),e.DefaultCheckInTime,108) AS DefaultCheckInTime, ' +
      'CONVERT(VARCHAR(5),e.DefaultCheckOutTime,108) AS DefaultCheckOutTime, ' +
      'ws.DayOfWeek AS ScheduleDayOfWeek, ws.IsWorkingDay, ' +
      'CONVERT(VARCHAR(5),ws.StartTime,108) AS ScheduleStartTime, ' +
      'CONVERT(VARCHAR(5),ws.EndTime,108) AS ScheduleEndTime ' +
      'FROM dbo.TblEmp e ' +
      'LEFT JOIN dbo.TblEmpWorkSchedule ws ON ws.EmpID=e.EmpID AND ws.DayOfWeek=@dow ' +
      'WHERE e.EmpID=@empId AND e.TenantId IN ' +
      '(SELECT l.TenantId FROM dbo.Location l WHERE l.LegacyBranchId=@branchId AND l.Status=N\'active\')'
    );
  const row = result.recordset[0] as FinancialScheduleRow | undefined;
  return row ? resolveFinancialWorkScheduleRow(row) : null;
}
