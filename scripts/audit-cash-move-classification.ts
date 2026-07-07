/**
 * Read-only audit: classify TblCashMove rows for accounting restructuring preview.
 *
 * Usage:
 *   npx tsx scripts/audit-cash-move-classification.ts
 *   npx tsx scripts/audit-cash-move-classification.ts 2026-01-01 2026-03-31
 *   npx tsx scripts/audit-cash-move-classification.ts --limit 100 --offset 0
 */

import { readFileSync } from 'fs';
import { runCashMoveClassificationAudit } from '../src/lib/accounting/cashMoveClassificationAudit';

const envPath = '.env.local';
try {
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      let value = match[2].trim();
      value = value.replace(/^["']|["']$/g, '');
      process.env[match[1]] = value;
    }
  }
} catch {
  // ignore if .env.local is missing
}

function parseArgs(argv: string[]) {
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  let limit: number | undefined;
  let offset: number | undefined;

  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') {
      limit = parseInt(argv[++i] ?? '', 10);
    } else if (arg === '--offset') {
      offset = parseInt(argv[++i] ?? '', 10);
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }

  if (positional[0]) dateFrom = positional[0];
  if (positional[1]) dateTo = positional[1];

  return { dateFrom, dateTo, limit, offset };
}

async function main() {
  const { dateFrom, dateTo, limit, offset } = parseArgs(process.argv.slice(2));

  console.log('=== Cash Move Classification Audit (read-only) ===');
  if (dateFrom || dateTo) {
    console.log(`Date range: ${dateFrom ?? '…'} → ${dateTo ?? '…'}`);
  }

  const result = await runCashMoveClassificationAudit({ dateFrom, dateTo, limit, offset });

  console.log(`\nTotal matching rows: ${result.totalMatchingRows}`);
  console.log(`Returned rows: ${result.meta.returnedRows} (offset ${result.meta.offset}, limit ${result.meta.limit})`);
  console.log(`Summary scope: ${result.meta.summaryScope} · Rows scope: ${result.meta.rowsScope}`);
  console.log(`TblEmpPayrollTxn present: ${result.meta.hasTblEmpPayrollTxn ? 'yes' : 'no'}`);

  console.log('\n--- Summary by flow group ---');
  for (const bucket of result.summary.byFlowGroup) {
    console.log(
      `  ${bucket.key}: count=${bucket.count}, total=${bucket.totalAmount.toFixed(2)}, in=${bucket.inAmount.toFixed(2)}, out=${bucket.outAmount.toFixed(2)}`,
    );
  }

  console.log('\n--- Summary by confidence ---');
  for (const bucket of result.summary.byConfidence) {
    console.log(`  ${bucket.key}: count=${bucket.count}, total=${bucket.totalAmount.toFixed(2)}`);
  }

  console.log('\n--- Needs review ---');
  for (const bucket of result.summary.byNeedsReview) {
    console.log(`  ${bucket.key}: count=${bucket.count}, total=${bucket.totalAmount.toFixed(2)}`);
  }

  const reviewRows = result.rows.filter((r) => r.needsReview).slice(0, 20);
  if (reviewRows.length) {
    console.log(`\n--- Sample rows needing review (up to 20) ---`);
    for (const row of reviewRows) {
      console.log(
        `  #${row.cashMoveId} ${row.invDate} ${row.invType} ${row.amount} → ${row.suggestedFlowGroup}/${row.suggestedFlowKind} [${row.confidence}] — ${row.reason}`,
      );
    }
  }

  console.log('\nFull JSON written to stdout below:\n');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
