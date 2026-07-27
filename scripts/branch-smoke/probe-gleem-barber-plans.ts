/**
 * Probe GLEEM barbers with payroll for CC launch roster candidates.
 */
import Module from 'module';
import { readFileSync } from 'fs';
import { resolve } from 'path';

for (const envPath of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(process.cwd(), envPath), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* */
  }
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../../src/lib/db');
  const db = await getPool();

  const barbers = await db.request().query(`
    SELECT TOP 30
      e.EmpID, e.EmpName, e.Job,
      ea.BranchID, ea.CanReceiveBookings, ea.IsActive AS AssignActive,
      p.PayType, p.HourlyRate, p.DailyRate, p.MonthlySalary, p.EffectiveFrom AS PayFrom, p.IsActive AS PayActive
    FROM dbo.TblEmp e
    INNER JOIN dbo.TblEmpBranchAssignment ea ON ea.EmpID = e.EmpID AND ea.BranchID = 1 AND ea.IsActive = 1
    LEFT JOIN dbo.TblEmpBranchPayrollPlan p ON p.EmpID = e.EmpID AND p.BranchID = 1 AND p.IsActive = 1
    WHERE ISNULL(e.isActive,1)=1
      AND e.Job = N'حلاق'
      AND e.EmpName NOT LIKE N'%[SMOKE%'
      AND e.EmpName NOT LIKE N'%[TEST%'
    ORDER BY e.EmpName
  `);

  console.log('GLEEM active barbers with assign:', barbers.recordset.length);
  for (const r of barbers.recordset) {
    console.log(
      `#${r.EmpID} ${r.EmpName} book=${r.CanReceiveBookings} pay=${r.PayType || '-'} h=${r.HourlyRate} d=${r.DailyRate} m=${r.MonthlySalary}`,
    );
  }

  const targets = await db.request().query(`
    SELECT TOP 20 EmpID, BranchID, IsEnabled, Notes, EffectiveFrom
    FROM dbo.TblEmpTargetPlan
    WHERE BranchID = 1 AND IsEnabled = 1
    ORDER BY EmpID
  `);
  console.log('\nGLEEM target plans:', targets.recordset.length);
  for (const t of targets.recordset.slice(0, 15)) {
    console.log(`  emp=${t.EmpID} notes=${String(t.Notes||'').slice(0,50)}`);
  }

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
