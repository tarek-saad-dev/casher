/**
 * Find Gleem days where Karim (كريم) has no daily payroll generated.
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

async function main() {
  const { getPool } = await import('@/lib/db');
  const db = await getPool();

  const empRes = await db.request().query(`
    SELECT EmpID, EmpName, ISNULL(isActive, 1) AS isActive
    FROM dbo.TblEmp
    WHERE EmpName LIKE N'%كريم%' OR EmpName LIKE N'%Karim%' OR EmpName LIKE N'%karim%'
    ORDER BY EmpID
  `);
  console.log('\n=== KARIM EMPLOYEES ===');
  console.table(empRes.recordset);

  const gleemRes = await db.request().query(`
    SELECT BranchID, BranchCode, BranchName
    FROM dbo.TblBranch
    WHERE BranchCode = N'GLEEM'
  `);
  const gleem = gleemRes.recordset[0] as { BranchID: number; BranchCode: string } | undefined;
  if (!gleem) {
    console.error('GLEEM branch not found');
    process.exit(1);
  }
  const branchId = gleem.BranchID;
  console.log('\nGLEEM BranchID:', branchId);

  // Prefer exact name match كريم
  const karim =
    (empRes.recordset as Array<{ EmpID: number; EmpName: string }>).find(
      (e) => e.EmpName.trim() === 'كريم' || e.EmpName.includes('كريم'),
    ) ?? (empRes.recordset[0] as { EmpID: number; EmpName: string } | undefined);

  if (!karim) {
    console.error('Karim employee not found');
    process.exit(1);
  }
  const empId = karim.EmpID;
  console.log(`Using EmpID=${empId} (${karim.EmpName})`);

  const year = 2026;
  const month = 8;

  const missingRes = await db.request().query(`
    WITH MonthDays AS (
      SELECT CAST(DATEADD(DAY, n, '2026-08-01') AS date) AS WorkDate
      FROM (
        SELECT TOP (31) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n
        FROM sys.all_objects
      ) nums
      WHERE DATEADD(DAY, n, '2026-08-01') <= '2026-08-31'
    ),
    Att AS (
      SELECT
        a.WorkDate,
        a.Status,
        CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
        CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut
      FROM dbo.TblEmpAttendance a
      WHERE a.EmpID = ${empId}
        AND a.BranchID = ${branchId}
        AND a.WorkDate >= '2026-08-01' AND a.WorkDate <= '2026-08-31'
    ),
  Pay AS (
      SELECT
        p.WorkDate,
        p.Status AS PayrollStatus,
        p.DailyWage,
        p.ActualHours
      FROM dbo.TblEmpDailyPayroll p
      WHERE p.EmpID = ${empId}
        AND p.BranchID = ${branchId}
        AND p.WorkDate >= '2026-08-01' AND p.WorkDate <= '2026-08-31'
    ),
    CloseState AS (
      SELECT
        c.WorkDate,
        c.State AS DayCloseState
      FROM dbo.TblEmpBranchWorkDayClose c
      WHERE c.BranchID = ${branchId}
        AND c.WorkDate >= '2026-08-01' AND c.WorkDate <= '2026-08-31'
    )
    SELECT
      CONVERT(varchar(10), d.WorkDate, 23) AS WorkDate,
      DATENAME(WEEKDAY, d.WorkDate) AS DayName,
      CASE WHEN a.WorkDate IS NULL THEN 0 ELSE 1 END AS HasAttendance,
      a.Status AS AttendanceStatus,
      a.CheckIn,
      a.CheckOut,
      CASE WHEN p.WorkDate IS NULL THEN 0 ELSE 1 END AS HasPayroll,
      p.PayrollStatus,
      p.DailyWage,
      p.ActualHours,
      cs.DayCloseState
    FROM MonthDays d
    LEFT JOIN Att a ON a.WorkDate = d.WorkDate
    LEFT JOIN Pay p ON p.WorkDate = d.WorkDate
    LEFT JOIN CloseState cs ON cs.WorkDate = d.WorkDate
  WHERE p.WorkDate IS NULL
    ORDER BY d.WorkDate
  `);

  console.log(`\n=== MISSING DAILY PAYROLL — ${karim.EmpName} — GLEEM — Aug ${year} ===`);
  console.log('Count:', missingRes.recordset.length);
  console.table(missingRes.recordset);

  const summaryRes = await db.request().query(`
    SELECT
      (SELECT COUNT(*) FROM dbo.TblEmpAttendance
       WHERE EmpID = ${empId} AND BranchID = ${branchId}
         AND WorkDate >= '2026-08-01' AND WorkDate <= '2026-08-31') AS AttendanceDays,
      (SELECT COUNT(*) FROM dbo.TblEmpDailyPayroll
       WHERE EmpID = ${empId} AND BranchID = ${branchId}
         AND WorkDate >= '2026-08-01' AND WorkDate <= '2026-08-31') AS PayrollDays,
      (SELECT COUNT(*) FROM dbo.TblEmpAttendance a
       WHERE a.EmpID = ${empId} AND a.BranchID = ${branchId}
         AND a.WorkDate >= '2026-08-01' AND a.WorkDate <= '2026-08-31'
         AND NOT EXISTS (
           SELECT 1 FROM dbo.TblEmpDailyPayroll p
           WHERE p.EmpID = a.EmpID AND p.BranchID = a.BranchID AND p.WorkDate = a.WorkDate
         )) AS AttendanceWithoutPayroll
  `);
  console.log('\n=== SUMMARY ===');
  console.table(summaryRes.recordset);

  const attNoPayRes = await db.request().query(`
    SELECT
      CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate,
      DATENAME(WEEKDAY, a.WorkDate) AS DayName,
      a.Status,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut
    FROM dbo.TblEmpAttendance a
    WHERE a.EmpID = ${empId}
      AND a.BranchID = ${branchId}
      AND a.WorkDate >= '2026-08-01' AND a.WorkDate <= '2026-08-31'
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpDailyPayroll p
        WHERE p.EmpID = a.EmpID AND p.BranchID = a.BranchID AND p.WorkDate = a.WorkDate
      )
    ORDER BY a.WorkDate
  `);
  console.log('\n=== ATTENDANCE EXISTS BUT NO PAYROLL ===');
  console.table(attNoPayRes.recordset);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
