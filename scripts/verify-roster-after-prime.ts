#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.BOOKING_V2_HOT_CACHE = 'on';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const orig = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { __resetWarmMatrixContextForTests } = await import(
    '../src/lib/booking/cache/WarmMatrixContextCache'
  );
  const { buildPublicAvailabilityMatrix } = await import(
    '../src/lib/booking/v2Frontend/buildAvailabilityMatrix'
  );
  __resetWarmMatrixContextForTests();
  await buildPublicAvailabilityMatrix({
    employeeId: 12,
    branchCode: 'GLEEM',
    fromBusinessDate: '2026-08-16',
    toBusinessDate: '2026-08-16',
  });
  const roster = await buildPublicAvailabilityMatrix({
    branchCode: 'GLEEM',
    fromBusinessDate: '2026-08-16',
    toBusinessDate: '2026-08-29',
  });
  console.log(
    JSON.stringify({
      afterPrimeRosterDays: roster.body.days.length,
      emps: [...new Set(roster.body.days.map((d) => d.employeeId))],
    }),
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
