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

  const emp = await db.request().query(`
    SELECT e.EmpID, e.EmpName, ba.BranchID, b.BranchName, ba.EffectiveFrom, ba.EffectiveTo
    FROM dbo.TblEmp e
    LEFT JOIN dbo.TblEmpBranchAssignment ba ON ba.EmpID = e.EmpID
    LEFT JOIN dbo.TblBranch b ON b.BranchID = ba.BranchID
    WHERE e.EmpName LIKE N'%عمر%' OR e.EmpName LIKE N'%Omar%'
    ORDER BY e.EmpID, ba.EffectiveFrom DESC
  `);
  console.log('EMP:', JSON.stringify(emp.recordset, null, 2));

  const aug = await db.request().query(`
    SELECT CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate, a.BranchID, a.Status,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut,
      CASE WHEN p.ID IS NULL THEN 0 ELSE 1 END AS HasPayroll
    FROM dbo.TblEmpAttendance a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    LEFT JOIN dbo.TblEmpDailyPayroll p
      ON p.EmpID = a.EmpID AND p.BranchID = a.BranchID AND p.WorkDate = a.WorkDate
    WHERE (e.EmpName LIKE N'%عمر%' OR e.EmpName LIKE N'%Omar%')
      AND a.WorkDate >= '2026-08-01' AND a.WorkDate <= '2026-08-31'
    ORDER BY a.WorkDate
  `);
  console.log('AUG:', JSON.stringify(aug.recordset, null, 2));

  const sched = await db.request().query(`
    SELECT e.EmpID, s.DayOfWeek, s.IsWorking, s.IsWorkingDay,
      CONVERT(varchar(5), s.StartTime, 108) AS StartTime,
      CONVERT(varchar(5), s.EndTime, 108) AS EndTime
    FROM dbo.TblEmp e
    LEFT JOIN dbo.TblEmpBranchWorkSchedule s ON s.EmpID = e.EmpID
    LEFT JOIN dbo.TblEmpWorkSchedule ws ON ws.EmpID = e.EmpID AND ws.DayOfWeek = s.DayOfWeek
    WHERE e.EmpName LIKE N'%عمر%' OR e.EmpName LIKE N'%Omar%'
    ORDER BY e.EmpID, s.DayOfWeek
  `);
  console.log('SCHED:', JSON.stringify(sched.recordset, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
