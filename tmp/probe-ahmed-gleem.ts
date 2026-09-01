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

  const emps = await db.request().query(`
    SELECT e.EmpID, e.EmpName, e.HourlyRate, e.DailyRate,
      CONVERT(VARCHAR(5), e.DefaultCheckInTime, 108) AS DefIn,
      CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefOut,
      bp.BranchID, b.BranchCode, bp.PayType, bp.HourlyRate AS PlanHourly, bp.DailyRate AS PlanDaily
    FROM dbo.TblEmp e
    LEFT JOIN dbo.TblEmpBranchPayrollPlan bp ON bp.EmpID = e.EmpID AND bp.IsActive = 1
    LEFT JOIN dbo.TblBranch b ON b.BranchID = bp.BranchID
    WHERE e.EmpName LIKE N'%أحمد%' OR e.EmpName LIKE N'%احمد%'
    ORDER BY e.EmpID, bp.BranchID
  `);
  console.log('EMPLOYEES:');
  console.table(emps.recordset);

  const gleemAhmed = await db.request().query(`
    SELECT e.EmpID, e.EmpName, a.BranchID, a.IsActive, a.IsHomeBranch,
      CONVERT(varchar(10), a.EffectiveFrom, 23) AS EffectiveFrom
    FROM dbo.TblEmp e
    JOIN dbo.TblEmpBranchAssignment a ON a.EmpID = e.EmpID
    WHERE (e.EmpName LIKE N'%أحمد%' OR e.EmpName LIKE N'%احمد%')
      AND a.BranchID = 1
  `);
  console.log('GLEEM assignments:');
  console.table(gleemAhmed.recordset);

  for (const empId of [18, 13]) {
    const ledger = await db.request().query(`
      SELECT EntryReason, SUM(CASE WHEN EntryDirection=N'credit' THEN Amount ELSE -Amount END) AS Net
      FROM dbo.TblEmpLedgerEntry
      WHERE EmpID = ${empId} AND BranchID = 1 AND IsVoided = 0
      GROUP BY EntryReason ORDER BY EntryReason
    `);
    console.log(`Ledger summary emp ${empId}:`);
    console.table(ledger.recordset);

    const ledgerDetail = await db.request().query(`
      SELECT EntryReason, EntryDirection, Amount,
        CONVERT(varchar(10), EntryDate, 23) AS EntryDate, Notes
      FROM dbo.TblEmpLedgerEntry
      WHERE EmpID = ${empId} AND BranchID = 1 AND IsVoided = 0
      ORDER BY EntryDate, EntryReason
    `);
    console.log(`Ledger detail emp ${empId}:`);
    console.table(ledgerDetail.recordset);

    const balance = await db.request().query(`
      SELECT SUM(CASE WHEN EntryDirection=N'credit' THEN Amount ELSE -Amount END) AS Balance
      FROM dbo.TblEmpLedgerEntry WHERE EmpID=${empId} AND BranchID=1 AND IsVoided=0
    `);
    console.log(`Balance emp ${empId}:`, balance.recordset[0]);

    const att = await db.request().query(`
      SELECT CONVERT(varchar(10), WorkDate, 23) AS d, Status,
        CONVERT(varchar(5), CheckInTime, 108) AS In, CONVERT(varchar(5), CheckOutTime, 108) AS Out
      FROM dbo.TblEmpAttendance
      WHERE EmpID = ${empId} AND BranchID = 1 AND WorkDate >= '2026-08-01'
      ORDER BY WorkDate DESC
    `);
    console.log(`Attendance emp ${empId}:`);
    console.table(att.recordset);
  }

  process.exit(0);
}

main();
