import { sql } from '@/lib/db';
import type { PayrollValidationReason } from '@/lib/payroll/dailyPayrollHrRules';
import {
  buildDailyWageSql,
  buildHourlyRateSnapshotSql,
  buildPayrollNotesSql,
  getPayrollValidationReason,
  SQL_INSERT_ELIGIBILITY_WHERE,
} from '@/lib/payroll/dailyPayrollHrRules';

export interface ValidationMissing {
  empId: number;
  empName: string;
  reason: PayrollValidationReason;
}

export interface ValidationExcluded {
  empId: number;
  empName: string;
  reason: PayrollValidationReason;
}

/** Divide by DECIMAL 60 so the result stays DECIMAL (not float). Float → NVARCHAR(n) overflows. */
export const ACTUAL_HOURS_EXPR = `
  CASE
    WHEN a.CheckInTime IS NULL OR a.CheckOutTime IS NULL THEN NULL
    WHEN a.CheckOutTime > a.CheckInTime
      THEN CAST(DATEDIFF(MINUTE, a.CheckInTime, a.CheckOutTime) AS DECIMAL(10,2)) / CAST(60 AS DECIMAL(10,2))
    WHEN a.CheckOutTime < a.CheckInTime
      THEN CAST(
        DATEDIFF(
          MINUTE,
          CAST(a.CheckInTime  AS DATETIME),
          DATEADD(DAY, 1, CAST(a.CheckOutTime AS DATETIME))
        ) AS DECIMAL(10,2)
      ) / CAST(60 AS DECIMAL(10,2))
    ELSE CAST(0 AS DECIMAL(10,2))
  END
`;

export interface DailyPayrollGenerateResult {
  workDate: string;
  generatedCount: number;
  totalHours: number;
  totalWage: number;
  newRows: number;
}

export interface DailyPayrollGenerateOptions {
  notesPrefix?: string;
  transaction?: sql.Transaction;
}

export interface DailyPayrollValidationResult {
  missing: ValidationMissing[];
  excluded: ValidationExcluded[];
}

function requestFrom(
  pool: { request: () => sql.Request },
  transaction?: sql.Transaction,
): sql.Request {
  return transaction ? new sql.Request(transaction) : pool.request();
}

interface EmployeeValidationRow {
  EmpID: number;
  EmpName: string;
  isActive: boolean | number | null;
  IsPayrollEnabled: boolean | number | null;
  EmploymentType: string | null;
  PayrollMethod: string | null;
  SalaryType: string | null;
  ManualHourlyRate: number | null;
  HourlyRate: number | null;
  DailyRate: number | null;
  BaseSalary: number | null;
  Salary: number | null;
  DefaultCheckInTime: string | null;
  DefaultCheckOutTime: string | null;
  ScheduleDayOfWeek: number | null;
  IsWorkingDay: boolean | number | null;
  ScheduleStartTime: string | null;
  ScheduleEndTime: string | null;
}

const ERROR_REASONS = new Set<PayrollValidationReason>([
  'no_attendance',
  'missing_checkin',
  'missing_checkout',
  'no_hourly_rate',
  'no_daily_rate',
  'unsupported_payroll_method',
]);

const EXCLUDED_INFO_REASONS = new Set<PayrollValidationReason>([
  'monthly_excluded',
  'freelance_no_attendance',
  'part_time_day_off',
  'not_scheduled_working_day',
  'inactive_employee',
  'payroll_disabled',
]);

export async function validateDailyPayrollAttendance(
  pool: { request: () => sql.Request },
  workDate: string,
): Promise<DailyPayrollValidationResult> {
  const dayOfWeek = new Date(`${workDate}T12:00:00Z`).getDay();

  const eligibleResult = await pool
    .request()
    .input('dayOfWeek', sql.TinyInt, dayOfWeek)
    .query(`
      SELECT
        e.EmpID,
        e.EmpName,
        e.isActive,
        e.IsPayrollEnabled,
        e.EmploymentType,
        e.PayrollMethod,
        e.SalaryType,
        e.ManualHourlyRate,
        e.HourlyRate,
        e.DailyRate,
        e.BaseSalary,
        e.Salary,
        CONVERT(VARCHAR(5), e.DefaultCheckInTime, 108) AS DefaultCheckInTime,
        CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
        ws.DayOfWeek AS ScheduleDayOfWeek,
        ws.IsWorkingDay,
        CONVERT(VARCHAR(5), ws.StartTime, 108) AS ScheduleStartTime,
        CONVERT(VARCHAR(5), ws.EndTime, 108) AS ScheduleEndTime
      FROM dbo.TblEmp e
      LEFT JOIN dbo.TblEmpWorkSchedule ws
        ON ws.EmpID = e.EmpID AND ws.DayOfWeek = @dayOfWeek
      WHERE e.isActive = 1 AND e.IsPayrollEnabled = 1
    `);

  const attResult = await pool
    .request()
    .input('WorkDate', sql.Date, workDate)
    .query(`
      SELECT EmpID, Status, CheckInTime, CheckOutTime
      FROM dbo.TblEmpAttendance
      WHERE WorkDate = @WorkDate
    `);

  const attMap = new Map<
    number,
    { Status: string; CheckInTime: unknown; CheckOutTime: unknown }
  >(
    attResult.recordset.map(
      (r: { EmpID: number; Status: string; CheckInTime: unknown; CheckOutTime: unknown }) => [
        r.EmpID,
        r,
      ],
    ),
  );

  const missing: ValidationMissing[] = [];
  const excluded: ValidationExcluded[] = [];

  for (const emp of eligibleResult.recordset as EmployeeValidationRow[]) {
    const att = attMap.get(emp.EmpID) ?? null;
    const hasScheduleRow = emp.ScheduleDayOfWeek != null;
    const reason = getPayrollValidationReason(
      emp,
      {
        hasScheduleRow,
        isWorkingDay: hasScheduleRow ? !!emp.IsWorkingDay : null,
        scheduleStart: emp.ScheduleStartTime,
        scheduleEnd: emp.ScheduleEndTime,
      },
      att,
      emp.DefaultCheckInTime,
      emp.DefaultCheckOutTime,
    );

    if (!reason) continue;

    if (ERROR_REASONS.has(reason)) {
      missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason });
    } else if (EXCLUDED_INFO_REASONS.has(reason)) {
      excluded.push({ empId: emp.EmpID, empName: emp.EmpName, reason });
    }
  }

  return { missing, excluded };
}

export async function countEligibleDailyPayrollEmployees(
  pool: { request: () => sql.Request },
): Promise<number> {
  const result = await pool.request().query(`
    SELECT COUNT(*) AS cnt
    FROM dbo.TblEmp e
    WHERE e.isActive = 1
      AND e.IsPayrollEnabled = 1
      AND (
        e.PayrollMethod IN (N'hourly', N'daily')
        OR (e.PayrollMethod IS NULL AND ISNULL(e.SalaryType, N'Daily') <> N'monthly')
      )
  `);
  return result.recordset[0].cnt as number;
}

export async function countPostedDailyPayroll(
  pool: { request: () => sql.Request },
  workDate: string,
): Promise<number> {
  const postedCheck = await pool
    .request()
    .input('WorkDate', sql.Date, workDate)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.TblEmpDailyPayroll
      WHERE WorkDate = @WorkDate AND Status = N'PostedToCashMove'
    `);
  return postedCheck.recordset[0].cnt as number;
}

export async function executeDailyPayrollGenerate(
  pool: { request: () => sql.Request },
  workDate: string,
  options: DailyPayrollGenerateOptions = {},
): Promise<DailyPayrollGenerateResult> {
  const notesPrefix = options.notesPrefix ?? '';
  const req = () => requestFrom(pool, options.transaction);
  const dayOfWeek = new Date(`${workDate}T12:00:00Z`).getDay();

  const dailyWageSql = buildDailyWageSql(ACTUAL_HOURS_EXPR);
  const hourlySnapshotSql = buildHourlyRateSnapshotSql();
  const notesSql = buildPayrollNotesSql(notesPrefix, ACTUAL_HOURS_EXPR);

  await req()
    .input('WorkDate', sql.Date, workDate)
    .input('dayOfWeek', sql.TinyInt, dayOfWeek)
    .query(`
      UPDATE p
      SET
        p.HourlyRateSnapshot = ${hourlySnapshotSql},
        p.ActualHours        = ${ACTUAL_HOURS_EXPR},
        p.DailyWage          = ${dailyWageSql},
        p.Status             = N'Generated',
        p.Notes              = ${notesSql},
        p.UpdatedAt          = GETDATE()
      FROM dbo.TblEmpDailyPayroll p
      INNER JOIN dbo.TblEmpAttendance a ON a.ID = p.AttendanceID
      INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
      LEFT JOIN dbo.TblEmpWorkSchedule ws
        ON ws.EmpID = e.EmpID AND ws.DayOfWeek = @dayOfWeek
      WHERE p.WorkDate = @WorkDate
        AND p.Status IN (N'Generated', N'Earned', N'PendingCheckout')
    `);

  const insertResult = await req()
    .input('WorkDate', sql.Date, workDate)
    .input('dayOfWeek', sql.TinyInt, dayOfWeek)
    .query(`
      INSERT INTO dbo.TblEmpDailyPayroll
        (EmpID, AttendanceID, WorkDate, SalaryHistoryID,
         HourlyRateSnapshot, ActualHours, DailyWage, Status, Notes)
      OUTPUT
        INSERTED.ID, INSERTED.EmpID, INSERTED.WorkDate,
        INSERTED.HourlyRateSnapshot, INSERTED.ActualHours,
        INSERTED.DailyWage, INSERTED.Status, INSERTED.Notes
      SELECT
        a.EmpID,
        a.ID                                                    AS AttendanceID,
        a.WorkDate,
        h.ID                                                    AS SalaryHistoryID,
        ${hourlySnapshotSql}                                    AS HourlyRateSnapshot,
        ${ACTUAL_HOURS_EXPR}                                    AS ActualHours,
        ${dailyWageSql}                                         AS DailyWage,
        N'Generated'                                            AS Status,
        ${notesSql}                                             AS Notes
      FROM dbo.TblEmpAttendance a
      INNER JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
      INNER JOIN dbo.TblEmpSalaryHistory h
        ON h.EmpID = e.EmpID AND h.IsActive = 1 AND h.EffectiveTo IS NULL
      LEFT JOIN dbo.TblEmpWorkSchedule ws
        ON ws.EmpID = e.EmpID AND ws.DayOfWeek = @dayOfWeek
      WHERE a.WorkDate = @WorkDate
        AND ${SQL_INSERT_ELIGIBILITY_WHERE}
        AND NOT EXISTS (
          SELECT 1 FROM dbo.TblEmpDailyPayroll p
          WHERE p.EmpID = a.EmpID AND p.WorkDate = a.WorkDate
        );
    `);

  const summaryResult = await req()
    .input('WorkDate', sql.Date, workDate)
    .query(`
      SELECT
        COUNT(*)         AS total,
        SUM(ActualHours) AS totalHours,
        SUM(DailyWage)   AS totalWage
      FROM dbo.TblEmpDailyPayroll
      WHERE WorkDate = @WorkDate AND Status = N'Generated'
    `);

  const summary = summaryResult.recordset[0];

  return {
    workDate,
    generatedCount: summary.total ?? 0,
    totalHours: summary.totalHours ?? 0,
    totalWage: summary.totalWage ?? 0,
    newRows: insertResult.recordset.length,
  };
}
