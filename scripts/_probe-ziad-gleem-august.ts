/**
 * Read-only probe: Ziad (زياد EmpID=12) Gleem attendance + daily payroll for August 2026.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function runQuery(
  db: { request: () => { query: (q: string) => Promise<{ recordset: unknown[] }> } },
  title: string,
  q: string,
) {
  try {
    const r = await db.request().query(q);
    console.log(`\n=== ${title} ===`);
    console.table(r.recordset);
    console.log('rows:', r.recordset.length);
    return r.recordset;
  } catch (err) {
    console.error(`\n=== ${title} FAILED ===`, err instanceof Error ? err.message : err);
    return [];
  }
}

async function main() {
  const { getPool } = await import('@/lib/db');
  const db = await getPool();

  await runQuery(
    db,
    'EMPLOYEES',
    `
    SELECT EmpID, EmpName, ISNULL(isActive, 1) AS isActive,
           CONVERT(VARCHAR(8), DefaultCheckInTime, 108) AS DefaultCheckInTime,
           CONVERT(VARCHAR(8), DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
           EmploymentType, PayrollMethod, SalaryType, HourlyRate, DailyRate, IsPayrollEnabled
    FROM dbo.TblEmp
    WHERE EmpName LIKE N'%ذياد%' OR EmpName LIKE N'%زياد%' OR EmpName LIKE N'%ziad%' OR EmpName LIKE N'%ziyad%'
    ORDER BY EmpID
  `,
  );

  await runQuery(
    db,
    'GLEEM BRANCH',
    `
    SELECT BranchID, BranchCode, BranchName, ShortName, IsActive
    FROM dbo.TblBranch
    WHERE BranchCode LIKE N'%GLEEM%' OR BranchName LIKE N'%جليم%' OR ShortName LIKE N'%جليم%'
    ORDER BY BranchID
  `,
  );

  await runQuery(
    db,
    'ASSIGNMENTS',
    `
    SELECT a.ID, a.EmpID, e.EmpName, a.BranchID, b.BranchCode, b.BranchName,
           CONVERT(varchar(10), a.EffectiveFrom, 23) AS EffectiveFrom,
           CONVERT(varchar(10), a.EffectiveTo, 23) AS EffectiveTo,
           a.IsActive, a.IsHomeBranch
    FROM dbo.TblEmpBranchAssignment a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE (e.EmpName LIKE N'%ذياد%' OR e.EmpName LIKE N'%زياد%')
    ORDER BY a.EmpID, a.BranchID, a.EffectiveFrom DESC
  `,
  );

  await runQuery(
    db,
    'PAYROLL PLANS',
    `
    SELECT bp.PlanID, bp.EmpID, e.EmpName, bp.BranchID, b.BranchCode,
           bp.PayType, bp.HourlyRate, bp.DailyRate,
           CONVERT(varchar(10), bp.EffectiveFrom, 23) AS EffectiveFrom,
           CONVERT(varchar(10), bp.EffectiveTo, 23) AS EffectiveTo,
           bp.IsActive
    FROM dbo.TblEmpBranchPayrollPlan bp
    JOIN dbo.TblEmp e ON e.EmpID = bp.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = bp.BranchID
    WHERE (e.EmpName LIKE N'%ذياد%' OR e.EmpName LIKE N'%زياد%')
    ORDER BY bp.EmpID, bp.BranchID, bp.EffectiveFrom DESC
  `,
  );

  await runQuery(
    db,
    'BRANCH WEEKLY SCHEDULE',
    `
    SELECT s.EmpID, e.EmpName, s.BranchID, b.BranchCode, s.DayOfWeek,
           s.IsWorking,
           CONVERT(VARCHAR(8), s.StartTime, 108) AS StartTime,
           CONVERT(VARCHAR(8), s.EndTime, 108) AS EndTime
    FROM dbo.TblEmpBranchWorkSchedule s
    JOIN dbo.TblEmp e ON e.EmpID = s.EmpID
    LEFT JOIN dbo.TblBranch b ON b.BranchID = s.BranchID
    WHERE (e.EmpName LIKE N'%ذياد%' OR e.EmpName LIKE N'%زياد%')
    ORDER BY s.EmpID, s.BranchID, s.DayOfWeek
  `,
  );

  await runQuery(
    db,
    'GLOBAL WEEKLY SCHEDULE',
    `
    SELECT s.EmpID, e.EmpName, s.DayOfWeek, s.IsWorkingDay,
           CONVERT(VARCHAR(8), s.StartTime, 108) AS StartTime,
           CONVERT(VARCHAR(8), s.EndTime, 108) AS EndTime
    FROM dbo.TblEmpWorkSchedule s
    JOIN dbo.TblEmp e ON e.EmpID = s.EmpID
    WHERE (e.EmpName LIKE N'%ذياد%' OR e.EmpName LIKE N'%زياد%')
    ORDER BY s.EmpID, s.DayOfWeek
  `,
  );

  await runQuery(
    db,
    'ATTENDANCE AUG 2026',
    `
    SELECT a.ID, a.EmpID, e.EmpName, a.BranchID, b.BranchCode,
           CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate,
           CONVERT(VARCHAR(8), a.CheckInTime, 108) AS CheckInTime,
           CONVERT(VARCHAR(8), a.CheckOutTime, 108) AS CheckOutTime,
           a.Status, a.LateMinutes, a.EarlyLeaveMinutes
    FROM dbo.TblEmpAttendance a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    LEFT JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE a.EmpID = 12
      AND a.WorkDate >= '2026-08-01' AND a.WorkDate <= '2026-08-31'
    ORDER BY a.WorkDate, a.BranchID
  `,
  );

  await runQuery(
    db,
    'DAILY PAYROLL AUG 2026',
    `
    SELECT p.ID, p.EmpID, e.EmpName, p.BranchID, b.BranchCode,
           CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate,
           p.HourlyRateSnapshot, p.ActualHours, p.DailyWage, p.Status
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    LEFT JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
    WHERE p.EmpID = 12
      AND p.WorkDate >= '2026-08-01' AND p.WorkDate <= '2026-08-31'
    ORDER BY p.WorkDate, p.BranchID
  `,
  );

  await runQuery(
    db,
    'GLEEM WORK DAY CLOSE AUG',
    `
    SELECT c.BranchID, b.BranchCode,
           CONVERT(varchar(10), c.WorkDate, 23) AS WorkDate,
           c.State, c.ClosedAt
    FROM dbo.TblEmpBranchWorkDayClose c
    JOIN dbo.TblBranch b ON b.BranchID = c.BranchID
    WHERE c.WorkDate >= '2026-08-01' AND c.WorkDate <= '2026-08-31'
      AND c.BranchID = 1
    ORDER BY c.WorkDate
  `,
  );

  await runQuery(
    db,
    'POSTED PAYROLL EMP 12',
    `
    SELECT p.EmpID, e.EmpName, p.BranchID, b.BranchCode,
           CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate, p.Status, p.DailyWage
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    LEFT JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
    WHERE p.EmpID = 12
      AND p.WorkDate >= '2026-08-01' AND p.WorkDate <= '2026-08-31'
      AND p.Status = N'PostedToCashMove'
    ORDER BY p.WorkDate
  `,
  );

  await runQuery(
    db,
    'ATTENDANCE SUMMARY BY BRANCH',
    `
    SELECT b.BranchCode, COUNT(*) AS cnt,
           SUM(CASE WHEN a.CheckInTime IS NOT NULL AND a.CheckOutTime IS NOT NULL THEN 1 ELSE 0 END) AS complete
    FROM dbo.TblEmpAttendance a
    LEFT JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE a.EmpID = 12 AND a.WorkDate >= '2026-08-01' AND a.WorkDate <= '2026-08-31'
    GROUP BY b.BranchCode
  `,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
