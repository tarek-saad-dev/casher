import dotenv from 'dotenv';
import path from 'path';
import Module from 'module';

dotenv.config({ path: path.join(__dirname, '..', '.env.local') });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

const DATES = ['2026-08-28', '2026-08-29', '2026-08-30'];
const GLEEM = 1;

async function main() {
  const { getPool } = await import('@/lib/db');
  const { finalizeIncompleteAttendanceWithDefaults } = await import(
    '@/lib/hr/finalize-incomplete-attendance'
  );
  const { runDailyPayrollGenerateWithOptionalLedger } = await import(
    '@/lib/services/employeeLedgerDualWrite'
  );

  const db = await getPool();

  const plans = await db.request().query(`
    SELECT e.EmpID, e.EmpName, bp.BranchID, bp.PayType, bp.HourlyRate, bp.DailyRate,
      bp.IsActive, bp.EffectiveFrom, bp.EffectiveTo
    FROM dbo.TblEmp e
    JOIN dbo.TblEmpBranchPayrollPlan bp ON bp.EmpID = e.EmpID
    WHERE e.EmpName IN (N'طارق', N'مريم') AND bp.BranchID = 1
    ORDER BY e.EmpName, bp.EffectiveFrom DESC
  `);
  console.log('Plans:', plans.recordset);

  console.log('\n--- D-fill طارق 28 ---');
  const fill = await finalizeIncompleteAttendanceWithDefaults('2026-08-28', {
    branchId: GLEEM,
  });
  console.log('filled:', fill.filled.length, fill.filled);
  console.log('skipped:', fill.skippedNoDefault);
  console.log('remaining:', fill.remainingMissing.filter((m) => m.empName === 'طارق'));

  for (const date of DATES) {
    console.log(`\n--- Payroll generate Gleem ${date} ---`);
    try {
      const { result, ledgerSync } = await runDailyPayrollGenerateWithOptionalLedger(date, {
        branchId: GLEEM,
        notesPrefix: '[HealAug28-30] ',
      });
      console.log('generated:', result.generatedCount, 'wage:', result.totalWage, ledgerSync);
    } catch (e) {
      console.error('fail', date, e instanceof Error ? e.message : e);
    }
  }

  // مريم specific if still missing
  const maryam = await db.request().query(`
    SELECT EmpID FROM dbo.TblEmp WHERE EmpName = N'مريم'
  `);
  const maryamId = Number(maryam.recordset[0]?.EmpID);
  if (maryamId) {
    for (const date of ['2026-08-29', '2026-08-30']) {
      const { result } = await runDailyPayrollGenerateWithOptionalLedger(date, {
        branchId: GLEEM,
        empIds: [maryamId],
        notesPrefix: '[HealAug28-30-Maryam] ',
      });
      console.log(`Maryam ${date}:`, result.generatedCount, result.errors);
    }
  }

  await import('@/lib/db').then((m) => m.closePool());
}

main().catch(async (e) => {
  console.error(e);
  try {
    await import('@/lib/db').then((m) => m.closePool());
  } catch {
    /* */
  }
  process.exit(1);
});
