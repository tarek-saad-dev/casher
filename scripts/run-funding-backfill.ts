/**
 * Apply July 2026 employee_funding backfill for missing CashMoves.
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const month = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || '2026-07';

  const { runEmployeeFundingBackfill } = await import(
    '@/lib/services/employeeLedgerFundingBackfillService'
  );

  const result = await runEmployeeFundingBackfill({
    month,
    empId: null,
    dryRun,
    createdByUserId: null,
  });

  console.log(JSON.stringify({
    dryRun: result.dryRun,
    month: result.month,
    flagEnabled: result.flagEnabled,
    counts: result.counts,
    errors: result.errors,
    previewRows: result.previewRows,
    reconciliation: result.reconciliation.filter((r) => Math.abs(r.difference) >= 0.01 || r.missingCashMoveIds.length),
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
