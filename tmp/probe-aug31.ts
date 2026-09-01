import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const m = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool } = await import('@/lib/db');
  const db = await getPool();
  const d = '2026-08-31';

  const att = await db.request().query(`
    SELECT b.BranchCode, e.EmpID, e.EmpName,
      CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
      CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut,
      CONVERT(varchar(5), a.ScheduledStartTime, 108) AS SchedStart,
      CONVERT(varchar(5), a.ScheduledEndTime, 108) AS SchedEnd,
      a.Status,
      CONVERT(varchar(5), e.DefaultCheckInTime, 108) AS DefIn,
      CONVERT(varchar(5), e.DefaultCheckOutTime, 108) AS DefOut
    FROM dbo.TblEmpAttendance a
    JOIN dbo.TblEmp e ON e.EmpID = a.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
    WHERE a.WorkDate = '${d}'
    ORDER BY b.BranchCode, e.EmpName
  `);
  console.table(att.recordset);

  const missing = await db.request().query(`
    SELECT b.BranchCode, e.EmpName, m.reason
    FROM (
      SELECT e.EmpID, e.EmpName, a.BranchID,
        CASE
          WHEN a.ID IS NULL THEN 'no_attendance'
          WHEN a.CheckInTime IS NULL THEN 'missing_checkin'
          WHEN a.CheckOutTime IS NULL THEN 'missing_checkout'
          ELSE 'ok'
        END AS reason
      FROM dbo.TblEmp e
      INNER JOIN dbo.TblEmpBranchAssignment asn ON asn.EmpID = e.EmpID AND asn.IsActive = 1
        AND asn.EffectiveFrom <= '${d}' AND (asn.EffectiveTo IS NULL OR asn.EffectiveTo >= '${d}')
      INNER JOIN dbo.TblEmpBranchPayrollPlan bp ON bp.EmpID = e.EmpID AND bp.BranchID = asn.BranchID
        AND bp.IsActive = 1 AND bp.PayType <> N'monthly'
        AND bp.EffectiveFrom <= '${d}' AND (bp.EffectiveTo IS NULL OR bp.EffectiveTo >= '${d}')
      LEFT JOIN dbo.TblEmpAttendance a ON a.EmpID = e.EmpID AND a.BranchID = asn.BranchID AND a.WorkDate = '${d}'
      WHERE ISNULL(e.isActive, 1) = 1
    ) x
    JOIN dbo.TblEmp e ON e.EmpID = x.EmpID
    JOIN dbo.TblBranch b ON b.BranchID = x.BranchID
    WHERE x.reason <> 'ok'
  `);
  console.log('payroll validation missing:');
  console.table(missing.recordset);

  const close = await db.request().query(`
    SELECT b.BranchCode, c.WorkDate, c.State FROM dbo.TblEmpBranchWorkDayClose c
    JOIN dbo.TblBranch b ON b.BranchID = c.BranchID
    WHERE c.WorkDate = '${d}'
  `);
  console.log('work day close:');
  console.table(close.recordset);

  process.exit(0);
}

main();
