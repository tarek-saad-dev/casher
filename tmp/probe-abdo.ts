#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const db = await getPool();
  const today = getCairoBusinessDate();

  const emps = await db.request().query(`
    SELECT EmpID, EmpName, isActive, IsPayrollEnabled
    FROM dbo.TblEmp
    WHERE EmpName LIKE N'%عبدو%' AND ISNULL(isActive,1)=1
  `);
  console.log('EMPS', JSON.stringify(emps.recordset, null, 2));

  for (const e of emps.recordset as Array<{ EmpID: number; EmpName: string }>) {
    const att = await db.request().input('id', sql.Int, e.EmpID).input('from', sql.Date, '2026-09-01').input('to', sql.Date, today).query(`
      SELECT CONVERT(varchar(10), a.WorkDate, 120) AS WorkDate, a.BranchID, b.BranchCode,
        CONVERT(varchar(5), a.CheckInTime, 108) AS CheckIn,
        CONVERT(varchar(5), a.CheckOutTime, 108) AS CheckOut,
        a.Status, a.ID AS AttendanceID
      FROM dbo.TblEmpAttendance a
      JOIN dbo.TblBranch b ON b.BranchID = a.BranchID
      WHERE a.EmpID = @id AND a.WorkDate >= @from AND a.WorkDate <= @to
      ORDER BY a.WorkDate
    `);
    const pay = await db.request().input('id', sql.Int, e.EmpID).input('from', sql.Date, '2026-09-01').input('to', sql.Date, today).query(`
      SELECT CONVERT(varchar(10), p.WorkDate, 120) AS WorkDate, p.BranchID, b.BranchCode,
        p.Status, CAST(p.DailyWage AS float) AS DailyWage, CAST(p.ActualHours AS float) AS Hours, p.ID AS PayrollID
      FROM dbo.TblEmpDailyPayroll p
      JOIN dbo.TblBranch b ON b.BranchID = p.BranchID
      WHERE p.EmpID = @id AND p.WorkDate >= @from AND p.WorkDate <= @to
      ORDER BY p.WorkDate
    `);
    const led = await db.request().input('id', sql.Int, e.EmpID).input('from', sql.Date, '2026-09-01').input('to', sql.Date, today).query(`
      SELECT CONVERT(varchar(10), l.EntryDate, 120) AS EntryDate, l.BranchID, b.BranchCode,
        l.EntryReason, CAST(l.Amount AS float) AS Amount, l.RefID, l.IsVoided
      FROM dbo.TblEmpLedgerEntry l
      JOIN dbo.TblBranch b ON b.BranchID = l.BranchID
      WHERE l.EmpID = @id AND l.EntryDate >= @from AND l.EntryDate <= @to
        AND l.EntryReason = N'hourly_wage'
      ORDER BY l.EntryDate
    `);
    console.log('\n===', e.EmpID, e.EmpName, '===');
    console.log('ATT', JSON.stringify(att.recordset, null, 2));
    console.log('PAY', JSON.stringify(pay.recordset, null, 2));
    console.log('LED', JSON.stringify(led.recordset, null, 2));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
