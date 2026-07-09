import { sql } from '@/lib/db';
import type { ValidationMissing } from '@/app/api/payroll/daily/validate-attendance/route';

export const ACTUAL_HOURS_EXPR = `
  CASE
    WHEN a.CheckInTime IS NULL OR a.CheckOutTime IS NULL THEN NULL
    WHEN a.CheckOutTime > a.CheckInTime
      THEN CAST(DATEDIFF(MINUTE, a.CheckInTime, a.CheckOutTime) AS DECIMAL(10,2)) / 60.0
    WHEN a.CheckOutTime < a.CheckInTime
      THEN CAST(
        DATEDIFF(
          MINUTE,
          CAST(a.CheckInTime  AS DATETIME),
          DATEADD(DAY, 1, CAST(a.CheckOutTime AS DATETIME))
        ) AS DECIMAL(10,2)
      ) / 60.0
    ELSE 0
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

function requestFrom(
  pool: { request: () => sql.Request },
  transaction?: sql.Transaction,
): sql.Request {
  return transaction ? new sql.Request(transaction) : pool.request();
}

export async function validateDailyPayrollAttendance(
  pool: { request: () => sql.Request },
  workDate: string,
): Promise<ValidationMissing[]> {
  const eligibleResult = await pool.request().query(`
    SELECT EmpID, EmpName, HourlyRate
    FROM dbo.TblEmp
    WHERE isActive = 1 AND IsPayrollEnabled = 1 AND SalaryType = N'Daily'
  `);
  const eligible: Array<{ EmpID: number; EmpName: string; HourlyRate: number | null }> =
    eligibleResult.recordset;

  const attResult = await pool.request()
    .input('WorkDate', sql.Date, workDate)
    .query(`
      SELECT EmpID, Status, CheckInTime, CheckOutTime
      FROM dbo.TblEmpAttendance
      WHERE WorkDate = @WorkDate
    `);
  const attMap = new Map<number, { Status: string; CheckInTime: unknown; CheckOutTime: unknown }>(
    attResult.recordset.map((r: { EmpID: number; Status: string; CheckInTime: unknown; CheckOutTime: unknown }) => [r.EmpID, r]),
  );

  const EXEMPT_STATUSES = new Set(['إجازة', 'DayOff', 'Holiday', 'غائب', 'Absent', 'Leave']);
  const missing: ValidationMissing[] = [];

  for (const emp of eligible) {
    const att = attMap.get(emp.EmpID);
    if (att && EXEMPT_STATUSES.has(att.Status)) continue;
    if (!emp.HourlyRate || emp.HourlyRate <= 0) {
      missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'no_hourly_rate' });
      continue;
    }
    if (!att) {
      missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'no_attendance' });
      continue;
    }
    if (!att.CheckInTime) {
      missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'missing_checkin' });
      continue;
    }
    if (!att.CheckOutTime) {
      missing.push({ empId: emp.EmpID, empName: emp.EmpName, reason: 'missing_checkout' });
      continue;
    }
  }

  return missing;
}

export async function countPostedDailyPayroll(
  pool: { request: () => sql.Request },
  workDate: string,
): Promise<number> {
  const postedCheck = await pool.request()
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

  await req()
    .input('WorkDate', sql.Date, workDate)
    .query(`
      UPDATE p
      SET
        p.HourlyRateSnapshot = e.HourlyRate,
        p.ActualHours        = ${ACTUAL_HOURS_EXPR},
        p.DailyWage          =
          CASE
            WHEN a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL AND e.HourlyRate IS NOT NULL
            THEN CAST(e.HourlyRate AS DECIMAL(10,4)) * (${ACTUAL_HOURS_EXPR})
            ELSE 0
          END,
        p.Status             = N'Generated',
        p.Notes              =
          N'${notesPrefix}Hourly: ' + CAST(ISNULL(e.HourlyRate, 0) AS NVARCHAR(20))
          + N' x ' + CAST(ISNULL(${ACTUAL_HOURS_EXPR}, 0) AS NVARCHAR(10))
          + N'h | ' + ISNULL(a.Status, N''),
        p.UpdatedAt          = GETDATE()
      FROM dbo.TblEmpDailyPayroll p
      INNER JOIN dbo.TblEmpAttendance a ON a.ID = p.AttendanceID
      INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
      WHERE p.WorkDate = @WorkDate
        AND p.Status IN (N'Generated', N'Earned', N'PendingCheckout')
    `);

  const insertResult = await req()
    .input('WorkDate', sql.Date, workDate)
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
        e.HourlyRate                                            AS HourlyRateSnapshot,
        ${ACTUAL_HOURS_EXPR}                                    AS ActualHours,
        CASE
          WHEN a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL AND e.HourlyRate IS NOT NULL
          THEN CAST(e.HourlyRate AS DECIMAL(10,4)) * (${ACTUAL_HOURS_EXPR})
          ELSE 0
        END                                                     AS DailyWage,
        N'Generated'                                            AS Status,
        N'${notesPrefix}Hourly: ' + CAST(ISNULL(e.HourlyRate,0) AS NVARCHAR(20))
          + N' x ' + CAST(ISNULL(${ACTUAL_HOURS_EXPR},0) AS NVARCHAR(10))
          + N'h | ' + ISNULL(a.Status, N'')                   AS Notes
      FROM dbo.TblEmpAttendance a
      INNER JOIN dbo.TblEmp e
        ON e.EmpID = a.EmpID
      INNER JOIN dbo.TblEmpSalaryHistory h
        ON h.EmpID = e.EmpID AND h.IsActive = 1 AND h.EffectiveTo IS NULL
      WHERE a.WorkDate = @WorkDate
        AND e.isActive = 1
        AND e.IsPayrollEnabled = 1
        AND e.SalaryType = N'Daily'
        AND ISNULL(e.HourlyRate, 0) > 0
        AND a.Status IN (N'Present', N'Late')
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
