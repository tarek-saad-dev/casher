#!/usr/bin/env npx tsx
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const orig = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return orig.call(this, request, ...rest);
};

async function main() {
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const { listPublicDiscoverableBranches } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const { listBookableEmployeeIdsForBranch } = await import(
    '../src/lib/branch/bookingQueueOwnership'
  );
  const today = getCairoBusinessDate();
  const branches = await listPublicDiscoverableBranches();
  for (const b of branches) {
    const pub = await listBookableEmployeeIdsForBranch(b.branchId, today, {
      publicOnly: true,
    });
    const all = await listBookableEmployeeIdsForBranch(b.branchId, today, {
      publicOnly: false,
    });
    console.log(
      JSON.stringify({
        code: b.branchCode,
        id: b.branchId,
        today,
        publicRoster: pub,
        allRoster: all,
      }),
    );
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
