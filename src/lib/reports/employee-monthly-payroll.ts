import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  applyOverrides,
  ensureOverridesTable,
  type ScheduleOverride,
} from '@/lib/scheduleOverrides';
import { dowFromDateStr, type BarberSchedule } from '@/lib/availabilityEngine';
import { calcEarlyLeaveMinutes, calcLateMinutes } from '@/lib/timeUtils';
import {
  generateMonthDates,
  getCairoTodayStr,
  getMonthDateRange,
  normalizeDailyAttendanceStatus,
} from '@/lib/reports/dailyAttendanceStatus';
import {
  getArabicDayName,
  getArabicMonthLabel,
} from '@/lib/reports/reportFormatters';
import { roundMoney } from '@/lib/reportMonthUtils';
import {
  getEffectiveHourlyRate,
  resolvePayrollMethod,
  scheduledHoursFromTimes,
  type PayrollEmployeeRow,
} from '@/lib/payroll/dailyPayrollHrRules';
import { normalizePayrollMethod } from '@/lib/hr/employee-hr-model';
import { computeNetWorkedHours } from '@/lib/hr/attendance-breaks';
import { ensureAttendanceBreakSchema } from '@/lib/hr/attendance-breaks-db';
import type {
  BaseWageKind,
  EmployeeMonthlyPayrollDayRow,
  EmployeeMonthlyPayrollReport,
  GetEmployeeMonthlyPayrollParams,
} from '@/lib/reports/employee-monthly-payroll.types';

interface EmployeeRow extends PayrollEmployeeRow {
  JobTitle: string | null;
  isActive: boolean;
  DefaultCheckInTime: string | null;
  DefaultCheckOutTime: string | null;
}

interface WeeklyScheduleRow {
  DayOfWeek: number;
  IsWorkingDay: boolean;
  StartTime: string | null;
  EndTime: string | null;
}

interface AttendanceRow {
  WorkDate: string;
  AttendanceID: number | null;
  ScheduledStartTime: string | null;
  ScheduledEndTime: string | null;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  Status: string | null;
  LateMinutes: number;
  EarlyLeaveMinutes: number;
  BreakMinutesTotal: number;
  Notes: string | null;
}

interface PayrollRow {
  WorkDate: string;
  ActualHours: number | null;
  DailyWage: number | null;
  HourlyRateSnapshot: number | null;
  Status: string | null;
  Notes: string | null;
}

interface TargetRow {
  WorkDate: string;
  NetSalesAfterDiscount: number;
  TargetAmount: number;
  Status: string | null;
}

interface LedgerDayAgg {
  deductions: number;
  advances: number;
  notes: string[];
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
      console.warn(`[employee-monthly-payroll] ${label} unavailable, using empty set`);
      return [];
    }
    throw err;
  }
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

function formatHoursAr(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  if (Number.isInteger(rounded)) return `${rounded}س`;
  return `${rounded.toFixed(2)}س`;
}

function formatMoneyPlain(value: number): string {
  return new Intl.NumberFormat('ar-EG', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(value);
}

function resolveBaseWageKind(method: string | null | undefined): BaseWageKind {
  const m = normalizePayrollMethod(method) ?? resolvePayrollMethod({ EmpID: 0, EmpName: '', PayrollMethod: method });
  if (m === 'hourly' || m === 'daily' || m === 'monthly') return m;
  return 'none';
}

function buildBaseWageNote(params: {
  method: BaseWageKind;
  actualHours: number | null;
  scheduledHours: number | null;
  baseWage: number | null;
  fullDayBase: number | null;
  hourlyRate: number | null;
}): { isPartialDay: boolean; noteAr: string | null } {
  const { method, actualHours, scheduledHours, baseWage, fullDayBase, hourlyRate } = params;

  if (method !== 'hourly') {
    if (method === 'daily' && baseWage != null && baseWage > 0) {
      return { isPartialDay: false, noteAr: `يومية ثابتة: ${formatMoneyPlain(baseWage)} ج.م` };
    }
    return { isPartialDay: false, noteAr: null };
  }

  if (
    actualHours == null ||
    scheduledHours == null ||
    scheduledHours <= 0 ||
    baseWage == null ||
    fullDayBase == null
  ) {
    if (hourlyRate != null && actualHours != null && baseWage != null) {
      return {
        isPartialDay: false,
        noteAr: `بالساعة: ${formatMoneyPlain(hourlyRate)} × ${formatHoursAr(actualHours)}`,
      };
    }
    return { isPartialDay: false, noteAr: null };
  }

  const isPartial =
    actualHours + 0.001 < scheduledHours && baseWage + 0.01 < fullDayBase;

  if (isPartial) {
    return {
      isPartialDay: true,
      noteAr: `اتحاسب أساسي ${formatMoneyPlain(baseWage)} بدل ${formatMoneyPlain(fullDayBase)} (${formatHoursAr(actualHours)} من ${formatHoursAr(scheduledHours)})`,
    };
  }

  if (hourlyRate != null) {
    return {
      isPartialDay: false,
      noteAr: `بالساعة: ${formatMoneyPlain(hourlyRate)} × ${formatHoursAr(actualHours)}`,
    };
  }

  return { isPartialDay: false, noteAr: null };
}

async function loadEmployee(employeeId: number): Promise<EmployeeRow | null> {
  const db = await getPool();
  const result = await db.request().input('empId', sql.Int, employeeId).query(`
    SELECT
      e.EmpID,
      e.EmpName,
      e.Job AS JobTitle,
      CASE WHEN ISNULL(e.isActive, 1) = 1 THEN 1 ELSE 0 END AS IsActiveFlag,
      e.EmploymentType,
      e.PayrollMethod,
      e.SalaryType,
      e.ManualHourlyRate,
      e.HourlyRate,
      e.DailyRate,
      e.BaseSalary,
      e.Salary,
      e.IsPayrollEnabled,
      CASE WHEN e.DefaultCheckInTime  IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), e.DefaultCheckInTime,  108), 5) ELSE NULL END AS DefaultCheckInTime,
      CASE WHEN e.DefaultCheckOutTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), e.DefaultCheckOutTime, 108), 5) ELSE NULL END AS DefaultCheckOutTime
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
    EmploymentType: row.EmploymentType ?? null,
    PayrollMethod: row.PayrollMethod ?? null,
    SalaryType: row.SalaryType ?? null,
    ManualHourlyRate: row.ManualHourlyRate != null ? Number(row.ManualHourlyRate) : null,
    HourlyRate: row.HourlyRate != null ? Number(row.HourlyRate) : null,
    DailyRate: row.DailyRate != null ? Number(row.DailyRate) : null,
    BaseSalary: row.BaseSalary != null ? Number(row.BaseSalary) : null,
    Salary: row.Salary != null ? Number(row.Salary) : null,
    IsPayrollEnabled: row.IsPayrollEnabled,
    DefaultCheckInTime: row.DefaultCheckInTime ?? null,
    DefaultCheckOutTime: row.DefaultCheckOutTime ?? null,
  };
}

export async function getEmployeeMonthlyPayrollReport(
  params: GetEmployeeMonthlyPayrollParams,
): Promise<EmployeeMonthlyPayrollReport | null> {
  const { employeeId, year, month } = params;
  const { startDate, endDateExclusive, endDate, calendarDays } = getMonthDateRange(year, month);
  const todayStr = getCairoTodayStr();

  const employee = await loadEmployee(employeeId);
  if (!employee) return null;

  const db = await getPool();
  await ensureOverridesTable(db);
  try {
    await ensureAttendanceBreakSchema(db);
  } catch (err) {
    console.warn('[employee-monthly-payroll] ensureAttendanceBreakSchema skipped', err);
  }

  const [weeklyRows, dayOffRows, overrideRows, attendanceRows, payrollRows, targetRows, ledgerRows] =
    await Promise.all([
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

      queryRecordsetOrEmpty<{ OffDate: string }>('TblEmpDayOff', () =>
        db.request()
          .input('empId', sql.Int, employeeId)
          .input('startDate', sql.Date, startDate)
          .input('endDateExclusive', sql.Date, endDateExclusive)
          .query(`
            SELECT CONVERT(VARCHAR(10), OffDate, 120) AS OffDate
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
              OverrideID, EmpID,
              CONVERT(VARCHAR(10), OverrideDate, 120) AS OverrideDate,
              Type,
              CASE WHEN StartTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), StartTime, 108), 5) ELSE NULL END AS StartTime,
              CASE WHEN EndTime   IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), EndTime,   108), 5) ELSE NULL END AS EndTime,
              Reason, IsActive,
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
              ID AS AttendanceID,
              CASE WHEN ScheduledStartTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), ScheduledStartTime, 108), 5) ELSE NULL END AS ScheduledStartTime,
              CASE WHEN ScheduledEndTime   IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), ScheduledEndTime,   108), 5) ELSE NULL END AS ScheduledEndTime,
              CASE WHEN CheckInTime  IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), CheckInTime,  108), 5) ELSE NULL END AS CheckInTime,
              CASE WHEN CheckOutTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), CheckOutTime, 108), 5) ELSE NULL END AS CheckOutTime,
              Status,
              ISNULL(LateMinutes, 0) AS LateMinutes,
              ISNULL(EarlyLeaveMinutes, 0) AS EarlyLeaveMinutes,
              ISNULL(BreakMinutesTotal, 0) AS BreakMinutesTotal,
              Notes
            FROM dbo.TblEmpAttendance
            WHERE EmpID = @empId
              AND WorkDate >= @startDate
              AND WorkDate < @endDateExclusive
          `),
      ),

      queryRecordsetOrEmpty<PayrollRow>('TblEmpDailyPayroll', () =>
        db.request()
          .input('empId', sql.Int, employeeId)
          .input('startDate', sql.Date, startDate)
          .input('endDateExclusive', sql.Date, endDateExclusive)
          .query(`
            SELECT
              CONVERT(VARCHAR(10), WorkDate, 120) AS WorkDate,
              ActualHours,
              DailyWage,
              HourlyRateSnapshot,
              Status,
              Notes
            FROM dbo.TblEmpDailyPayroll
            WHERE EmpID = @empId
              AND WorkDate >= @startDate
              AND WorkDate < @endDateExclusive
          `),
      ),

      queryRecordsetOrEmpty<TargetRow>('TblEmpDailyTarget', () =>
        db.request()
          .input('empId', sql.Int, employeeId)
          .input('startDate', sql.Date, startDate)
          .input('endDateExclusive', sql.Date, endDateExclusive)
          .query(`
            SELECT
              CONVERT(VARCHAR(10), WorkDate, 120) AS WorkDate,
              NetSalesAfterDiscount,
              TargetAmount,
              Status
            FROM dbo.TblEmpDailyTarget
            WHERE EmpID = @empId
              AND WorkDate >= @startDate
              AND WorkDate < @endDateExclusive
          `),
      ),

      queryRecordsetOrEmpty<{
        EntryDate: string;
        EntryReason: string;
        Amount: number;
        Notes: string | null;
      }>('TblEmpLedgerEntry', () =>
        db.request()
          .input('empId', sql.Int, employeeId)
          .input('startDate', sql.Date, startDate)
          .input('endDateExclusive', sql.Date, endDateExclusive)
          .query(`
            SELECT
              CONVERT(VARCHAR(10), EntryDate, 120) AS EntryDate,
              EntryReason,
              Amount,
              Notes
            FROM dbo.TblEmpLedgerEntry
            WHERE EmpID = @empId
              AND IsVoided = 0
              AND EntryDate >= @startDate
              AND EntryDate < @endDateExclusive
              AND EntryReason IN (N'deduction', N'settlement', N'adjustment', N'advance')
              AND EntryDirection = N'debit'
          `),
      ),
    ]);

  const weeklyMap = buildWeeklyScheduleMap(weeklyRows);
  const hasAnyScheduleRow = weeklyRows.length > 0;
  const dayOffDates = new Set(dayOffRows.map((r) => normalizeSqlDate(r.OffDate)));
  const overridesByDate = groupOverridesByDate(
    overrideRows.map((r) => ({ ...r, OverrideDate: normalizeSqlDate(r.OverrideDate) })),
  );

  const attendanceMap = new Map<string, AttendanceRow>();
  for (const row of attendanceRows) {
    attendanceMap.set(normalizeSqlDate(row.WorkDate), {
      ...row,
      WorkDate: normalizeSqlDate(row.WorkDate),
      BreakMinutesTotal: Number(row.BreakMinutesTotal ?? 0),
    });
  }

  const payrollMap = new Map<string, PayrollRow>();
  for (const row of payrollRows) {
    payrollMap.set(normalizeSqlDate(row.WorkDate), {
      ...row,
      WorkDate: normalizeSqlDate(row.WorkDate),
      ActualHours: row.ActualHours != null ? Number(row.ActualHours) : null,
      DailyWage: row.DailyWage != null ? Number(row.DailyWage) : null,
      HourlyRateSnapshot: row.HourlyRateSnapshot != null ? Number(row.HourlyRateSnapshot) : null,
    });
  }

  const targetMap = new Map<string, TargetRow>();
  for (const row of targetRows) {
    targetMap.set(normalizeSqlDate(row.WorkDate), {
      ...row,
      WorkDate: normalizeSqlDate(row.WorkDate),
      NetSalesAfterDiscount: Number(row.NetSalesAfterDiscount ?? 0),
      TargetAmount: Number(row.TargetAmount ?? 0),
    });
  }

  const ledgerByDate = new Map<string, LedgerDayAgg>();
  for (const row of ledgerRows) {
    const key = normalizeSqlDate(row.EntryDate);
    const cur = ledgerByDate.get(key) ?? { deductions: 0, advances: 0, notes: [] };
    const amount = roundMoney(Number(row.Amount ?? 0));
    if (row.EntryReason === 'advance') {
      cur.advances = roundMoney(cur.advances + amount);
    } else {
      cur.deductions = roundMoney(cur.deductions + amount);
      if (row.Notes) cur.notes.push(String(row.Notes));
    }
    ledgerByDate.set(key, cur);
  }

  const payrollMethod = resolveBaseWageKind(employee.PayrollMethod);
  const dates = generateMonthDates(year, month, calendarDays);
  const days: EmployeeMonthlyPayrollDayRow[] = [];

  let scheduledDays = 0;
  let attendanceDays = 0;
  let absentDays = 0;
  let incompleteAttendanceDays = 0;
  let partialHourlyDays = 0;
  let totalActualHours = 0;
  let totalScheduledHours = 0;
  let totalBaseWage = 0;
  let totalFullDayBase = 0;
  let totalBaseShortfall = 0;
  let totalDeductions = 0;
  let totalAdvances = 0;
  let totalTargetAmount = 0;
  let totalTargetSales = 0;

  for (const date of dates) {
    const isFutureDate = date > todayStr;
    const attendance = attendanceMap.get(date) ?? null;
    const payroll = payrollMap.get(date) ?? null;
    const target = targetMap.get(date) ?? null;
    const ledger = ledgerByDate.get(date) ?? { deductions: 0, advances: 0, notes: [] };

    const effective = resolveEffectiveSchedule(
      employeeId,
      date,
      weeklyMap,
      hasAnyScheduleRow,
      dayOffDates,
      overridesByDate,
    );

    let scheduledStart = effective.scheduledStart;
    let scheduledEnd = effective.scheduledEnd;

    if (attendance?.ScheduledStartTime && attendance?.ScheduledEndTime) {
      scheduledStart = attendance.ScheduledStartTime;
      scheduledEnd = attendance.ScheduledEndTime;
    } else if (!scheduledStart && !scheduledEnd && effective.isScheduledWorkDay) {
      scheduledStart = employee.DefaultCheckInTime;
      scheduledEnd = employee.DefaultCheckOutTime;
    }

    const scheduledHours = scheduledHoursFromTimes(scheduledStart, scheduledEnd);
    const checkIn = attendance?.CheckInTime ?? null;
    const checkOut = attendance?.CheckOutTime ?? null;
    const breakMinutes = attendance?.BreakMinutesTotal ?? 0;

    const lateMinutes =
      checkIn && scheduledStart
        ? (attendance?.LateMinutes ?? calcLateMinutes(checkIn, scheduledStart))
        : 0;
    const earlyLeaveMinutes =
      checkOut && scheduledEnd
        ? (attendance?.EarlyLeaveMinutes ?? calcEarlyLeaveMinutes(checkOut, scheduledEnd))
        : 0;

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

    let actualHours =
      payroll?.ActualHours != null && Number.isFinite(payroll.ActualHours)
        ? Number(payroll.ActualHours)
        : null;
    if (actualHours == null && checkIn && checkOut) {
      actualHours = computeNetWorkedHours(checkIn, checkOut, null, breakMinutes);
    }

    const hourlyRate =
      payroll?.HourlyRateSnapshot != null && payroll.HourlyRateSnapshot > 0
        ? payroll.HourlyRateSnapshot
        : getEffectiveHourlyRate(employee, scheduledHours);

    let baseWage =
      payroll?.DailyWage != null && Number.isFinite(payroll.DailyWage)
        ? roundMoney(Number(payroll.DailyWage))
        : null;

    let fullDayBase: number | null = null;
    if (payrollMethod === 'hourly' && hourlyRate != null && scheduledHours != null && scheduledHours > 0) {
      fullDayBase = roundMoney(hourlyRate * scheduledHours);
    } else if (payrollMethod === 'daily' && employee.DailyRate != null && employee.DailyRate > 0) {
      fullDayBase = roundMoney(Number(employee.DailyRate));
    } else if (
      payrollMethod === 'hourly' &&
      (employee.Salary != null || employee.BaseSalary != null) &&
      scheduledHours != null
    ) {
      const pot = Number(employee.Salary ?? employee.BaseSalary ?? 0);
      if (pot > 0) fullDayBase = roundMoney(pot);
    }

    if (baseWage == null && !isFutureDate && actualHours != null && payrollMethod === 'hourly' && hourlyRate != null) {
      baseWage = roundMoney(hourlyRate * actualHours);
    }
    if (baseWage == null && !isFutureDate && payrollMethod === 'daily' && checkIn && checkOut && fullDayBase != null) {
      baseWage = fullDayBase;
    }

    const { isPartialDay, noteAr: baseWageNoteAr } = buildBaseWageNote({
      method: payrollMethod,
      actualHours,
      scheduledHours,
      baseWage,
      fullDayBase,
      hourlyRate,
    });

    const targetSales = target ? roundMoney(target.NetSalesAfterDiscount) : null;
    const targetAmount = target ? roundMoney(target.TargetAmount) : null;
    const targetPersistence: EmployeeMonthlyPayrollDayRow['targetPersistence'] = target
      ? 'generated'
      : 'not_generated';

    const dayBase = baseWage ?? 0;
    const dayTarget = targetAmount ?? 0;
    const dayNet = roundMoney(dayBase + dayTarget - ledger.deductions - ledger.advances);

    if (effective.isScheduledWorkDay) {
      scheduledDays += 1;
      if (scheduledHours != null) totalScheduledHours += scheduledHours;
    }
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
    if (isPartialDay) partialHourlyDays += 1;
    if (actualHours != null) totalActualHours += actualHours;
    if (baseWage != null) totalBaseWage += baseWage;
    if (fullDayBase != null && baseWage != null && checkIn) {
      totalFullDayBase += fullDayBase;
      if (isPartialDay) totalBaseShortfall += Math.max(0, fullDayBase - baseWage);
    }
    totalDeductions += ledger.deductions;
    totalAdvances += ledger.advances;
    if (targetAmount != null) totalTargetAmount += targetAmount;
    if (targetSales != null) totalTargetSales += targetSales;

    days.push({
      date,
      dayNameAr: getArabicDayName(date),
      dayNumber: Number(date.slice(8, 10)),
      isFutureDate,
      isScheduledWorkDay: effective.isScheduledWorkDay,
      isDayOff: effective.isDayOff,
      scheduledStart,
      scheduledEnd,
      scheduledHours,
      checkIn,
      checkOut,
      checkOutLabelAr: checkIn && !checkOut ? 'لم يسجل انصراف' : null,
      breakMinutes,
      actualHours: actualHours != null ? roundMoney(actualHours) : null,
      statusCode: status.statusCode,
      statusLabelAr: status.statusLabelAr,
      badgeVariant: status.badgeVariant,
      lateMinutes,
      earlyLeaveMinutes,
      payrollMethod,
      hourlyRate: hourlyRate != null ? roundMoney(hourlyRate) : null,
      baseWage,
      fullDayBase,
      isPartialDay,
      baseWageNoteAr,
      payrollStatus: payroll?.Status ?? null,
      payrollNotes: payroll?.Notes ?? null,
      deductions: ledger.deductions,
      advances: ledger.advances,
      deductionNotes: ledger.notes,
      targetSales,
      targetAmount,
      targetPersistence: target ? targetPersistence : effective.isScheduledWorkDay && !isFutureDate ? 'not_generated' : 'none',
      dayNet,
    });
  }

  totalActualHours = roundMoney(totalActualHours);
  totalScheduledHours = roundMoney(totalScheduledHours);
  totalBaseWage = roundMoney(totalBaseWage);
  totalFullDayBase = roundMoney(totalFullDayBase);
  totalBaseShortfall = roundMoney(totalBaseShortfall);
  totalDeductions = roundMoney(totalDeductions);
  totalAdvances = roundMoney(totalAdvances);
  totalTargetAmount = roundMoney(totalTargetAmount);
  totalTargetSales = roundMoney(totalTargetSales);

  const monthNet = roundMoney(totalBaseWage + totalTargetAmount - totalDeductions - totalAdvances);

  return {
    employee: {
      id: employee.EmpID,
      name: employee.EmpName,
      job: employee.JobTitle,
      isActive: employee.isActive,
      employmentType: employee.EmploymentType ?? null,
      payrollMethod: employee.PayrollMethod ?? null,
      hourlyRate:
        employee.ManualHourlyRate ?? employee.HourlyRate ?? null,
      dailyRate: employee.DailyRate ?? null,
      baseSalary: employee.BaseSalary ?? employee.Salary ?? null,
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
      partialHourlyDays,
      totalActualHours,
      totalScheduledHours,
      totalBaseWage,
      totalFullDayBase,
      totalBaseShortfall,
      totalDeductions,
      totalAdvances,
      totalTargetAmount,
      totalTargetSales,
      monthNet,
    },
    days,
  };
}
