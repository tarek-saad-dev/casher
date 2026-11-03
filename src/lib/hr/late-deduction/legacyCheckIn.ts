import 'server-only';

import { sql } from '@/lib/db';
import { getLateDeductionConfig, isWorkDateEligibleForLateDeduction } from './config';
import { enqueueLateDeductionFinalize } from './enqueueFinalize';
import { scheduleFinalizeLateDeductionOnCheckIn } from './finalizeOnCheckIn';
import { calcLateMinutes, sqlTimeToHHmm } from '@/lib/timeUtils';
import { resolveScheduleForDay } from '@/lib/hr/attendance-eligibility';
import { normalizeEmploymentType } from '@/lib/hr/employee-hr-model';
import * as attendanceRepo from '@/modules/attendance/infra/AttendanceRepository';

/**
 * Bridge existing employee check-in writers to the late-deduction service.
 * Called AFTER attendance transaction commit, only for actual check-in edits.
 * Does nothing when the feature is off, on leave, or on a non-working day.
 * Keep attendance persistence independent of WhatsApp and ledger failures.
 */
export async function enqueueLegacyEmployeeCheckInLateDeduction(params: {
  attendanceId: number;
  empId: number;
  branchId: number;
  workDate: string;
}): Promise<void> {
  const { attendanceId, empId, branchId, workDate } = params;
  if (!Number.isInteger(attendanceId) || attendanceId <= 0 ||
    !Number.isInteger(empId) || empId <= 0 || !Number.isInteger(branchId) || branchId <= 0) return;

  const config = await getLateDeductionConfig(branchId);
  if (!isWorkDateEligibleForLateDeduction(workDate, config)) return;

  const db = await attendanceRepo.getAttendanceDb();
  const result = await db.request()
    .input('attendanceId', sql.Int, attendanceId)
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(
      'SELECT TOP 1 CheckInTime, Status, ' +
      'CONVERT(VARCHAR(5),ScheduledStartTime,108) AS ScheduledStartTime, ' +
      'CONVERT(VARCHAR(5),ScheduledEndTime,108) AS ScheduledEndTime ' +
      'FROM dbo.TblEmpAttendance WHERE ID=@attendanceId AND EmpID=@empId ' +
      'AND BranchID=@branchId AND WorkDate=@workDate'
    );
  const saved = result.recordset[0];
  if (!saved || !saved.CheckInTime ||
    ['Absent','DayOff','Excused','Leave','Holiday'].includes(String(saved.Status || ''))) return;

  const checkIn = sqlTimeToHHmm(saved.CheckInTime);
  if (!checkIn) return;
  const emp = await attendanceRepo.loadEmployeeScheduleForAdminPut(
    db, empId, workDate, branchId
  );
  if (!emp) return;
  const employmentType = normalizeEmploymentType(String(emp.EmploymentType || '')) ?? 'full_time';
  const schedule = resolveScheduleForDay(employmentType, {
    hasScheduleRow: emp.ScheduleDayOfWeek != null,
    isWorkingDayFromSchedule: emp.ScheduleDayOfWeek == null ? null : Boolean(emp.IsWorkingDay),
    scheduleStart: emp.ScheduleStartTime || null,
    scheduleEnd: emp.ScheduleEndTime || null,
    defaultStart: emp.DefaultCheckInTime || null,
    defaultEnd: emp.DefaultCheckOutTime || null,
  });
  if (!schedule.isScheduledWorkingDay) return;
  const scheduledStart = saved.ScheduledStartTime || schedule.scheduledStart;
  const scheduledEnd = saved.ScheduledEndTime || schedule.scheduledEnd;
  if (!scheduledStart) return;

  const lateMinutes = calcLateMinutes(checkIn, scheduledStart);
  // Legacy punch writers do not populate these payroll/attendance metadata columns.
  // Persist the exact dated schedule and lateness so recovery can reconcile it.
  await db.request()
    .input('attendanceId', sql.Int, attendanceId)
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('scheduledStart', sql.VarChar(8), scheduledStart)
    .input('scheduledEnd', sql.VarChar(8), scheduledEnd || null)
    .input('lateMinutes', sql.Int, lateMinutes)
    .query(
      'UPDATE dbo.TblEmpAttendance ' +
      'SET ScheduledStartTime=COALESCE(ScheduledStartTime,TRY_CAST(@scheduledStart AS TIME)), ' +
      'ScheduledEndTime=COALESCE(ScheduledEndTime,TRY_CAST(@scheduledEnd AS TIME)), ' +
      'LateMinutes=@lateMinutes, UpdatedAt=SYSDATETIME() ' +
      'WHERE ID=@attendanceId AND EmpID=@empId AND BranchID=@branchId AND CheckInTime IS NOT NULL'
    );

  const input = {
    attendanceId, empId, branchId, workDate,
    checkInTime: checkIn,
    scheduledStart,
    scheduledEnd,
  };
  const queued = await enqueueLateDeductionFinalize(input);
  if (queued.enqueued) scheduleFinalizeLateDeductionOnCheckIn(input);
}
