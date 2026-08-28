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
  const { getPool } = await import('@/lib/db');
  const db = await getPool();
  const EMP = 1192;

  const pay = await db.request().query(`
    SELECT p.ID, CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate, p.BranchID, p.DailyWage, p.Status
    FROM dbo.TblEmpDailyPayroll p
    WHERE p.EmpID = ${EMP} AND p.WorkDate >= '2026-08-15' AND p.WorkDate <= '2026-08-27'
    ORDER BY p.WorkDate
  `);
  console.log('PAYROLL:', pay.recordset.length, 'rows');
  console.table(pay.recordset);

  const ledger = await db.request().query(`
    SELECT l.ID, CONVERT(varchar(10), l.EntryDate, 23) AS EntryDate, l.BranchID,
      l.EntryReason, l.Amount, l.RefType, l.RefID, l.IsVoided, l.PayrollMonth
    FROM dbo.TblEmpLedgerEntry l
    WHERE l.EmpID = ${EMP}
      AND l.EntryDate >= '2026-08-15' AND l.EntryDate <= '2026-08-27'
    ORDER BY l.EntryDate
  `);
  console.log('LEDGER by date:', ledger.recordset.length);
  console.table(ledger.recordset);

  const ledgerByRef = await db.request().query(`
    SELECT l.ID, l.RefID, l.BranchID, l.Amount, l.IsVoided, l.EntryReason
    FROM dbo.TblEmpLedgerEntry l
    WHERE l.EmpID = ${EMP}
      AND l.RefType = N'TblEmpDailyPayroll'
      AND l.RefID IN (SELECT ID FROM dbo.TblEmpDailyPayroll WHERE EmpID=${EMP} AND WorkDate>='2026-08-15')
  `);
  console.log('LEDGER by payroll ref:', ledgerByRef.recordset.length);
  console.table(ledgerByRef.recordset);

  const missing = await db.request().query(`
    SELECT p.ID AS PayId, CONVERT(varchar(10), p.WorkDate, 23) AS WorkDate, p.DailyWage, p.BranchID
    FROM dbo.TblEmpDailyPayroll p
    WHERE p.EmpID = ${EMP} AND p.WorkDate >= '2026-08-15' AND p.WorkDate <= '2026-08-27'
      AND p.Status = 'Generated'
      AND NOT EXISTS (
        SELECT 1 FROM dbo.TblEmpLedgerEntry l
        WHERE l.RefType = N'TblEmpDailyPayroll' AND l.RefID = p.ID
          AND l.EntryReason = N'hourly_wage' AND l.IsVoided = 0
      )
  `);
  console.log('MISSING ledger for payroll:', missing.recordset.length);
  console.table(missing.recordset);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
