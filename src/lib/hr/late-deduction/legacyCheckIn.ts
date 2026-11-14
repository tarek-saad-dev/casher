import 'server-only';

import { sql } from '@/lib/db';
import { getLateDeductionConfig, isWorkDateEligibleForLateDeduction } from './config';
import { enqueueLateDeductionFinalize } from './enqueueFinalize';
import { scheduleFinalizeLateDeductionOnCheckIn } from './finalizeOnCheckIn';
import { isLateDeductionExcludedAttendanceStatus } from './attendanceStatus';
import { voidLateDeductionForExcludedAttendance } from './voidExcludedAttendance';
import { calcLateMinutes, sqlTimeToHHmm } from '@/lib/timeUtils';
import { resolveEmployeeFinancialWorkSchedule } from './financialWorkSchedule';
import * as attendanceRepo from '@/modules/attendance/infra/AttendanceRepository';

/**
 * Bridge existing employee check-in writers to the late-deduction service.
 * Called AFTER attendance transaction commit, only for actual check-in edits
 * or status corrections that may need to void an existing debit.
 * Does nothing when the feature is off or on a non-working day (except void).
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
  if (!saved) return;

  const status = String(saved.Status ?? '');
  if (isLateDeductionExcludedAttendanceStatus(status)) {
    // Never charge absent/off/leave — and void any prior automatic debit.
    await voidLateDeductionForExcludedAttendance({
      empId,
      branchId,
      workDate,
      attendanceId,
      status,
    }).catch((err) => console.warn(
      '[legacy-late-deduction] excluded-status void failed:',
      err instanceof Error ? err.message : err,
    ));
    return;
  }

  if (!saved.CheckInTime) {
    // Check-in cleared — void any automatic debit left from an earlier punch.
    await voidLateDeductionForExcludedAttendance({
      empId,
      branchId,
      workDate,
      attendanceId,
      status: status || 'cleared_checkin',
    }).catch((err) => console.warn(
      '[legacy-late-deduction] cleared-checkin void failed:',
      err instanceof Error ? err.message : err,
    ));
    return;
  }

  const checkIn = sqlTimeToHHmm(saved.CheckInTime);
  if (!checkIn) return;
  const financial = await resolveEmployeeFinancialWorkSchedule({
    empId, branchId, workDate, db,
  });
  if (!financial?.isScheduledWorkingDay || !financial.scheduledStart) {
    await voidLateDeductionForExcludedAttendance({
      empId, branchId, workDate, attendanceId, status: 'financial_day_off',
    });
    return;
  }
  const scheduledStart = financial.scheduledStart;
  const scheduledEnd = financial.scheduledEnd;

  const lateMinutes = calcLateMinutes(checkIn, scheduledStart);
  // Legacy punch writers do not populate these payroll/attendance metadata columns.
  // Persist the exact dated schedule and lateness so recovery can reconcile it.
  await db.request()
    .input('attendanceId', sql.Int, attendanceId)
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('lateMinutes', sql.Int, lateMinutes)
    .query(
      'UPDATE dbo.TblEmpAttendance ' +
      'SET LateMinutes=@lateMinutes, UpdatedAt=SYSDATETIME() ' +
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
