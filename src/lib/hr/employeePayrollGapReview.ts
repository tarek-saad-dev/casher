import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import { saveAdminAttendance, persistNightlyDefaultFillAttendance } from '@/modules/attendance';
import { unlockScheduleForWorkOnDayOff } from '@/lib/hr/attendance/workOnDayOff.service';
import { runDailyPayrollGenerateWithOptionalLedger, syncHourlyWageLedgerForEmployees } from '@/lib/services/employeeLedgerDualWrite';
import { countPostedDailyPayroll } from '@/lib/payroll/dailyPayrollGenerateCore';
import { loadWorkingWindowsBatch } from '@/lib/availability/loadWorkingWindowsBatch';
import {
  applyDefaultTimesToRow,
  shouldDeferOvernightDefaultCheckoutFill,
} from '@/lib/hr/attendance-default-fill';
import {
  getEmpBranchWorkDayCloseState,
  reopenEmpBranchWorkDay,
  persistEmpBranchWorkDayClosed,
} from '@/lib/hr/empBranchWorkDayClose.service';
import type {
  PayrollGapApplyDayResult,
  PayrollGapApplyOptions,
  PayrollGapApplyResponse,
  PayrollGapAssignAttendanceResponse,
  PayrollGapDayRow,
  PayrollGapGenerateDayResponse,
  PayrollGapReviewResponse,
  PayrollGapReviewSummary,
} from '@/lib/types/payroll-gap-review';

import {
  buildEmployeeScheduleOffContext,
  formatEmployeeOffDaysLabel,
  isEmployeeScheduledOffDay,
} from '@/lib/hr/employeePayrollGapSchedule';
import {
  arabicDayName,
  classifyDay,
  eachDateInclusive,
} from '@/lib/hr/employeePayrollGapReview.classify';

const NON_PAYABLE_STATUSES = new Set(['DayOff', 'Absent', 'Excused', 'إجازة', 'غائب']);

type RawDayRow = {
  workDate: string;
  attendanceStatus: string | null;
  checkIn: string | null;
  checkOut: string | null;
  payrollStatus: string | null;
  dailyWage: number | null;
  actualHours: number | null;
  dayCloseState: string | null;
  attendanceId: number | null;
};

async function loadMonthRows(
  empId: number,
  branchId: number,
  startDate: string,
  endDate: string,
): Promise<RawDayRow[]> {
  const db = await getPool();
  const result = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('startDate', sql.Date, startDate)
    .input('endDate', sql.Date, endDate)
    .query(`
      WITH MonthDays AS (
        SELECT CAST(@startDate AS date) AS WorkDate
        UNION ALL
        SELECT DATEADD(DAY, 1, WorkDate)
        FROM MonthDays
        WHERE WorkDate < @endDate
      )
      SELECT
        CONVERT(varchar(10), d.WorkDate, 23) AS workDate,
        a.ID AS attendanceId,
        a.Status AS attendanceStatus,
        CONVERT(varchar(5), a.CheckInTime, 108) AS checkIn,
        CONVERT(varchar(5), a.CheckOutTime, 108) AS checkOut,
        p.Status AS payrollStatus,
        p.DailyWage AS dailyWage,
        p.ActualHours AS actualHours,
        c.State AS dayCloseState
      FROM MonthDays d
      LEFT JOIN dbo.TblEmpAttendance a
        ON a.EmpID = @empId AND a.BranchID = @branchId AND a.WorkDate = d.WorkDate
      LEFT JOIN dbo.TblEmpDailyPayroll p
        ON p.EmpID = @empId AND p.BranchID = @branchId AND p.WorkDate = d.WorkDate
      LEFT JOIN dbo.TblEmpBranchWorkDayClose c
        ON c.BranchID = @branchId AND c.WorkDate = d.WorkDate
      ORDER BY d.WorkDate
      OPTION (MAXRECURSION 366)
    `);

  return (result.recordset as Array<Record<string, unknown>>).map((row) => ({
    workDate: String(row.workDate),
    attendanceId: row.attendanceId != null ? Number(row.attendanceId) : null,
    attendanceStatus: row.attendanceStatus != null ? String(row.attendanceStatus) : null,
    checkIn: row.checkIn != null ? String(row.checkIn) : null,
    checkOut: row.checkOut != null ? String(row.checkOut) : null,
    payrollStatus: row.payrollStatus != null ? String(row.payrollStatus) : null,
    dailyWage: row.dailyWage != null ? roundMoney(Number(row.dailyWage)) : null,
    actualHours: row.actualHours != null ? roundMoney(Number(row.actualHours)) : null,
    dayCloseState: row.dayCloseState != null ? String(row.dayCloseState) : null,
  }));
}

function buildSummary(days: PayrollGapDayRow[]): PayrollGapReviewSummary {
  return {
    totalDays: days.length,
    payrollDays: days.filter((d) => d.hasPayroll).length,
    attendanceDays: days.filter((d) => d.hasAttendance).length,
    missingPayroll: days.filter(
      (d) =>
        d.category === 'attendance_no_payroll' ||
        d.category === 'missing_payroll' ||
        d.category === 'incomplete_attendance',
    ).length,
    incompleteAttendance: days.filter((d) => d.category === 'incomplete_attendance').length,
    scheduledOffDays: days.filter((d) => d.category === 'schedule_off').length,
    scheduledOffWithPayroll: days.filter((d) => d.category === 'schedule_off_with_payroll').length,
    futureDays: days.filter((d) => d.category === 'future').length,
    actionableDays: days.filter((d) => d.actionable).length,
  };
}

function mapToDayRows(
  raw: RawDayRow[],
  reviewThroughDate: string,
  offByDate: Map<string, boolean>,
): PayrollGapDayRow[] {
  return raw.map((row) => {
    const hasAttendance = row.attendanceId != null;
    const hasPayroll = row.payrollStatus != null;
    const isScheduledOff = isEmployeeScheduledOffDay(row.workDate, offByDate);
    const classified = classifyDay({
      workDate: row.workDate,
      reviewThroughDate,
      isScheduledOff,
      hasAttendance,
      attendanceStatus: row.attendanceStatus,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      hasPayroll,
      payrollStatus: row.payrollStatus,
    });
    return {
      workDate: row.workDate,
      dayOfWeek: new Date(`${row.workDate}T12:00:00`).getDay(),
      dayNameAr: arabicDayName(row.workDate),
      isScheduledOff,
      hasAttendance,
      attendanceStatus: row.attendanceStatus,
      checkIn: row.checkIn,
      checkOut: row.checkOut,
      hasPayroll,
      payrollStatus: row.payrollStatus,
      dailyWage: row.dailyWage,
      actualHours: row.actualHours,
      dayCloseState: row.dayCloseState,
      ...classified,
    };
  });
}

async function loadEmployeeBranchMeta(empId: number, branchId: number) {
  const db = await getPool();
  const result = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT e.EmpID, e.EmpName, b.BranchID, b.BranchCode, b.BranchName
      FROM dbo.TblEmp e
      CROSS JOIN dbo.TblBranch b
      WHERE e.EmpID = @empId AND b.BranchID = @branchId
    `);
  const row = result.recordset[0] as
    | { EmpID: number; EmpName: string; BranchID: number; BranchCode: string; BranchName: string }
    | undefined;
  if (!row) throw new Error('الموظف أو الفرع غير موجود');
  return {
    empId: row.EmpID,
    empName: row.EmpName,
    branchId: row.BranchID,
    branchCode: row.BranchCode,
    branchName: row.BranchName,
  };
}

export async function analyzeEmployeePayrollGaps(params: {
  empId: number;
  branchId: number;
  year: number;
  month: number;
  reviewThroughDate?: string;
}): Promise<PayrollGapReviewResponse> {
  const period = getMonthDateRange(params.year, params.month);
  const reviewThroughDate = params.reviewThroughDate ?? getCairoBusinessDate();
  const meta = await loadEmployeeBranchMeta(params.empId, params.branchId);
  const schedule = await buildEmployeeScheduleOffContext({
    empId: params.empId,
    branchId: params.branchId,
    startDate: period.startDate,
    endDate: period.endDate,
  });
  const raw = await loadMonthRows(params.empId, params.branchId, period.startDate, period.endDate);
  const days = mapToDayRows(raw, reviewThroughDate, schedule.offByDate);

  return {
    ...meta,
    year: params.year,
    month: params.month,
    periodStart: period.startDate,
    periodEnd: period.endDate,
    reviewThroughDate,
    employeeOffDaysOfWeek: schedule.offDaysOfWeek,
    employeeOffDayLabelsAr: schedule.offDayLabelsAr,
    employeeOffDaysLabel: formatEmployeeOffDaysLabel(schedule.offDayLabelsAr),
    summary: buildSummary(days),
    days,
  };
}

async function removeScheduledOffPayroll(
  db: Awaited<ReturnType<typeof getPool>>,
  payrollId: number,
): Promise<void> {
  await db
    .request()
    .input('payrollId', sql.Int, payrollId)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET IsVoided = 1,
          VoidReason = N'يوم إجازة من الجدول — حذف يومية',
          UpdatedAt = SYSDATETIME()
      WHERE RefType = N'TblEmpDailyPayroll'
        AND RefID = @payrollId
        AND EntryReason = N'hourly_wage'
        AND IsVoided = 0
    `);
  await db
    .request()
    .input('payrollId', sql.Int, payrollId)
    .query(`DELETE FROM dbo.TblEmpDailyPayroll WHERE ID = @payrollId`);
}

type GapDayProcessSummary = {
  scheduledOffMarked: number;
  scheduledOffPayrollRemoved: number;
  attendanceCompleted: number;
  payrollGenerated: number;
  payrollSkippedExisting: number;
  payrollSkippedPosted: number;
  daysReopened: number;
  daysReclosed: number;
  failures: string[];
};

type GapDayProcessContext = {
  empId: number;
  branchId: number;
  actorUserId: number;
  opts: Required<PayrollGapApplyOptions>;
  schedule: Awaited<ReturnType<typeof buildEmployeeScheduleOffContext>>;
  db: Awaited<ReturnType<typeof getPool>>;
  notesBase: string;
  reopenReason: string;
  mode: 'bulk' | 'single_day';
};

async function processPayrollGapDay(
  workDate: string,
  ctx: GapDayProcessContext,
): Promise<{ dayResults: PayrollGapApplyDayResult[]; partial: Partial<GapDayProcessSummary> }> {
  const { empId, branchId, actorUserId, opts, schedule, db, notesBase, reopenReason, mode } = ctx;
  const dayResults: PayrollGapApplyDayResult[] = [];
  const partial: Partial<GapDayProcessSummary> = {};
  let wasClosed = false;

  try {
    if (opts.reopenClosedDays) {
      const closeView = await getEmpBranchWorkDayCloseState(branchId, workDate);
      wasClosed = closeView.state === 'CLOSED';
      if (wasClosed) {
        await reopenEmpBranchWorkDay({
          branchId,
          workDate,
          actorUserId,
          reopenReason,
        });
        partial.daysReopened = 1;
      }
    }

    const scheduledOff = isEmployeeScheduledOffDay(workDate, schedule.offByDate);

    const attRes = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .input('workDate', sql.Date, workDate)
      .query(`
        SELECT TOP 1 ID, Status,
          CONVERT(VARCHAR(5), CheckInTime, 108) AS CheckInTime,
          CONVERT(VARCHAR(5), CheckOutTime, 108) AS CheckOutTime
        FROM dbo.TblEmpAttendance
        WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
      `);
    const existing = attRes.recordset[0] as
      | {
          ID: number;
          Status: string | null;
          CheckInTime: string | null;
          CheckOutTime: string | null;
        }
      | undefined;

    const status = existing?.Status ?? '';
    const workedOnScheduledOff =
      existing &&
      !NON_PAYABLE_STATUSES.has(status) &&
      (existing.CheckInTime != null ||
        status === 'Present' ||
        status === 'Late' ||
        status === 'EarlyLeave');

    if (
      mode === 'bulk' &&
      scheduledOff &&
      opts.markScheduledOffAsDayOff &&
      !workedOnScheduledOff
    ) {
      const dayLabel = arabicDayName(workDate);
      await saveAdminAttendance({
        branchId,
        empId,
        workDate,
        status: 'DayOff',
        notes: `${notesBase} — إجازة ${dayLabel}`,
      });
      partial.scheduledOffMarked = 1;
      dayResults.push({
        workDate,
        action: 'schedule_off_day',
        success: true,
        message: `تم تسجيل إجازة ${dayLabel}`,
      });

      if (opts.removeScheduledOffPayroll) {
        const payRes = await db
          .request()
          .input('empId', sql.Int, empId)
          .input('branchId', sql.Int, branchId)
          .input('workDate', sql.Date, workDate)
          .query(`
            SELECT TOP 1 ID, Status FROM dbo.TblEmpDailyPayroll
            WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
          `);
        const payRow = payRes.recordset[0] as { ID: number; Status: string } | undefined;
        if (payRow && payRow.Status !== 'PostedToCashMove') {
          await removeScheduledOffPayroll(db, payRow.ID);
          partial.scheduledOffPayrollRemoved = 1;
          dayResults.push({
            workDate,
            action: 'remove_schedule_off_payroll',
            success: true,
            message: `تم حذف يومية ${dayLabel}`,
          });
        }
      }
      return { dayResults, partial };
    }

    const payRes = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .input('workDate', sql.Date, workDate)
      .query(`
        SELECT TOP 1 ID, Status FROM dbo.TblEmpDailyPayroll
        WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
      `);
    const payRow = payRes.recordset[0] as { ID: number; Status: string } | undefined;
    const hasPayroll = payRow != null;

    if (hasPayroll) {
      partial.payrollSkippedExisting = 1;
      if (mode === 'single_day') {
        dayResults.push({
          workDate,
          action: 'skip_existing',
          success: false,
          message: payRow.Status === 'PostedToCashMove' ? 'يومية مرحّلة للخزنة' : 'اليومية موجودة مسبقاً',
        });
      }
      return { dayResults, partial };
    }

    if (!existing) {
      if (mode === 'single_day') {
        dayResults.push({
          workDate,
          action: 'no_attendance',
          success: false,
          message: 'لا يوجد حضور — سجّل الحضور أولاً',
        });
      }
      return { dayResults, partial };
    }

    if (NON_PAYABLE_STATUSES.has(status)) {
      if (mode === 'single_day') {
        dayResults.push({
          workDate,
          action: 'non_payable',
          success: false,
          message: 'يوم إجازة/غياب — لا تُولَّد يومية',
        });
      }
      return { dayResults, partial };
    }

    const needsCheckout =
      opts.completeIncompleteAttendance && existing.CheckInTime && !existing.CheckOutTime;

    if (needsCheckout) {
      if (scheduledOff && workedOnScheduledOff) {
        await unlockScheduleForWorkOnDayOff({
          empId,
          date: workDate,
          branchId,
          reason: 'إكمال حضور — مراجعة يوميات',
          sourceTag: 'payroll-gap-review',
        });
      }
      await persistNightlyDefaultFillAttendance({
        db,
        mode: 'update',
        attendanceId: existing.ID,
        branchId,
        checkInTime: existing.CheckInTime!,
        checkOutTime: opts.defaultCheckoutTime,
        status: status === 'Late' ? 'Late' : 'Present',
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        notes: `${notesBase} — إكمال خروج`,
        scheduledStart: existing.CheckInTime!,
        scheduledEnd: opts.defaultCheckoutTime,
      });
      partial.attendanceCompleted = 1;
      dayResults.push({
        workDate,
        action: 'complete_attendance',
        success: true,
        message: `تم إكمال الخروج ${opts.defaultCheckoutTime}`,
      });
    } else if (mode === 'single_day' && existing.CheckInTime && !existing.CheckOutTime) {
      dayResults.push({
        workDate,
        action: 'incomplete_attendance',
        success: false,
        message: 'وقت الدخول موجود بدون خروج — أضف وقت خروج',
      });
      return { dayResults, partial };
    }

    if (!opts.generateMissingPayroll) {
      return { dayResults, partial };
    }

    const posted = await countPostedDailyPayroll(db, workDate, branchId, [empId]);
    if (posted > 0) {
      partial.payrollSkippedPosted = 1;
      dayResults.push({
        workDate,
        action: 'skip_posted',
        success: false,
        message: 'يومية مرحّلة للخزنة',
      });
      return { dayResults, partial };
    }

    if (scheduledOff && workedOnScheduledOff) {
      await unlockScheduleForWorkOnDayOff({
        empId,
        date: workDate,
        branchId,
        reason: 'توليد يومية — مراجعة يوميات',
        sourceTag: 'payroll-gap-review-payroll',
      });
    }

    const { result } = await runDailyPayrollGenerateWithOptionalLedger(workDate, {
      notesPrefix: opts.notesPrefix,
      branchId,
      empIds: [empId],
    });

    if (result.generatedCount > 0) {
      const ledgerSync = await syncHourlyWageLedgerForEmployees(db, workDate, branchId, [empId]);
      const ledgerTouched =
        ledgerSync.inserted + ledgerSync.updated + ledgerSync.voided;
      if (ledgerTouched === 0) {
        partial.failures = [
          ...(partial.failures ?? []),
          `${workDate}: لم تُسجَّل قيود دفتر الموظفين — راجع جدول الدفتر`,
        ];
      }
      partial.payrollGenerated = 1;
      const ledgerNote =
        ledgerSync.inserted > 0
          ? ` · دفتر +${ledgerSync.inserted}`
          : ledgerSync.updated > 0
            ? ' · دفتر محدّث'
            : '';
      dayResults.push({
        workDate,
        action: 'generate_payroll',
        success: true,
        message: `توليد: ${result.totalHours} س · ${result.totalWage} ج.م${ledgerNote}`,
      });
    } else if (mode === 'single_day') {
      dayResults.push({
        workDate,
        action: 'generate_payroll',
        success: false,
        message: 'لم يتم توليد يومية — راجع الحضور والجدول',
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    partial.failures = [`${workDate}: ${msg}`];
    dayResults.push({ workDate, action: 'error', success: false, message: msg });
  } finally {
    if (wasClosed && opts.reopenClosedDays) {
      try {
        await persistEmpBranchWorkDayClosed({
          branchId,
          workDate,
          actorUserId,
        });
        partial.daysReclosed = 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        partial.failures = [...(partial.failures ?? []), `${workDate} reclose: ${msg}`];
      }
    }
  }

  return { dayResults, partial };
}

function mergePartialSummary(
  summary: GapDayProcessSummary,
  partial: Partial<GapDayProcessSummary>,
): void {
  if (partial.scheduledOffMarked) summary.scheduledOffMarked += partial.scheduledOffMarked;
  if (partial.scheduledOffPayrollRemoved) {
    summary.scheduledOffPayrollRemoved += partial.scheduledOffPayrollRemoved;
  }
  if (partial.attendanceCompleted) summary.attendanceCompleted += partial.attendanceCompleted;
  if (partial.payrollGenerated) summary.payrollGenerated += partial.payrollGenerated;
  if (partial.payrollSkippedExisting) summary.payrollSkippedExisting += partial.payrollSkippedExisting;
  if (partial.payrollSkippedPosted) summary.payrollSkippedPosted += partial.payrollSkippedPosted;
  if (partial.daysReopened) summary.daysReopened += partial.daysReopened;
  if (partial.daysReclosed) summary.daysReclosed += partial.daysReclosed;
  if (partial.failures?.length) summary.failures.push(...partial.failures);
}

function buildGapApplyOptions(options?: PayrollGapApplyOptions): Required<PayrollGapApplyOptions> {
  return {
    markScheduledOffAsDayOff: options?.markScheduledOffAsDayOff !== false,
    removeScheduledOffPayroll: options?.removeScheduledOffPayroll !== false,
    completeIncompleteAttendance: options?.completeIncompleteAttendance !== false,
    generateMissingPayroll: options?.generateMissingPayroll !== false,
    skipFutureDays: options?.skipFutureDays !== false,
    reopenClosedDays: options?.reopenClosedDays !== false,
    defaultCheckoutTime: options?.defaultCheckoutTime ?? '02:00',
    notesPrefix: options?.notesPrefix ?? '[GapReview] ',
  };
}

export async function applyEmployeePayrollGapDay(params: {
  empId: number;
  branchId: number;
  year: number;
  month: number;
  workDate: string;
  actorUserId: number;
  options?: PayrollGapApplyOptions;
}): Promise<PayrollGapGenerateDayResponse> {
  const opts = buildGapApplyOptions({
    ...params.options,
    markScheduledOffAsDayOff: false,
    removeScheduledOffPayroll: false,
    generateMissingPayroll: true,
    completeIncompleteAttendance: true,
    skipFutureDays: true,
    reopenClosedDays: true,
    notesPrefix: params.options?.notesPrefix ?? '[GapReview] ',
  });

  const reviewThroughDate = getCairoBusinessDate();
  if (opts.skipFutureDays && params.workDate > reviewThroughDate) {
    throw new Error('لا يمكن توليد يومية ليوم مستقبلي');
  }

  const period = getMonthDateRange(params.year, params.month);
  if (params.workDate < period.startDate || params.workDate > period.endDate) {
    throw new Error('التاريخ خارج نطاق الشهر المحدد');
  }

  const schedule = await buildEmployeeScheduleOffContext({
    empId: params.empId,
    branchId: params.branchId,
    startDate: period.startDate,
    endDate: period.endDate,
  });
  const db = await getPool();
  const notesBase = `${opts.notesPrefix.trim()} مراجعة يوميات`;
  const reopenReason = 'توليد يومية يوم واحد — مراجعة يوميات';

  const { dayResults } = await processPayrollGapDay(params.workDate, {
    empId: params.empId,
    branchId: params.branchId,
    actorUserId: params.actorUserId,
    opts,
    schedule,
    db,
    notesBase,
    reopenReason,
    mode: 'single_day',
  });

  const review = await analyzeEmployeePayrollGaps({
    empId: params.empId,
    branchId: params.branchId,
    year: params.year,
    month: params.month,
    reviewThroughDate,
  });

  const payrollGenerated = dayResults.some(
    (r) => r.action === 'generate_payroll' && r.success,
  );
  const attendanceCompleted = dayResults.some(
    (r) => r.action === 'complete_attendance' && r.success,
  );
  const lastResult = dayResults[dayResults.length - 1];
  const success = payrollGenerated;
  let message = lastResult?.message ?? 'تم التنفيذ';
  if (success && attendanceCompleted) {
    message = `تم إكمال الحضور ثم توليد اليومية — ${message}`;
  } else if (success) {
    message = `تم توليد اليومية — ${message}`;
  }

  return {
    workDate: params.workDate,
    success,
    message,
    actions: dayResults,
    review,
  };
}

export async function assignEmployeePayrollGapDayAttendance(params: {
  empId: number;
  branchId: number;
  year: number;
  month: number;
  workDate: string;
  actorUserId: number;
  options?: Pick<PayrollGapApplyOptions, 'defaultCheckoutTime' | 'notesPrefix'>;
}): Promise<PayrollGapAssignAttendanceResponse> {
  const reviewThroughDate = getCairoBusinessDate();
  if (params.workDate > reviewThroughDate) {
    throw new Error('لا يمكن تعيين حضور ليوم مستقبلي');
  }

  const period = getMonthDateRange(params.year, params.month);
  if (params.workDate < period.startDate || params.workDate > period.endDate) {
    throw new Error('التاريخ خارج نطاق الشهر المحدد');
  }

  const notesPrefix = params.options?.notesPrefix ?? '[GapReview] ';
  const notesBase = `${notesPrefix.trim()} تعيين حضور`;
  const defaultCheckoutOverride = params.options?.defaultCheckoutTime ?? '02:00';
  const db = await getPool();
  const dayOfWeek = new Date(`${params.workDate}T12:00:00`).getDay();

  const existingRes = await db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('workDate', sql.Date, params.workDate)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
    `);
  if (existingRes.recordset.length > 0) {
    throw new Error('الحضور مسجّل مسبقاً لهذا اليوم');
  }

  const anyAttRes = await db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('workDate', sql.Date, params.workDate)
    .query(`
      SELECT TOP 1 BranchID FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND WorkDate = @workDate
    `);
  const otherBranch = anyAttRes.recordset[0] as { BranchID: number } | undefined;
  if (otherBranch) {
    throw new Error(`الموظف لديه حضور في فرع آخر (${otherBranch.BranchID}) لهذا اليوم`);
  }

  const assignRes = await db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('workDate', sql.Date, params.workDate)
    .query(`
      SELECT TOP 1 EmpID
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId
        AND BranchID = @branchId
        AND EffectiveFrom <= @workDate
        AND (EffectiveTo IS NULL OR EffectiveTo >= @workDate)
    `);
  if (assignRes.recordset.length === 0) {
    throw new Error('الموظف غير مُعيَّن لهذا الفرع في هذا التاريخ');
  }

  const empRes = await db.request().input('empId', sql.Int, params.empId).query(`
    SELECT
      EmpID,
      CONVERT(VARCHAR(5), DefaultCheckInTime, 108) AS DefaultCheckInTime,
      CONVERT(VARCHAR(5), DefaultCheckOutTime, 108) AS DefaultCheckOutTime
    FROM dbo.TblEmp
    WHERE EmpID = @empId
  `);
  const empRow = empRes.recordset[0] as
    | {
        EmpID: number;
        DefaultCheckInTime: string | null;
        DefaultCheckOutTime: string | null;
      }
    | undefined;
  if (!empRow) throw new Error('الموظف غير موجود');

  const legacySchedRes = await db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('dayOfWeek', sql.TinyInt, dayOfWeek)
    .query(`
      SELECT
        CONVERT(VARCHAR(5), StartTime, 108) AS ScheduleStartTime,
        CONVERT(VARCHAR(5), EndTime, 108) AS ScheduleEndTime
      FROM dbo.TblEmpWorkSchedule
      WHERE EmpID = @empId AND DayOfWeek = @dayOfWeek
    `);
  const legacySched = legacySchedRes.recordset[0] as
    | { ScheduleStartTime: string | null; ScheduleEndTime: string | null }
    | undefined;

  const windows = await loadWorkingWindowsBatch(db, [params.empId], dayOfWeek, {
    branchId: params.branchId,
    workDate: params.workDate,
  });
  const window = windows.get(params.empId);

  const scheduleStart =
    (window?.isWorkingDay ? window.startTime : null) ??
    legacySched?.ScheduleStartTime ??
    empRow.DefaultCheckInTime ??
    null;
  const scheduleEnd =
    (window?.isWorkingDay ? window.endTime : null) ??
    legacySched?.ScheduleEndTime ??
    empRow.DefaultCheckOutTime ??
    null;

  const defaultIn = empRow.DefaultCheckInTime ?? scheduleStart;
  let defaultOut =
    empRow.DefaultCheckOutTime ?? scheduleEnd ?? defaultCheckoutOverride;

  const deferOvernightCheckout = shouldDeferOvernightDefaultCheckoutFill({
    checkOutTime: null,
    scheduledStart: scheduleStart,
    scheduledEnd: scheduleEnd,
    defaultCheckIn: defaultIn,
    defaultCheckOut: defaultOut,
    workDate: params.workDate,
  });
  if (deferOvernightCheckout) {
    defaultOut = defaultCheckoutOverride;
  }

  const filled = applyDefaultTimesToRow({
    CheckInTime: null,
    CheckOutTime: null,
    DefaultCheckInTime: defaultIn,
    DefaultCheckOutTime: defaultOut,
    ScheduledStartTime: scheduleStart,
    ScheduledEndTime: scheduleEnd,
    Status: 'Pending',
    LateMinutes: 0,
    EarlyLeaveMinutes: 0,
  });

  const checkIn = filled.CheckInTime;
  let checkOut = filled.CheckOutTime;
  if (checkIn && !checkOut) {
    checkOut = defaultCheckoutOverride;
    const refilled = applyDefaultTimesToRow({
      CheckInTime: checkIn,
      CheckOutTime: checkOut,
      DefaultCheckInTime: defaultIn,
      DefaultCheckOutTime: defaultOut,
      ScheduledStartTime: scheduleStart,
      ScheduledEndTime: scheduleEnd,
      Status: 'Pending',
      LateMinutes: 0,
      EarlyLeaveMinutes: 0,
    });
    checkOut = refilled.CheckOutTime;
  }

  if (!checkIn || !checkOut) {
    throw new Error('لا توجد أوقات افتراضية — حدّث بيانات الموظف أو جدول الفرع');
  }

  let wasClosed = false;
  const reopenReason = 'تعيين حضور — مراجعة يوميات';
  try {
    const closeView = await getEmpBranchWorkDayCloseState(params.branchId, params.workDate);
    wasClosed = closeView.state === 'CLOSED';
    if (wasClosed) {
      await reopenEmpBranchWorkDay({
        branchId: params.branchId,
        workDate: params.workDate,
        actorUserId: params.actorUserId,
        reopenReason,
      });
    }

    await persistNightlyDefaultFillAttendance({
      db,
      mode: 'insert',
      branchId: params.branchId,
      empId: params.empId,
      workDate: params.workDate,
      checkInTime: checkIn,
      checkOutTime: checkOut,
      status: filled.Status,
      lateMinutes: filled.LateMinutes,
      earlyLeaveMinutes: filled.EarlyLeaveMinutes,
      notes: notesBase,
      scheduledStart: scheduleStart,
      scheduledEnd: scheduleEnd,
    });
  } finally {
    if (wasClosed) {
      await persistEmpBranchWorkDayClosed({
        branchId: params.branchId,
        workDate: params.workDate,
        actorUserId: params.actorUserId,
      });
    }
  }

  const review = await analyzeEmployeePayrollGaps({
    empId: params.empId,
    branchId: params.branchId,
    year: params.year,
    month: params.month,
    reviewThroughDate,
  });

  return {
    workDate: params.workDate,
    success: true,
    message: `تم تعيين الحضور ${checkIn} → ${checkOut}`,
    checkIn,
    checkOut,
    review,
  };
}

export async function applyEmployeePayrollGapFixes(params: {
  empId: number;
  branchId: number;
  year: number;
  month: number;
  actorUserId: number;
  options?: PayrollGapApplyOptions;
}): Promise<PayrollGapApplyResponse> {
  const opts = buildGapApplyOptions(params.options);

  const reviewThroughDate = getCairoBusinessDate();
  const period = getMonthDateRange(params.year, params.month);
  const schedule = await buildEmployeeScheduleOffContext({
    empId: params.empId,
    branchId: params.branchId,
    startDate: period.startDate,
    endDate: period.endDate,
  });
  const db = await getPool();
  const notesBase = `${opts.notesPrefix.trim()} مراجعة يوميات`;
  const reopenReason = 'مراجعة وتصحيح يوميات الموظف';

  const summary: GapDayProcessSummary = {
    scheduledOffMarked: 0,
    scheduledOffPayrollRemoved: 0,
    attendanceCompleted: 0,
    payrollGenerated: 0,
    payrollSkippedExisting: 0,
    payrollSkippedPosted: 0,
    daysReopened: 0,
    daysReclosed: 0,
    failures: [],
  };
  const dayResults: PayrollGapApplyDayResult[] = [];

  const dates = eachDateInclusive(period.startDate, period.endDate).filter((d) => {
    if (opts.skipFutureDays && d > reviewThroughDate) return false;
    return true;
  });

  const ctx: GapDayProcessContext = {
    empId: params.empId,
    branchId: params.branchId,
    actorUserId: params.actorUserId,
    opts,
    schedule,
    db,
    notesBase,
    reopenReason,
    mode: 'bulk',
  };

  for (const workDate of dates) {
    const { dayResults: dayRes, partial } = await processPayrollGapDay(workDate, ctx);
    dayResults.push(...dayRes);
    mergePartialSummary(summary, partial);
  }

  const review = await analyzeEmployeePayrollGaps({
    empId: params.empId,
    branchId: params.branchId,
    year: params.year,
    month: params.month,
    reviewThroughDate,
  });

  return {
    empId: params.empId,
    branchId: params.branchId,
    year: params.year,
    month: params.month,
    summary,
    dayResults,
    review,
  };
}
