/**
 * Independent SOT check for Phase 2 smoke availability grounding.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

const appRoot = '/home/casher/app';
dotenv.config({ path: path.join(appRoot, '.env.local'), override: true });
const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

async function main() {
  const { getPublicAvailableSlots } = await import(
    path.join(appRoot, 'src/lib/booking/publicBookingAvailability.ts')
  );
  const { closePool } = await import(path.join(appRoot, 'src/lib/db.ts'));
  const resp = await getPublicAvailableSlots({
    branchCode: 'CAMP_CAESAR',
    date: '2026-08-30',
    serviceIds: [20],
    empId: 25,
  });
  console.log(
    JSON.stringify(
      {
        branch: resp.branch,
        date: resp.date,
        mode: resp.mode,
        services: resp.services,
        slotCount: resp.slots.length,
        first8: resp.slots.slice(0, 8).map((s) => ({
          time: s.time,
          empId: s.barbers[0]?.empId,
          empName: s.barbers[0]?.nameAr,
        })),
      },
      null,
      2,
    ),
  );
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
