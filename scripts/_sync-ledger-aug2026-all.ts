/**
 * Backfill missing hourly_wage ledger entries for all Generated payroll — August 2026.
 */
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
  const { runEmployeeLedgerHistoricalSync } = await import(
    '@/lib/services/employeeLedgerSyncService'
  );

  const applied = await runEmployeeLedgerHistoricalSync({
    month: '2026-08',
    empId: null,
    dryRun: false,
    syncPayrollCredits: true,
    syncAdvanceDebits: false,
    createdByUserId: 10,
  });

  console.log(JSON.stringify(applied, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
