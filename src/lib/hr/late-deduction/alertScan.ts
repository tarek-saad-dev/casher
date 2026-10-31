import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getCairoBusinessDate, getCairoTimeStr, SALON_TZ } from '@/lib/businessDate';
import { calcLateMinutes } from '@/lib/timeUtils';
import { resolveScheduleForDay } from '@/lib/hr/attendance-eligibility';
import { normalizeEmploymentType } from '@/lib/hr/employee-hr-model';
import {
  getLateDeductionConfig,
  isWorkDateEligibleForLateDeduction,
} from './config';
import { resolveLateDeductionDailyBasePay } from './dailyBasePay';
import { buildLateAlertMessage } from './messages';
import {
  findLateDeductionCase,
  markThresholdNotified,
  upsertLateDeductionCase,
} from './repository';
import {
  calculateLateDeductionAmount,
  thresholdsDueForLateMinutes,
  type LateAlertThreshold,
} from './rules';
import { ensureLateDeductionSchema } from './schema';
import { scheduleLateDeductionWhatsApp, sendLateDeductionWhatsApp } from './whatsapp';

const SCAN_LOCK_RESOURCE = 'late_deduction_alert_scan';

export interface LateAlertScanResult {
  skipped?: boolean;
  reason?: string;
  workDate?: string;
  candidates: number;
  notified: number;
  errors: number;
}

async function withScanLock<T>(
  fn: () => Promise<T>,
): Promise<T | { skipped: true; reason: string }> {
  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();
  try {
    const lock = await new sql.Request(transaction)
      .input('res', sql.NVarChar(128), SCAN_LOCK_RESOURCE)
      .query(`
        DECLARE @r INT;
        EXEC @r = sp_getapplock
          @Resource = @res,
          @LockMode = N'Exclusive',
          @LockOwner = N'Transaction',
          @LockTimeout = 0;
        SELECT @r AS LockResult;
      `);
    const lockResult = Number(lock.recordset[0]?.LockResult ?? -1);
    if (lockResult < 0) {
      await transaction.rollback();
      return { skipped: true, reason: 'lock_not_acquired' };
    }
    const result = await fn();
    await transaction.commit();
    return result;
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

function alreadyNotified(
  row: {
    notifiedAt1: string | null;
    notifiedAt61: string | null;
    notifiedAt121: string | null;
  } | null,
  threshold: LateAlertThreshold,
): boolean {
  if (!row) return false;
  if (threshold === 1) return !!row.notifiedAt1;
  if (threshold === 61) return !!row.notifiedAt61;
  return !!row.notifiedAt121;
}

/**
 * Scan scheduled employees who have not checked in and send progressive alerts.
 * Does NOT create financial deductions.
 */
export async function runLateDeductionAlertScan(params?: {
  businessDate?: string;
  branchId?: number;
  now?: Date;
  /** When true, send immediately (cron); otherwise schedule. */
  sendInline?: boolean;
}): Promise<LateAlertScanResult> {
  const locked = await withScanLock(async () => {
    const db = await getPool();
    const schemaOk = await ensureLateDeductionSchema(db);
    if (!schemaOk) {
      return {
        candidates: 0,
        notified: 0,
        errors: 0,
        reason: 'schema_unavailable',
      } satisfies LateAlertScanResult;
    }

    const config = await getLateDeductionConfig();
    const now = params?.now ?? new Date();
    const workDate = params?.businessDate ?? getCairoBusinessDate(now);
    if (!isWorkDateEligibleForLateDeduction(workDate, config)) {
      return {
        candidates: 0,
        notified: 0,
        errors: 0,
        workDate,
        reason: 'feature_disabled_or_before_activation',
      } satisfies LateAlertScanResult;
    }

    const nowHhmm = getCairoTimeStr(now).slice(0, 5);
    const dayOfWeek = (() => {
      // Sunday=0 … Saturday=6 in Cairo
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: SALON_TZ,
        weekday: 'short',
      }).formatToParts(now);
      const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
      const map: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      return map[wd] ?? 0;
    })();

    const req = db
      .request()
      .input('workDate', sql.Date, workDate)
      .input('dow', sql.Int, dayOfWeek)
      .input('branchId', sql.Int, params?.branchId ?? null);

    const employees = await req.query(`
      SELECT
        e.EmpID,
        e.EmpName,
        e.EmploymentType,
        CONVERT(VARCHAR(5), e.DefaultCheckInTime, 108) AS DefaultCheckInTime,
        CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
        CASE
          WHEN COL_LENGTH(N'dbo.TblEmp', N'LateDeductionExempt') IS NULL THEN CAST(0 AS bit)
          ELSE ISNULL(e.LateDeductionExempt, 0)
        END AS LateDeductionExempt,
        a.BranchID AS HomeBranchID,
        s.BranchID AS ScheduleBranchID,
        s.IsWorking AS IsWorkingDay,
        CONVERT(VARCHAR(5), s.StartTime, 108) AS ScheduleStartTime,
        CONVERT(VARCHAR(5), s.EndTime, 108) AS ScheduleEndTime,
        att.AttendanceID,
        CONVERT(VARCHAR(8), att.CheckInTime, 108) AS CheckInTime,
        att.Status AS AttendanceStatus
      FROM dbo.TblEmp e
      OUTER APPLY (
        SELECT TOP 1 ea.BranchID
        FROM dbo.TblEmpBranchAssignment ea
        WHERE ea.EmpID = e.EmpID
          AND ea.IsActive = 1
          AND ISNULL(ea.IsHomeBranch, 0) = 1
          AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @workDate)
        ORDER BY ea.BranchID
      ) a
      OUTER APPLY (
        SELECT TOP 1
          bs.BranchID, bs.IsWorking, bs.StartTime, bs.EndTime
        FROM dbo.TblEmpBranchWorkSchedule bs
        WHERE bs.EmpID = e.EmpID
          AND bs.DayOfWeek = @dow
          AND bs.IsActive = 1
          AND bs.EffectiveFrom <= @workDate
          AND (bs.EffectiveTo IS NULL OR bs.EffectiveTo >= @workDate)
          AND (@branchId IS NULL OR bs.BranchID = @branchId)
        ORDER BY
          CASE WHEN a.BranchID IS NOT NULL AND bs.BranchID = a.BranchID THEN 0 ELSE 1 END,
          bs.EffectiveFrom DESC
      ) s
      OUTER APPLY (
        SELECT TOP 1
          x.ID AS AttendanceID, x.CheckInTime, x.Status, x.BranchID
        FROM dbo.TblEmpAttendance x
        WHERE x.EmpID = e.EmpID
          AND x.WorkDate = @workDate
          AND (@branchId IS NULL OR x.BranchID = @branchId)
        ORDER BY x.ID DESC
      ) att
      WHERE ISNULL(e.isActive, 1) = 1
        AND (
          @branchId IS NULL
          OR s.BranchID = @branchId
          OR a.BranchID = @branchId
          OR att.BranchID = @branchId
        )
    `);

    let candidates = 0;
    let notified = 0;
    let errors = 0;

    for (const row of employees.recordset as Array<Record<string, unknown>>) {
      try {
        const empId = Number(row.EmpID);
        const employmentType = normalizeEmploymentType(String(row.EmploymentType ?? '')) ?? 'full_time';
        const schedule = resolveScheduleForDay(employmentType, {
          hasScheduleRow: row.ScheduleStartTime != null || row.IsWorkingDay != null,
          isWorkingDayFromSchedule:
            row.IsWorkingDay == null ? null : Boolean(row.IsWorkingDay),
          scheduleStart: (row.ScheduleStartTime as string) || null,
          scheduleEnd: (row.ScheduleEndTime as string) || null,
          defaultStart: (row.DefaultCheckInTime as string) || null,
          defaultEnd: (row.DefaultCheckOutTime as string) || null,
        });

        if (!schedule.isScheduledWorkingDay || !schedule.scheduledStart) continue;

        const status = String(row.AttendanceStatus ?? '');
        if (['DayOff', 'Absent', 'Excused', 'Leave', 'Holiday', 'إجازة', 'غائب'].includes(status)) {
          continue;
        }

        if (row.CheckInTime) continue; // stop alerts after check-in

        const branchId =
          Number(row.ScheduleBranchID) ||
          Number(row.HomeBranchID) ||
          (params?.branchId ?? 0);
        if (!(branchId > 0)) continue;

        const lateMinutes = calcLateMinutes(nowHhmm, schedule.scheduledStart);
        if (lateMinutes < 1) continue;

        candidates += 1;
        const exempt = Boolean(row.LateDeductionExempt);
        const due = thresholdsDueForLateMinutes(lateMinutes);
        if (!due.length) continue;

        let caseRow = await findLateDeductionCase(db, empId, branchId, workDate);
        if (!caseRow) {
          caseRow = await upsertLateDeductionCase(db, {
            empId,
            branchId,
            workDate,
            attendanceId: row.AttendanceID == null ? null : Number(row.AttendanceID),
            scheduledStart: schedule.scheduledStart,
            scheduledEnd: schedule.scheduledEnd,
            lateMinutes,
            deductionKind: exempt ? 'exempt' : 'none',
            status: 'alerting',
            dailyBasePay: null,
            amount: null,
          });
        } else if (caseRow.status === 'cancelled' || caseRow.doNotAutoRecreate) {
          continue;
        } else if (['applied', 'manager_applied', 'pending_manager', 'exempt'].includes(caseRow.status)) {
          // Already finalized somehow — do not keep alerting
          continue;
        } else {
          caseRow = await upsertLateDeductionCase(db, {
            empId,
            branchId,
            workDate,
            lateMinutes,
            deductionKind: exempt ? 'exempt' : caseRow.deductionKind,
            status: 'alerting',
            scheduledStart: schedule.scheduledStart,
            scheduledEnd: schedule.scheduledEnd,
            dailyBasePay: caseRow.dailyBasePay,
            amount: caseRow.amount,
            attendanceId: caseRow.attendanceId,
            ledgerEntryId: caseRow.ledgerEntryId,
          });
        }

        const pay = exempt
          ? null
          : await resolveLateDeductionDailyBasePay({
              empId,
              branchId,
              workDate,
              scheduledStart: schedule.scheduledStart,
              scheduledEnd: schedule.scheduledEnd,
            });

        const quarter =
          pay?.dailyBasePay != null
            ? calculateLateDeductionAmount({ lateMinutes: 1, dailyBasePay: pay.dailyBasePay }).amount
            : null;
        const half =
          pay?.dailyBasePay != null
            ? calculateLateDeductionAmount({ lateMinutes: 61, dailyBasePay: pay.dailyBasePay }).amount
            : null;

        for (const threshold of due) {
          if (alreadyNotified(caseRow, threshold)) continue;

          // Claim notification slot first (idempotent under restart) then send.
          const claimed = await markThresholdNotified(db, caseRow.caseId, threshold);
          if (!claimed) continue;

          const text = buildLateAlertMessage({
            threshold,
            scheduledStart: schedule.scheduledStart,
            lateMinutes: threshold,
            quarterAmount: quarter,
            halfAmount: half,
            exempt,
          });

          if (params?.sendInline) {
            const sendResult = await sendLateDeductionWhatsApp({
              empId,
              branchId,
              text,
              metadata: {
                lateCaseId: caseRow.caseId,
                event: `alert_${threshold}`,
                workDate,
              },
            });
            if (sendResult.sent || sendResult.skipped) {
              notified += 1;
            } else {
              errors += 1;
            }
          } else {
            scheduleLateDeductionWhatsApp({
              empId,
              branchId,
              text,
              metadata: {
                lateCaseId: caseRow.caseId,
                event: `alert_${threshold}`,
                workDate,
              },
            });
            notified += 1;
          }
        }
      } catch (err) {
        errors += 1;
        console.warn('[late-deduction-alertScan] row error:', err);
      }
    }

    return {
      candidates,
      notified,
      errors,
      workDate,
    } satisfies LateAlertScanResult;
  });

  if (locked && typeof locked === 'object' && 'skipped' in locked && locked.skipped) {
    return {
      skipped: true,
      reason: locked.reason,
      candidates: 0,
      notified: 0,
      errors: 0,
    };
  }

  return locked as LateAlertScanResult;
}
