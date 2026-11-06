import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { sqlTimeToHHmm } from '@/lib/timeUtils';
import {
  getLateDeductionConfig,
  isWorkDateEligibleForLateDeduction,
} from './config';
import { finalizeLateDeductionOnCheckIn } from './finalizeOnCheckIn';
import { isLateDeductionSchemaReady } from './schema';
import { voidLateDeductionForExcludedAttendance } from './voidExcludedAttendance';

export interface RecoverLateDeductionResult {
  scanned: number;
  recovered: number;
  errors: number;
  workDate: string;
  reason?: string;
}

/**
 * Recover check-ins that were saved but never finalized (crash / worker restart).
 * Sources:
 *  - cases with Status = finalize_pending
 *  - attendance rows with LateMinutes > 0 and no non-cancelled case yet
 *  - attendance corrected to absent/off with a still-active automatic debit
 */
export async function recoverPendingLateDeductionFinalizations(params?: {
  businessDate?: string;
  branchId?: number;
  limit?: number;
  suppressWhatsApp?: boolean;
}): Promise<RecoverLateDeductionResult> {
  const db = await getPool();
  const workDate = params?.businessDate ?? getCairoBusinessDate();
  const empty: RecoverLateDeductionResult = {
    scanned: 0,
    recovered: 0,
    errors: 0,
    workDate,
  };

  if (!(await isLateDeductionSchemaReady(db))) {
    return { ...empty, reason: 'schema_unavailable' };
  }

  const config = await getLateDeductionConfig(params?.branchId ?? 0);
  if (!isWorkDateEligibleForLateDeduction(workDate, config)) {
    return { ...empty, reason: 'feature_disabled_or_before_activation' };
  }

  const limit = Math.min(Math.max(params?.limit ?? 100, 1), 500);
  let recovered = 0;
  let errors = 0;
  let scanned = 0;

  // Pass 1: void automatic debits when attendance was corrected to excluded status.
  const excluded = await db
    .request()
    .input('workDate', sql.Date, workDate)
    .input('branchId', sql.Int, params?.branchId ?? null)
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        a.ID AS AttendanceID,
        a.EmpID,
        a.BranchID,
        CONVERT(VARCHAR(10), a.WorkDate, 23) AS WorkDate,
        a.Status
      FROM dbo.TblEmpAttendance a
      INNER JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
      INNER JOIN dbo.TblEmpLateDeductionCase c
        ON c.EmpID = a.EmpID
       AND c.BranchID = a.BranchID
       AND c.WorkDate = a.WorkDate
      WHERE a.WorkDate = @workDate
        AND @branchId IS NOT NULL AND a.BranchID = @branchId
        AND e.TenantId IN (SELECT l.TenantId FROM dbo.Location l
          WHERE l.LegacyBranchId = @branchId AND l.Status = N'active')
        AND REPLACE(REPLACE(LOWER(LTRIM(RTRIM(ISNULL(a.Status, N'')))), N' ', N''), N'_', N'')
            IN (N'absent', N'off', N'dayoff', N'excused', N'leave', N'holiday', N'vacation')
        AND ISNULL(c.DoNotAutoRecreate, 0) = 0
        AND c.Status IN (N'applied', N'finalize_pending', N'alerting', N'pending_manager')
      ORDER BY a.ID ASC
    `);

  const excludedRows = excluded.recordset as Array<Record<string, unknown>>;
  scanned += excludedRows.length;
  for (const row of excludedRows) {
    try {
      const result = await voidLateDeductionForExcludedAttendance({
        empId: Number(row.EmpID),
        branchId: Number(row.BranchID),
        workDate: String(row.WorkDate).slice(0, 10),
        attendanceId: Number(row.AttendanceID),
        status: String(row.Status ?? ''),
      });
      if (result.handled) recovered += 1;
    } catch (err) {
      errors += 1;
      console.warn('[late-deduction-recover] excluded void failed:', err);
    }
  }

  const req = db
    .request()
    .input('workDate', sql.Date, workDate)
    .input('branchId', sql.Int, params?.branchId ?? null)
    .input('limit', sql.Int, limit);

  const pending = await req.query(`
    SELECT TOP (@limit)
      a.ID AS AttendanceID,
      a.EmpID,
      a.BranchID,
      CONVERT(VARCHAR(10), a.WorkDate, 23) AS WorkDate,
      CONVERT(VARCHAR(8), a.CheckInTime, 108) AS CheckInTime,
      CONVERT(VARCHAR(5), a.ScheduledStartTime, 108) AS ScheduledStartTime,
      CONVERT(VARCHAR(5), a.ScheduledEndTime, 108) AS ScheduledEndTime,
      ISNULL(a.LateMinutes, 0) AS LateMinutes,
      e.EmpName,
      c.CaseID,
      c.Status AS CaseStatus
    FROM dbo.TblEmpAttendance a
    INNER JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    LEFT JOIN dbo.TblEmpLateDeductionCase c
      ON c.EmpID = a.EmpID
     AND c.BranchID = a.BranchID
     AND c.WorkDate = a.WorkDate
    WHERE a.WorkDate = @workDate
      AND a.CheckInTime IS NOT NULL
      AND @branchId IS NOT NULL AND a.BranchID = @branchId
      AND e.TenantId IN (SELECT l.TenantId FROM dbo.Location l
        WHERE l.LegacyBranchId = @branchId AND l.Status = N'active')
      -- Never recreate deductions for absent / day-off / leave (any casing).
      AND REPLACE(REPLACE(LOWER(LTRIM(RTRIM(ISNULL(a.Status, N'')))), N' ', N''), N'_', N'')
          NOT IN (N'absent', N'off', N'dayoff', N'excused', N'leave', N'holiday', N'vacation')
      AND (
        (c.CaseID IS NULL AND ISNULL(a.LateMinutes, 0) > 0)
        OR c.Status IN (N'finalize_pending', N'alerting')
        OR (c.Status = N'applied' AND c.LateMinutes <> ISNULL(a.LateMinutes, 0))
      )
      AND ISNULL(c.DoNotAutoRecreate, 0) = 0
      AND (c.Status IS NULL OR c.Status NOT IN (
        N'cancelled', N'manager_applied', N'pending_manager', N'exempt', N'skipped'
      ))
    ORDER BY a.ID ASC
  `);

  const rows = pending.recordset as Array<Record<string, unknown>>;
  scanned += rows.length;

  for (const row of rows) {
    try {
      const checkIn = sqlTimeToHHmm(row.CheckInTime) ?? String(row.CheckInTime ?? '').slice(0, 5);
      const scheduledStart =
        sqlTimeToHHmm(row.ScheduledStartTime) ??
        (row.ScheduledStartTime == null ? null : String(row.ScheduledStartTime).slice(0, 5));
      const scheduledEnd =
        sqlTimeToHHmm(row.ScheduledEndTime) ??
        (row.ScheduledEndTime == null ? null : String(row.ScheduledEndTime).slice(0, 5));

      if (!checkIn || !scheduledStart) continue;

      const result = await finalizeLateDeductionOnCheckIn({
        empId: Number(row.EmpID),
        empName: String(row.EmpName ?? ''),
        branchId: Number(row.BranchID),
        workDate: String(row.WorkDate).slice(0, 10),
        attendanceId: Number(row.AttendanceID),
        checkInTime: checkIn,
        scheduledStart,
        scheduledEnd,
        suppressWhatsApp: params?.suppressWhatsApp === true,
      });
      if (result.handled) recovered += 1;
    } catch (err) {
      errors += 1;
      console.warn('[late-deduction-recover] row failed:', err);
    }
  }

  return {
    scanned,
    recovered,
    errors,
    workDate,
  };
}
