import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
const m = Module as any;
const orig = m._load;
m._load = function (r: string, ...a: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...a);
};

async function main() {
  const { getPoolByTarget } = await import('@/lib/db');
  let db;
  for (const t of ['cloud', 'local'] as const) {
    try {
      db = await getPoolByTarget(t);
      await db.request().query('SELECT 1 AS ok');
      console.log('USING', t);
      break;
    } catch (err) {
      console.log(t, 'FAIL', err instanceof Error ? err.message : err);
    }
  }
  if (!db) throw new Error('No DB');

  const emp = await db.request().query(`
    SELECT EmpID, EmpName, PayrollMethod, HourlyRate, ManualHourlyRate
    FROM dbo.TblEmp WHERE EmpName LIKE N'%يوسف محمد%'
  `);
  console.log('EMP:', emp.recordset);
  const empId = emp.recordset[0]?.EmpID as number;

  const att = await db.request().input('e', empId).query(`
    SELECT TOP 10 CONVERT(varchar(10), WorkDate, 23) AS d,
      CONVERT(varchar(5), CheckInTime, 108) AS ci,
      CONVERT(varchar(5), CheckOutTime, 108) AS co, BranchID, Status
    FROM dbo.TblEmpAttendance WHERE EmpID=@e AND CheckInTime IS NOT NULL
      AND Status NOT IN (N'DayOff', N'Absent')
    ORDER BY WorkDate DESC
  `);
  console.log('ATT SAMPLES:', att.recordset);

  const sched = await db.request().input('e', empId).query(`
    SELECT TOP 3 BranchID, DayOfWeek, IsOffDay,
      CONVERT(varchar(5), ShiftStart, 108) AS ShiftStart,
      CONVERT(varchar(5), ShiftEnd, 108) AS ShiftEnd
    FROM dbo.TblEmpBranchWorkSchedule WHERE EmpID=@e ORDER BY EffectiveFrom DESC
  `);
  console.log('SCHEDULE:', sched.recordset);

  const byBranch = await db.request().input('e', empId).query(`
    SELECT p.BranchID, b.BranchName, COUNT(*) AS cnt, SUM(p.DailyWage) AS wage
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
    WHERE p.EmpID=@e AND p.WorkDate >= '2026-08-01' AND p.WorkDate <= '2026-08-27'
    GROUP BY p.BranchID, b.BranchName
  `);
  console.log('AUG PAY BY BRANCH:', byBranch.recordset);

  const augGap = await db.request().input('e', empId).query(`
    WITH Days AS (
      SELECT CAST(DATEADD(DAY, n, '2026-08-01') AS date) AS WorkDate
      FROM (SELECT TOP (27) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS n FROM sys.all_objects) x
    )
    SELECT CONVERT(varchar(10), d.WorkDate, 23) AS WorkDate,
      DATENAME(WEEKDAY, d.WorkDate) AS DayName,
      a.BranchID AS AttBranch,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CI,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CO,
      a.Status AS AttStatus,
      p.BranchID AS PayBranch, p.DailyWage, p.Status AS PayStatus
    FROM Days d
    LEFT JOIN dbo.TblEmpAttendance a ON a.EmpID=@e AND a.WorkDate=d.WorkDate
    LEFT JOIN dbo.TblEmpDailyPayroll p ON p.EmpID=@e AND p.WorkDate=d.WorkDate
    ORDER BY d.WorkDate
  `);
  console.log('AUG CALENDAR:', augGap.recordset);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
