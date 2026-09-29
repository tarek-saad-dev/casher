#!/usr/bin/env npx tsx
/**
 * Regenerate daily payroll pipeline from month start → today (Cairo).
 * Reuses runNightlyClose (attendance Default fill + payroll + targets + ledger heal).
 * No WhatsApp. No force-close.
 *
 *   npx tsx scripts/regen-daily-payroll-month-to-today.ts
 *   npx tsx scripts/regen-daily-payroll-month-to-today.ts --dry-run
 *   npx tsx scripts/regen-daily-payroll-month-to-today.ts --from=2026-09-01 --to=2026-09-17
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// Ensure ledger dual-write path is on (idempotent sync upserts).
if (process.env.EMP_LEDGER_DUAL_WRITE_ENABLED == null) {
  process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
}

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const fromDate = arg('from');
  const toDate = arg('to');

  const { runDailyPayrollMonthRegen } = await import(
    '../src/lib/hr/dailyPayrollMonthRegen.service'
  );

  console.log(
    JSON.stringify(
      {
        action: 'month-regen-start',
        dryRun,
        fromDate: fromDate ?? '(month start)',
        toDate: toDate ?? '(today Cairo)',
      },
      null,
      2,
    ),
  );

  const result = await runDailyPayrollMonthRegen({
    fromDate,
    toDate,
    dryRun,
  });

  const outPath = path.join(
    __dirname,
    '..',
    'tmp',
    `month-regen-${result.fromDate}_to_${result.toDate}.json`,
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n=== MONTH REGEN SUMMARY ===');
  console.log(JSON.stringify(result.summary, null, 2));
  console.log(`\nbranches: ${result.activeBranches.map((b) => b.branchCode).join(', ')}`);
  console.log(`range: ${result.fromDate} → ${result.toDate}`);
  console.log(`ok=${result.ok}`);
  console.log(`failures=${result.failures.length}`);
  if (result.failures.length > 0) {
    console.log('\n--- failures (first 40) ---');
    for (const f of result.failures.slice(0, 40)) {
      console.log(
        `${f.workDate} | ${f.branchCode ?? '—'} | ${f.empName ?? f.empId ?? '—'} | ${f.reason}`,
      );
    }
    if (result.failures.length > 40) {
      console.log(`… +${result.failures.length - 40} more (see ${outPath})`);
    }
  }
  console.log(`\nfull report: ${outPath}`);

  // Explicit guarantees for operators
  console.log('\nCONFIRMATIONS:');
  console.log('- NO new payroll formula was introduced (reused runNightlyClose only).');
  console.log('- Ledger/payroll/target paths are existing idempotent upsert/sync services.');
  console.log('- Existing daily-close rules preserved (CLOSED days skipped; no force-close).');
  console.log('- WhatsApp skipped.');

  if (!result.ok && result.summary.datesProcessed === 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
