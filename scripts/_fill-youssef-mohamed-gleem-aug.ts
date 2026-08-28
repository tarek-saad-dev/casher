/**
 * CLI wrapper — see src/lib/hr/opsFillYoussefMohamedGleemAugust.ts
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';

const m = Module as any;
const orig = m._load;
m._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { fillYoussefMohamedGleemAugust } = await import(
    '../src/lib/hr/opsFillYoussefMohamedGleemAugust'
  );
  const result = await fillYoussefMohamedGleemAugust();
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.summary.failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
