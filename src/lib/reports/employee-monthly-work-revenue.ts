import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  applyOverrides,
  ensureOverridesTable,
  ScheduleOverride,
} from '@/lib/scheduleOverrides';
import {
  dowFromDateStr,
  BarberSchedule,
} from '@/lib/availabilityEngine';
import {
  calcEarlyLeaveMinutes,
  calcLateMinutes,
} from '@/lib/timeUtils';
import { getEmployeeRevenueByDate, roundMoney } from '@/lib/reports/employeeServicesRevenue';
import {
  generateMonthDates,
  getCairoTodayStr,
  getMonthDateRange,
  normalizeDailyAttendanceStatus,
} from '@/lib/reports/dailyAttendanceStatus';
import {
  calcShiftDurationMinutes,
  getArabicDayName,
  getArabicMonthLabel,
  isOvernightShift,
} from '@/lib/reports/reportFormatters';
import type {
  EmployeeMonthlyDayRow,
  EmployeeMonthlyWorkRevenueReport,
  GetEmployeeMonthlyWorkRevenueParams,
} from '@/lib/reports/employee-monthly-work-revenue.types';

interface EmployeeRow {
  EmpID: number;
  EmpName: string;
  JobTitle: string | null;
  isActive: boolean;
}

interface WeeklyScheduleRow {
  DayOfWeek: number;
  IsWorkingDay: boolean;
  StartTime: string | null;
  EndTime: string | null;
}

interface DayOffRow {
  OffDate: string;
  OffType: string;
  Reason: string | null;
}

interface AttendanceRow {
  WorkDate: string;
  ScheduledStartTime: string | null;
  ScheduledEndTime: string | null;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string | null;
  LateMinutes: number;
  EarlyLeaveMinutes: number;
  Notes: string | null;
}

function normalizeSqlDate(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val.slice(0, 10);
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, '0');
    const d = String(val.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(val).slice(0, 10);
}

function buildWeeklyScheduleMap(rows: WeeklyScheduleRow[]): Map<number, WeeklyScheduleRow> {
  const map = new Map<number, WeeklyScheduleRow>();
  for (const row of rows) map.set(row.DayOfWeek, row);
  return map;
}

function resolveBaseSchedule(
  dateStr: string,
  weeklyMap: Map<number, WeeklyScheduleRow>,
  hasAnyScheduleRow: boolean,
): BarberSchedule {
  const dow = dowFromDateStr(dateStr);
  const row = weeklyMap.get(dow);

  if (row) {
    const isWorking = !!row.IsWorkingDay;
    if (isWorking && (!row.StartTime || !row.EndTime)) {
      return { isWorkingDay: false, start: null, end: null, source: 'TblEmpWorkSchedule' };
    }
    return {
      isWorkingDay: isWorking,
      start: row.StartTime,
      end: row.EndTime,
      source: 'TblEmpWorkSchedule',
    };
  }

  if (hasAnyScheduleRow) {
    return { isWorkingDay: false, start: null, end: null, source: 'TblEmpWorkSchedule' };
  }

  return { isWorkingDay: false, start: null, end: null, source: 'none' };
}

function groupOverridesByDate(rows: ScheduleOverride[]): Map<string, ScheduleOverride[]> {
  const map = new Map<string, ScheduleOverride[]>();
  for (const row of rows) {
    const key = normalizeSqlDate(row.OverrideDate);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return map;
}

function resolveEffectiveSchedule(
  empId: number,
  dateStr: string,
  weeklyMap: Map<number, WeeklyScheduleRow>,
  hasAnyScheduleRow: boolean,
  dayOffDates: Set<string>,
  overridesByDate: Map<string, ScheduleOverride[]>,
): {
  isDayOff: boolean;
  isScheduledWorkDay: boolean;
  scheduledStart: string | null;
  scheduledEnd: string | null;
} {
  const schedule = resolveBaseSchedule(dateStr, weeklyMap, hasAnyScheduleRow);
  const overrides = overridesByDate.get(dateStr) ?? [];

  const base = {
    isWorking: schedule.isWorkingDay,
    start: schedule.start ?? '00:00',
    end: schedule.end ?? '00:00',
  };
  const effective = applyOverrides(empId, dateStr, base, overrides);

  const isDayOffOverride = effective.appliedOverride?.Type === 'day_off';
  const isDayOff = dayOffDates.has(dateStr) || isDayOffOverride || !schedule.isWorkingDay;
  const isScheduledWorkDay = !isDayOff && effective.isWorking;

  const scheduledStart = isScheduledWorkDay
    ? (effective.start || schedule.start)
    : null;
  const scheduledEnd = isScheduledWorkDay
    ? (effective.end || schedule.end)
    : null;

  return { isDayOff, isScheduledWorkDay, scheduledStart, scheduledEnd };
}

async function loadEmployee(employeeId: number): Promise<EmployeeRow | null> {
  const db = await getPool();
  const result = await db.request().input('empId', sql.Int, employeeId).query(`
    SELECT
      e.EmpID,
      e.EmpName,
      e.Job AS JobTitle,
      CASE WHEN ISNULL(e.isActive, 1) = 1 THEN 1 ELSE 0 END AS IsActiveFlag
    FROM dbo.TblEmp e
    WHERE e.EmpID = @empId
  `);

  const row = result.recordset[0];
  if (!row) return null;

  return {
    EmpID: row.EmpID,
    EmpName: row.EmpName ?? '',
    JobTitle: row.JobTitle ?? null,
    isActive: !!row.IsActiveFlag,
  };
}

function isMissingTableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Invalid object name/i.test(message);
}

async function queryRecordsetOrEmpty<T>(
  label: string,
  queryFn: () => Promise<{ recordset: T[] }>,
): Promise<T[]> {
  try {
    const result = await queryFn();
    return result.recordset ?? [];
  } catch (err) {
    if (isMissingTableError(err)) {
      console.warn(`[employee-monthly-work-revenue] ${label} unavailable, using empty set`);
      return [];
    }
    throw err;
  }
}

async function loadMonthContext(
  employeeId: number,
  startDate: string,
  endDateExclusive: string,
) {
  const db = await getPool();
  await ensureOverridesTable(db);

  const [weeklyRows, dayOffRows, overrideRows, attendanceRows] = await Promise.all([
    queryRecordsetOrEmpty<WeeklyScheduleRow>('TblEmpWorkSchedule', () =>
      db.request().input('empId', sql.Int, employeeId).query(`
        SELECT
          DayOfWeek,
          IsWorkingDay,
          CASE WHEN StartTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), StartTime, 108), 5) ELSE NULL END AS StartTime,
          CASE WHEN EndTime   IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), EndTime,   108), 5) ELSE NULL END AS EndTime
        FROM dbo.TblEmpWorkSchedule
        WHERE EmpID = @empId
      `),
    ),

    queryRecordsetOrEmpty<DayOffRow>('TblEmpDayOff', () =>
      db.request()
        .input('empId', sql.Int, employeeId)
        .input('startDate', sql.Date, startDate)
        .input('endDateExclusive', sql.Date, endDateExclusive)
        .query(`
          SELECT
            CONVERT(VARCHAR(10), OffDate, 120) AS OffDate,
            OffType,
            Reason
          FROM dbo.TblEmpDayOff
          WHERE EmpID = @empId
            AND OffDate >= @startDate
            AND OffDate < @endDateExclusive
            AND IsDeleted = 0
        `),
    ),

    queryRecordsetOrEmpty<ScheduleOverride>('TblEmpScheduleOverrides', () =>
      db.request()
        .input('empId', sql.Int, employeeId)
        .input('startDate', sql.Date, startDate)
        .input('endDateExclusive', sql.Date, endDateExclusive)
        .query(`
          SELECT
            OverrideID,
            EmpID,
            CONVERT(VARCHAR(10), OverrideDate, 120) AS OverrideDate,
            Type,
            CASE WHEN StartTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), StartTime, 108), 5) ELSE NULL END AS StartTime,
            CASE WHEN EndTime   IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), EndTime,   108), 5) ELSE NULL END AS EndTime,
            Reason,
            IsActive,
            CONVERT(VARCHAR(30), CreatedAt, 120) AS CreatedAt,
            CreatedBy
          FROM dbo.TblEmpScheduleOverrides
          WHERE EmpID = @empId
            AND OverrideDate >= @startDate
            AND OverrideDate < @endDateExclusive
            AND IsActive = 1
        `),
    ),

    queryRecordsetOrEmpty<AttendanceRow>('TblEmpAttendance', () =>
      db.request()
        .input('empId', sql.Int, employeeId)
        .input('startDate', sql.Date, startDate)
        .input('endDateExclusive', sql.Date, endDateExclusive)
        .query(`
          SELECT
            CONVERT(VARCHAR(10), WorkDate, 120) AS WorkDate,
            CASE WHEN ScheduledStartTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), ScheduledStartTime, 108), 5) ELSE NULL END AS ScheduledStartTime,
            CASE WHEN ScheduledEndTime   IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), ScheduledEndTime,   108), 5) ELSE NULL END AS ScheduledEndTime,
            CASE WHEN CheckInTime  IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), CheckInTime,  108), 5) ELSE NULL END AS CheckInTime,
            CASE WHEN CheckOutTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), CheckOutTime, 108), 5) ELSE NULL END AS CheckOutTime,
            Status,
            ISNULL(LateMinutes, 0) AS LateMinutes,
            ISNULL(EarlyLeaveMinutes, 0) AS EarlyLeaveMinutes,
            Notes
          FROM dbo.TblEmpAttendance
          WHERE EmpID = @empId
            AND WorkDate >= @startDate
            AND WorkDate < @endDateExclusive
        `),
    ),
  ]);

  const weeklyMap = buildWeeklyScheduleMap(weeklyRows);
  const hasAnyScheduleRow = weeklyRows.length > 0;

  const dayOffDates = new Set<string>(
    dayOffRows.map((r) => normalizeSqlDate(r.OffDate)),
  );

  const overrides: ScheduleOverride[] = overrideRows.map((r) => ({
    ...r,
    OverrideDate: normalizeSqlDate(r.OverrideDate),
  }));
  const overridesByDate = groupOverridesByDate(overrides);

  const attendanceMap = new Map<string, AttendanceRow>();
  for (const row of attendanceRows) {
    attendanceMap.set(normalizeSqlDate(row.WorkDate), {
      ...row,
      WorkDate: normalizeSqlDate(row.WorkDate),
    });
  }

  return { weeklyMap, hasAnyScheduleRow, dayOffDates, overridesByDate, attendanceMap };
}

export async function getEmployeeMonthlyWorkRevenueReport(
  params: GetEmployeeMonthlyWorkRevenueParams,
): Promise<EmployeeMonthlyWorkRevenueReport | null> {
  const { employeeId, year, month } = params;
  const { startDate, endDateExclusive, endDate, calendarDays } = getMonthDateRange(year, month);
  const todayStr = getCairoTodayStr();

  const employee = await loadEmployee(employeeId);
  if (!employee) return null;

  const [context, revenueByDate] = await Promise.all([
    loadMonthContext(employeeId, startDate, endDateExclusive),
    getEmployeeRevenueByDate(employeeId, startDate, endDateExclusive),
  ]);

  const dates = generateMonthDates(year, month, calendarDays);
  const days: EmployeeMonthlyDayRow[] = [];

  let scheduledDays = 0;
  let attendanceDays = 0;
  let absentDays = 0;
  let incompleteAttendanceDays = 0;
  let scheduledMinutes = 0;
  let workedMinutes = 0;
  let lateMinutesTotal = 0;
  let earlyLeaveMinutesTotal = 0;
  let totalRevenue = 0;
  let totalServiceLines = 0;
  let totalInvoices = 0;

  for (const date of dates) {
    const isFutureDate = date > todayStr;
    const attendance = context.attendanceMap.get(date) ?? null;

    const effective = resolveEffectiveSchedule(
      employeeId,
      date,
      context.weeklyMap,
      context.hasAnyScheduleRow,
      context.dayOffDates,
      context.overridesByDate,
    );

    let scheduledStart = effective.scheduledStart;
    let scheduledEnd = effective.scheduledEnd;

    if (
      attendance?.ScheduledStartTime &&
      attendance?.ScheduledEndTime
    ) {
      scheduledStart = attendance.ScheduledStartTime;
      scheduledEnd = attendance.ScheduledEndTime;
    }

    const scheduledMins =
      effective.isScheduledWorkDay && scheduledStart && scheduledEnd
        ? calcShiftDurationMinutes(scheduledStart, scheduledEnd)
        : null;

    const checkIn = attendance?.CheckInTime ?? null;
    const checkOut = attendance?.CheckOutTime ?? null;

    const schedForLate = scheduledStart;
    const schedForEarly = scheduledEnd;

    const lateMinutes =
      checkIn && schedForLate
        ? (attendance?.LateMinutes ?? calcLateMinutes(checkIn, schedForLate))
        : 0;
    const earlyLeaveMinutes =
      checkOut && schedForEarly
        ? (attendance?.EarlyLeaveMinutes ?? calcEarlyLeaveMinutes(checkOut, schedForEarly))
        : 0;

    const workedMins =
      checkIn && checkOut ? calcShiftDurationMinutes(checkIn, checkOut) : null;

    const status = normalizeDailyAttendanceStatus({
      isFutureDate,
      isScheduledWorkDay: effective.isScheduledWorkDay,
      isDayOff: effective.isDayOff,
      checkIn,
      checkOut,
      attendanceStatus: attendance?.Status ?? null,
      lateMinutes,
      earlyLeaveMinutes,
    });

    const revenueRow = revenueByDate.get(date);
    const revenue = revenueRow?.revenue ?? 0;
    const serviceCount = revenueRow?.serviceCount ?? 0;
    const invoiceCount = revenueRow?.invoiceCount ?? 0;

    if (effective.isScheduledWorkDay) scheduledDays += 1;
    if (effective.isScheduledWorkDay && scheduledMins != null) scheduledMinutes += scheduledMins;

    if (checkIn) attendanceDays += 1;
    if (checkIn && !checkOut && !isFutureDate) incompleteAttendanceDays += 1;
    if (
      effective.isScheduledWorkDay &&
      !isFutureDate &&
      !effective.isDayOff &&
      !checkIn &&
      (status.statusCode === 'absent' || status.statusCode === 'no_attendance_record')
    ) {
      absentDays += 1;
    }

    if (workedMins != null) workedMinutes += workedMins;
    lateMinutesTotal += lateMinutes;
    earlyLeaveMinutesTotal += earlyLeaveMinutes;
    totalRevenue += revenue;
    totalServiceLines += serviceCount;
    totalInvoices += invoiceCount;

    const dayNumber = Number(date.slice(8, 10));

    days.push({
      date,
      dayNameAr: getArabicDayName(date),
      dayNumber,
      isFutureDate,
      isScheduledWorkDay: effective.isScheduledWorkDay,
      isDayOff: effective.isDayOff,
      scheduledStart,
      scheduledEnd,
      scheduledMinutes: scheduledMins,
      scheduledOvernight: isOvernightShift(scheduledStart, scheduledEnd),
      checkIn,
      checkOut,
      checkOutLabelAr: checkIn && !checkOut ? 'لم يسجل انصراف' : null,
      workedMinutes: workedMins,
      statusCode: status.statusCode,
      statusLabelAr: status.statusLabelAr,
      badgeVariant: status.badgeVariant,
      lateMinutes,
      earlyLeaveMinutes,
      revenue,
      serviceCount,
      invoiceCount,
      notes: attendance?.Notes ?? null,
    });
  }

  totalRevenue = roundMoney(totalRevenue);

  return {
    employee: {
      id: employee.EmpID,
      name: employee.EmpName,
      job: employee.JobTitle,
      isActive: employee.isActive,
    },
    period: {
      year,
      month,
      monthLabelAr: getArabicMonthLabel(year, month),
      startDate,
      endDate,
      timezone: 'Africa/Cairo',
    },
    summary: {
      calendarDays,
      scheduledDays,
      attendanceDays,
      absentDays,
      incompleteAttendanceDays,
      scheduledMinutes,
      workedMinutes,
      lateMinutes: lateMinutesTotal,
      earlyLeaveMinutes: earlyLeaveMinutesTotal,
      totalRevenue,
      averageRevenuePerAttendanceDay:
        attendanceDays > 0 ? roundMoney(totalRevenue / attendanceDays) : 0,
      totalServiceLines,
      totalInvoices,
    },
    days,
  };
}
