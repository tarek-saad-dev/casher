import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

async function main() {
  const sql = (await import('mssql')).default;
  const db = await sql.connect({
    server: '127.0.0.1', port: 14330, database: 'last132',
    user: process.env.DB_USER, password: process.env.DB_PASSWORD,
    options: { encrypt: false, trustServerCertificate: true },
  });

  const att = await db.request().query(`
    SELECT a.WorkDate, b.BranchCode, a.Status, a.CheckInTime, a.CheckOutTime
    FROM dbo.TblEmpAttendance a
    JOIN dbo.TblEmp e ON e.EmpID=a.EmpID
    JOIN dbo.TblBranch b ON b.BranchID=a.BranchID
    WHERE e.EmpID=25 AND a.WorkDate='2026-08-28'
    ORDER BY b.BranchCode
  `);
  console.log('ATTENDANCE', JSON.stringify(att.recordset, null, 2));

  const payroll = await db.request().query(`
    SELECT p.WorkDate, b.BranchCode, p.DailyWage, p.Status
    FROM dbo.TblEmpDailyPayroll p
    JOIN dbo.TblBranch b ON b.BranchID=p.BranchID
    WHERE p.EmpID=25 AND p.WorkDate='2026-08-28'
  `);
  console.log('PAYROLL', JSON.stringify(payroll.recordset, null, 2));

  // UI query: employee ledger for Omar Aug 2026
  const ledgerUi = await db.request().query(`
    SELECT le.ID, le.EntryDate, le.EntryReason, le.Amount, le.CashMoveID, le.BranchID, b.BranchCode, le.Notes, le.CreatedAt
    FROM dbo.TblEmpLedgerEntry le
    JOIN dbo.TblBranch b ON b.BranchID=le.BranchID
    WHERE le.EmpID=25 AND le.EntryReason='advance' AND le.IsVoided=0
      AND le.EntryDate='2026-08-28'
    ORDER BY le.CreatedAt
  `);
  console.log('LEDGER UI', JSON.stringify(ledgerUi.recordset, null, 2));

  await db.close();
}
main().catch(e => { console.error(e); process.exit(1); });
