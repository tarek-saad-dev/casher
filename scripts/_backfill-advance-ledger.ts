/**
 * Backfill missing advance ledger entries (production one-off). Not for commit.
 */
import path from 'path';
import dotenv from 'dotenv';
import { createRequire } from 'module';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const require = createRequire(import.meta.url);
const Module = require('module');
const orig = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === 'server-only') return {};
  // @ts-expect-error legacy hook
  return orig.call(this, request, parent, isMain);
};

async function main() {
  const month = process.argv[2] || '2026-08';
  const empId = process.argv[3] ? Number(process.argv[3]) : null;
  const apply = process.argv.includes('--apply');

  const { runEmployeeLedgerHistoricalSync } = await import(
    '../src/lib/services/employeeLedgerSyncService'
  );

  console.log(`month=${month} empId=${empId ?? 'all'} apply=${apply}`);
  const preview = await runEmployeeLedgerHistoricalSync({
    month,
    empId,
    dryRun: true,
    syncPayrollCredits: false,
    syncAdvanceDebits: true,
  });
  console.log('PREVIEW counts', preview.counts);
  console.log(
    'PREVIEW Camp Caesar advances',
    preview.previewRows.filter(
      (r) => r.source === 'advance' && (r.empName?.includes('طارق') || empId === 22),
    ),
  );

  if (!apply) {
    console.log('Dry run only — pass --apply to write');
    return;
  }

  const result = await runEmployeeLedgerHistoricalSync({
    month,
    empId,
    dryRun: false,
    syncPayrollCredits: false,
    syncAdvanceDebits: true,
  });
  console.log('APPLIED counts', result.counts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
