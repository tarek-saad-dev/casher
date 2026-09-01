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

  const summary = await db.request().query(`
    SELECT b.BranchCode, l.EntryReason, COUNT(*) AS cnt, SUM(l.Amount) AS total
    FROM dbo.TblEmpLedgerEntry l
    JOIN dbo.TblBranch b ON b.BranchID = l.BranchID
    WHERE l.EmpID = 12 AND l.IsVoided = 0
      AND l.EntryDate >= '2026-08-01' AND l.EntryDate <= '2026-08-31'
    GROUP BY b.BranchCode, l.EntryReason
    ORDER BY b.BranchCode, l.EntryReason
  `);
  console.log('=== LEDGER SUMMARY AUG ===');
  console.table(summary.recordset);

  const gleem = await db.request().query(`
    SELECT CONVERT(varchar(10), EntryDate, 23) AS d, Amount, EntryReason
    FROM dbo.TblEmpLedgerEntry
    WHERE EmpID = 12 AND BranchID = 1 AND IsVoided = 0
      AND EntryDate >= '2026-08-01' AND EntryDate <= '2026-08-31'
      AND EntryReason = N'hourly_wage'
    ORDER BY EntryDate
  `);
  const rows = gleem.recordset as Array<{ d: string; Amount: number }>;
  const sum = rows.reduce((s, r) => s + Number(r.Amount), 0);
  console.log(`GLEEM hourly_wage: ${rows.length} days, sum=${sum}`);
  console.table(rows);

  const payGleem = await db.request().query(`
    SELECT CONVERT(varchar(10), WorkDate, 23) AS d, DailyWage, ActualHours, Status
    FROM dbo.TblEmpDailyPayroll
    WHERE EmpID = 12 AND BranchID = 1
      AND WorkDate >= '2026-08-01' AND WorkDate <= '2026-08-31'
    ORDER BY WorkDate
  `);
  const payRows = payGleem.recordset as Array<{ d: string; DailyWage: number }>;
  const paySum = payRows.reduce((s, r) => s + Number(r.DailyWage), 0);
  console.log(`GLEEM payroll: ${payRows.length} days, sum=${paySum}`);
  console.table(payRows);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
