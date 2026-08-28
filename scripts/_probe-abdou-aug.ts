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
    WHERE e.EmpName LIKE N'%عبدو%' OR e.EmpName LIKE N'%Abdou%' OR e.EmpName LIKE N'%عبد%'
    ORDER BY e.EmpID, ba.EffectiveFrom DESC
  `);
  console.log('EMP:', JSON.stringify(emp.recordset, null, 2));

  const aug = await db.request().query(`
    SELECT
      CONVERT(varchar(10), COALESCE(a.WorkDate, p.WorkDate), 23) AS WorkDate,
      COALESCE(a.BranchID, p.BranchID) AS BranchID,
      b.BranchName,
      a.ID AS AttId, a.Status AS AttStatus,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut,
      p.ID AS PayId, p.Status AS PayStatus, p.DailyWage, p.ActualHours
    FROM dbo.TblEmp e
    LEFT JOIN dbo.TblEmpAttendance a ON a.EmpID = e.EmpID AND a.WorkDate >= '2026-08-15'
    LEFT JOIN dbo.TblEmpDailyPayroll p ON p.EmpID = e.EmpID AND p.WorkDate >= '2026-08-15'
      AND (p.WorkDate = a.WorkDate OR a.WorkDate IS NULL)
      AND (p.BranchID = a.BranchID OR a.BranchID IS NULL)
    LEFT JOIN dbo.TblBranch b ON b.BranchID = COALESCE(a.BranchID, p.BranchID)
    WHERE (e.EmpName LIKE N'%عبدو%' OR e.EmpName LIKE N'%Abdou%')
      AND (a.ID IS NOT NULL OR p.ID IS NOT NULL)
    ORDER BY WorkDate, BranchID
  `);
  console.log('AUG15+:', JSON.stringify(aug.recordset, null, 2));

  const att = await db.request().query(`
    SELECT
      CONVERT(varchar(10), a.WorkDate, 23) AS WorkDate,
      a.BranchID, b.BranchName, a.ID AS AttId, a.Status,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut
    FROM dbo.TblEmpAttendance a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE (e.EmpName LIKE N'%عبدو%' OR e.EmpName LIKE N'%Abdou%')
      AND a.WorkDate >= '2026-08-15' AND a.WorkDate <= '2026-08-28'
    ORDER BY a.WorkDate, a.BranchID
  `);
  console.log('ATT:', JSON.stringify(att.recordset, null, 2));

  const pay = await db.request().query(`
    SELECT
      CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate,
      p.BranchID, b.BranchName, p.ID AS PayId, p.Status, p.DailyWage, p.ActualHours
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
    WHERE (e.EmpName LIKE N'%عبدو%' OR e.EmpName LIKE N'%Abdou%')
      AND p.WorkDate >= '2026-08-15' AND p.WorkDate <= '2026-08-28'
    ORDER BY p.WorkDate, p.BranchID
  `);
  console.log('PAY:', JSON.stringify(pay.recordset, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
