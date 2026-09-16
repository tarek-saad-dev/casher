import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  applyDefaultTimesToRow,
  shouldDeferOvernightDefaultCheckoutFill,
} from '@/lib/hr/attendance-default-fill';
import { assignEmployeePayrollGapDayAttendance } from '@/lib/hr/employeePayrollGapReview';
import { loadWorkingWindowsBatch } from '@/lib/availability/loadWorkingWindowsBatch';
import { persistNightlyDefaultFillAttendance } from '@/modules/attendance';
import { getMonthDateRange } from '@/lib/reportMonthUtils';

const MANUAL_STATUSES = new Set(['Absent', 'DayOff', 'Excused']);
const DEFAULT_CHECKOUT_OVERRIDE = '02:00';
const NOTES_PREFIX = '[MonthlySheet] ';

export type CompleteAttendancePreview = {
  mode: 'none' | 'insert' | 'update';
  workDate: string;
  empId: number;
  branchId: number;
  currentCheckIn: string | null;
  currentCheckOut: string | null;
  proposedCheckIn: string | null;
  proposedCheckOut: string | null;
  willFillCheckIn: boolean;
  willFillCheckOut: boolean;
  status: string | null;
  message: string;
  canApply: boolean;
};

export type CompleteAttendanceResult = CompleteAttendancePreview & {
  applied: boolean;
  checkIn?: string | null;
  checkOut?: string | null;
};

function yearMonthFromWorkDate(workDate: string): { year: number; month: number } {
  const [y, m] = workDate.split('-').map(Number);
  return { year: y, month: m };
}

async function loadDefaults(params: {
  empId: number;
  branchId: number;
  workDate: string;
}): Promise<{
  defaultIn: string | null;
  defaultOut: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
}> {
  const db = await getPool();
  const dayOfWeek = new Date(`${params.workDate}T12:00:00`).getDay();

  const empRes = await db.request().input('empId', sql.Int, params.empId).query(`
    SELECT
      CONVERT(VARCHAR(5), DefaultCheckInTime, 108) AS DefaultCheckInTime,
      CONVERT(VARCHAR(5), DefaultCheckOutTime, 108) AS DefaultCheckOutTime
    FROM dbo.TblEmp
    WHERE EmpID = @empId
  `);
  const empRow = empRes.recordset[0] as
    | { DefaultCheckInTime: string | null; DefaultCheckOutTime: string | null }
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
  let defaultOut = empRow.DefaultCheckOutTime ?? scheduleEnd ?? DEFAULT_CHECKOUT_OVERRIDE;

  const deferOvernightCheckout = shouldDeferOvernightDefaultCheckoutFill({
    checkOutTime: null,
    scheduledStart: scheduleStart,
    scheduledEnd: scheduleEnd,
    defaultCheckIn: defaultIn,
    defaultCheckOut: defaultOut,
    workDate: params.workDate,
  });
  if (deferOvernightCheckout) {
    defaultOut = DEFAULT_CHECKOUT_OVERRIDE;
  }

  return { defaultIn, defaultOut, scheduleStart, scheduleEnd };
}

/**
 * Preview or apply auto-complete attendance for one employee/day.
 * Fills only missing check-in/out — never overwrites existing punches.
 */
export async function completeEmployeeMonthlySheetAttendance(params: {
  empId: number;
  branchId: number;
  workDate: string;
  actorUserId: number;
  confirm: boolean;
}): Promise<CompleteAttendanceResult> {
  const { empId, branchId, workDate, actorUserId, confirm } = params;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    throw new Error('workDate مطلوب (YYYY-MM-DD)');
  }

  const today = getCairoBusinessDate();
  if (workDate > today) {
    return {
      mode: 'none',
      workDate,
      empId,
      branchId,
      currentCheckIn: null,
      currentCheckOut: null,
      proposedCheckIn: null,
      proposedCheckOut: null,
      willFillCheckIn: false,
      willFillCheckOut: false,
      status: null,
      message: 'لا يمكن إكمال حضور ليوم مستقبلي',
      canApply: false,
      applied: false,
    };
  }

  const db = await getPool();
  const existingRes = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT TOP 1
        ID,
        CONVERT(VARCHAR(5), CheckInTime, 108) AS CheckInTime,
        CONVERT(VARCHAR(5), CheckOutTime, 108) AS CheckOutTime,
        Status,
        CONVERT(VARCHAR(5), ScheduledStartTime, 108) AS ScheduledStartTime,
        CONVERT(VARCHAR(5), ScheduledEndTime, 108) AS ScheduledEndTime,
        ISNULL(LateMinutes, 0) AS LateMinutes,
        ISNULL(EarlyLeaveMinutes, 0) AS EarlyLeaveMinutes
      FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
    `);

  const existing = existingRes.recordset[0] as
    | {
        ID: number;
        CheckInTime: string | null;
        CheckOutTime: string | null;
        Status: string | null;
        ScheduledStartTime: string | null;
        ScheduledEndTime: string | null;
        LateMinutes: number;
        EarlyLeaveMinutes: number;
      }
    | undefined;

  if (existing && MANUAL_STATUSES.has(String(existing.Status ?? ''))) {
    return {
      mode: 'none',
      workDate,
      empId,
      branchId,
      currentCheckIn: existing.CheckInTime,
      currentCheckOut: existing.CheckOutTime,
      proposedCheckIn: existing.CheckInTime,
      proposedCheckOut: existing.CheckOutTime,
      willFillCheckIn: false,
      willFillCheckOut: false,
      status: existing.Status,
      message: `الحالة «${existing.Status}» — لا يتم تعبئة أوقات تلقائياً`,
      canApply: false,
      applied: false,
    };
  }

  if (existing?.CheckInTime && existing?.CheckOutTime) {
    return {
      mode: 'none',
      workDate,
      empId,
      branchId,
      currentCheckIn: existing.CheckInTime,
      currentCheckOut: existing.CheckOutTime,
      proposedCheckIn: existing.CheckInTime,
      proposedCheckOut: existing.CheckOutTime,
      willFillCheckIn: false,
      willFillCheckOut: false,
      status: existing.Status,
      message: 'بيانات الحضور والانصراف مكتملة بالفعل',
      canApply: false,
      applied: false,
    };
  }

  // No row → insert via gap-review assign (same defaults path)
  if (!existing) {
    const { year, month } = yearMonthFromWorkDate(workDate);
    const period = getMonthDateRange(year, month);
    if (workDate < period.startDate || workDate > period.endDate) {
      throw new Error('التاريخ خارج نطاق الشهر');
    }

    const anyAttRes = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('workDate', sql.Date, workDate)
      .query(`
        SELECT TOP 1 BranchID FROM dbo.TblEmpAttendance
        WHERE EmpID = @empId AND WorkDate = @workDate
      `);
    const otherBranch = anyAttRes.recordset[0] as { BranchID: number } | undefined;
    if (otherBranch && Number(otherBranch.BranchID) !== branchId) {
      return {
        mode: 'insert',
        workDate,
        empId,
        branchId,
        currentCheckIn: null,
        currentCheckOut: null,
        proposedCheckIn: null,
        proposedCheckOut: null,
        willFillCheckIn: false,
        willFillCheckOut: false,
        status: null,
        message: `الموظف لديه حضور في فرع آخر (${otherBranch.BranchID}) لهذا اليوم`,
        canApply: false,
        applied: false,
      };
    }

    const assignRes = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('branchId', sql.Int, branchId)
      .input('workDate', sql.Date, workDate)
      .query(`
        SELECT TOP 1 EmpID
        FROM dbo.TblEmpBranchAssignment
        WHERE EmpID = @empId
          AND BranchID = @branchId
          AND EffectiveFrom <= @workDate
          AND (EffectiveTo IS NULL OR EffectiveTo >= @workDate)
      `);
    if (assignRes.recordset.length === 0) {
      return {
        mode: 'insert',
        workDate,
        empId,
        branchId,
        currentCheckIn: null,
        currentCheckOut: null,
        proposedCheckIn: null,
        proposedCheckOut: null,
        willFillCheckIn: false,
        willFillCheckOut: false,
        status: null,
        message: 'الموظف غير مُعيَّن لهذا الفرع في هذا التاريخ',
        canApply: false,
        applied: false,
      };
    }

    const defaults = await loadDefaults({ empId, branchId, workDate });
    const filled = applyDefaultTimesToRow({
      CheckInTime: null,
      CheckOutTime: null,
      DefaultCheckInTime: defaults.defaultIn,
      DefaultCheckOutTime: defaults.defaultOut,
      ScheduledStartTime: defaults.scheduleStart,
      ScheduledEndTime: defaults.scheduleEnd,
      Status: 'Pending',
      LateMinutes: 0,
      EarlyLeaveMinutes: 0,
    });

    let proposedIn: string | null = filled.CheckInTime;
    let proposedOut: string | null = filled.CheckOutTime;
    if (proposedIn && !proposedOut) {
      proposedOut = DEFAULT_CHECKOUT_OVERRIDE as string;
    }

    if (!proposedIn || !proposedOut) {
      return {
        mode: 'insert',
        workDate,
        empId,
        branchId,
        currentCheckIn: null,
        currentCheckOut: null,
        proposedCheckIn: proposedIn,
        proposedCheckOut: proposedOut,
        willFillCheckIn: true,
        willFillCheckOut: true,
        status: null,
        message: 'لا توجد أوقات افتراضية — حدّث بيانات الموظف أو جدول الفرع',
        canApply: false,
        applied: false,
      };
    }

    const preview: CompleteAttendanceResult = {
      mode: 'insert',
      workDate,
      empId,
      branchId,
      currentCheckIn: null,
      currentCheckOut: null,
      proposedCheckIn: proposedIn,
      proposedCheckOut: proposedOut,
      willFillCheckIn: true,
      willFillCheckOut: true,
      status: filled.Status,
      message: `سيتم تسجيل حضور ${proposedIn} وانصراف ${proposedOut}`,
      canApply: true,
      applied: false,
    };

    if (!confirm) return preview;

    const assigned = await assignEmployeePayrollGapDayAttendance({
      empId,
      branchId,
      year,
      month,
      workDate,
      actorUserId,
      options: {
        defaultCheckoutTime: DEFAULT_CHECKOUT_OVERRIDE,
        notesPrefix: NOTES_PREFIX,
      },
    });

    return {
      ...preview,
      applied: true,
      checkIn: assigned.checkIn,
      checkOut: assigned.checkOut,
      proposedCheckIn: assigned.checkIn,
      proposedCheckOut: assigned.checkOut,
      message: assigned.message,
    };
  }

  // Incomplete row → fill only missing fields
  const defaults = await loadDefaults({ empId, branchId, workDate });
  const scheduleStart = existing.ScheduledStartTime ?? defaults.scheduleStart;
  const scheduleEnd = existing.ScheduledEndTime ?? defaults.scheduleEnd;

  const filled = applyDefaultTimesToRow({
    CheckInTime: existing.CheckInTime,
    CheckOutTime: existing.CheckOutTime,
    DefaultCheckInTime: defaults.defaultIn,
    DefaultCheckOutTime: defaults.defaultOut,
    ScheduledStartTime: scheduleStart,
    ScheduledEndTime: scheduleEnd,
    Status: existing.Status || 'Pending',
    LateMinutes: existing.LateMinutes,
    EarlyLeaveMinutes: existing.EarlyLeaveMinutes,
  });

  let proposedIn: string | null = filled.CheckInTime;
  let proposedOut: string | null = filled.CheckOutTime;
  if (proposedIn && !proposedOut) {
    proposedOut = DEFAULT_CHECKOUT_OVERRIDE as string;
  }

  const willFillCheckIn = !existing.CheckInTime && !!proposedIn;
  const willFillCheckOut = !existing.CheckOutTime && !!proposedOut;

  if (!willFillCheckIn && !willFillCheckOut) {
    return {
      mode: 'none',
      workDate,
      empId,
      branchId,
      currentCheckIn: existing.CheckInTime,
      currentCheckOut: existing.CheckOutTime,
      proposedCheckIn: existing.CheckInTime,
      proposedCheckOut: existing.CheckOutTime,
      willFillCheckIn: false,
      willFillCheckOut: false,
      status: existing.Status,
      message: 'لا يمكن إكمال البيانات — لا توجد أوقات افتراضية ناقصة',
      canApply: false,
      applied: false,
    };
  }

  if (!proposedIn || !proposedOut) {
    return {
      mode: 'update',
      workDate,
      empId,
      branchId,
      currentCheckIn: existing.CheckInTime,
      currentCheckOut: existing.CheckOutTime,
      proposedCheckIn: proposedIn,
      proposedCheckOut: proposedOut,
      willFillCheckIn,
      willFillCheckOut,
      status: existing.Status,
      message: 'لا توجد أوقات افتراضية كافية للإكمال',
      canApply: false,
      applied: false,
    };
  }

  // Preserve existing punches explicitly
  const finalIn = existing.CheckInTime ?? proposedIn;
  const finalOut = existing.CheckOutTime ?? proposedOut;
  const finalStatus = existing.CheckInTime
    ? existing.Status === 'Late'
      ? 'Late'
      : filled.Status || 'Present'
    : filled.Status;

  const preview: CompleteAttendanceResult = {
    mode: 'update',
    workDate,
    empId,
    branchId,
    currentCheckIn: existing.CheckInTime,
    currentCheckOut: existing.CheckOutTime,
    proposedCheckIn: finalIn,
    proposedCheckOut: finalOut,
    willFillCheckIn,
    willFillCheckOut,
    status: finalStatus,
    message: [
      willFillCheckIn ? `حضور ${finalIn}` : null,
      willFillCheckOut ? `انصراف ${finalOut}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    canApply: true,
    applied: false,
  };

  if (!confirm) return preview;

  await persistNightlyDefaultFillAttendance({
    db,
    mode: 'update',
    attendanceId: existing.ID,
    branchId,
    checkInTime: finalIn,
    checkOutTime: finalOut,
    status: String(finalStatus || 'Present'),
    lateMinutes: willFillCheckIn ? filled.LateMinutes : existing.LateMinutes,
    earlyLeaveMinutes: willFillCheckOut ? filled.EarlyLeaveMinutes : existing.EarlyLeaveMinutes,
    notes: `${NOTES_PREFIX}إكمال حضور/انصراف تلقائي`,
    scheduledStart: scheduleStart,
    scheduledEnd: scheduleEnd,
  });

  return {
    ...preview,
    applied: true,
    checkIn: finalIn,
    checkOut: finalOut,
    message: `تم الإكمال — ${preview.message}`,
  };
}
