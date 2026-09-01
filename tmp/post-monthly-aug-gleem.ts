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

async function main() {
  const { postMonthlySalaryEntitlements } = await import(
    '@/lib/services/employeeLedgerMonthlySalaryService'
  );
  const result = await postMonthlySalaryEntitlements({
    month: '2026-08',
    branchId: 1,
    postingDate: '2026-08-30',
    dryRun: false,
    createdByUserId: 10,
  });
  console.log('counts', result.counts);
  console.table(result.rows);
  await import('@/lib/db').then((m) => m.closePool());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
