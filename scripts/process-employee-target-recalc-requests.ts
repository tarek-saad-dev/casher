#!/usr/bin/env npx tsx
/**
 * Admin CLI to process pending/failed target recalc requests.
 *
 *   npx tsx scripts/process-employee-target-recalc-requests.ts --date=2026-07-14
 *   npx tsx scripts/process-employee-target-recalc-requests.ts --date=2026-07-14 --max=20
 */
// @ts-nocheck
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad(request, parent, isMain);
};

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const workDate = arg('date');
  if (!workDate) {
    console.error('Required: --date=YYYY-MM-DD (unlimited process rejected)');
    process.exit(2);
  }
  const maxRequests = Number(arg('max') || 50);

  const { processEmployeeTargetRecalcRequests } = await import(
    '../src/lib/payroll/employee-target/employee-target-recalc-process.service'
  );

  const result = await processEmployeeTargetRecalcRequests({
    workDate,
    maxRequests,
    actorUserId: null,
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
