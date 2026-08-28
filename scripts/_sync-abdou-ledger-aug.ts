/**
 * Backfill missing hourly_wage ledger entries for Abdou Aug 2026 Gleem payroll.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

const m = Module as any;
const orig = m._load;
m._load = function (r: string, ...a: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...a);
};

const EMP_ID = 1192;
const BRANCH_ID = 1;
const MONTH = '2026-08';

async function main() {
  const { runEmployeeLedgerHistoricalSync } = await import(
    '@/lib/services/employeeLedgerSyncService'
  );

  const preview = await runEmployeeLedgerHistoricalSync({
    month: MONTH,
    empId: EMP_ID,
    dryRun: true,
    syncPayrollCredits: true,
    syncAdvanceDebits: false,
    createdByUserId: 10,
  });
  console.log('PREVIEW:', JSON.stringify(preview, null, 2));

  const applied = await runEmployeeLedgerHistoricalSync({
    month: MONTH,
    empId: EMP_ID,
    dryRun: false,
    syncPayrollCredits: true,
    syncAdvanceDebits: false,
    createdByUserId: 10,
  });
  console.log('APPLIED:', JSON.stringify(applied, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
