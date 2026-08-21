/**
 * B9.6 — Profile warm matrix path (Hot Cache ON). No guessing.
 * Usage: BOOKING_V2_HOT_CACHE=on npx tsx scripts/profile-booking-v2-warm-matrix.ts
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.BOOKING_V2_HOT_CACHE = process.env.BOOKING_V2_HOT_CACHE || 'on';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

async function main() {
  const { buildPublicAvailabilityMatrix } = await import(
    '../src/lib/booking/v2Frontend/buildAvailabilityMatrix'
  );
  const { __resetHotAvailabilityCacheForTests } = await import(
    '../src/lib/booking/cache/HotAvailabilityCache'
  );
  const { getCairoBusinessDate, shiftCalendarDate } = await import(
    '../src/lib/businessDate'
  );
  const { listPublicDiscoverableBranches } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const { listBookableEmployeeIdsForBranch } = await import(
    '../src/lib/branch/bookingQueueOwnership'
  );
  const { resolvePublicBookingBranchContext } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const { getPublicSettings } = await import('../src/lib/publicBookingHelpers');
  const { getAvailabilityRevisionSqlStore } = await import(
    '../src/lib/booking/cache/AvailabilityRevisionSqlStore'
  );

  const today = getCairoBusinessDate();
  const to = shiftCalendarDate(today, 13);
  const disc = await listPublicDiscoverableBranches();
  const code = disc[0]!.branchCode;
  const branch = disc[0]!;
  const empIds = await listBookableEmployeeIdsForBranch(branch.branchId, today, {
    publicOnly: true,
  });
  const empId = empIds[0]!;

  // Warm L1 first
  __resetHotAvailabilityCacheForTests();
  await buildPublicAvailabilityMatrix({
    employeeId: empId,
    branchCode: code,
    fromBusinessDate: today,
    toBusinessDate: to,
  });

  const mark = async (name: string, fn: () => Promise<unknown>) => {
    const t0 = performance.now();
    await fn();
    return { name, ms: +(performance.now() - t0).toFixed(2) };
  };

  const parts = [];
  parts.push(
    await mark('branch_resolution', () =>
      resolvePublicBookingBranchContext({
        branchCode: code,
        purpose: 'public_booking',
      }),
    ),
  );
  parts.push(
    await mark('settings_load', () => getPublicSettings(branch.branchId)),
  );
  parts.push(
    await mark('roster_resolution', () =>
      listBookableEmployeeIdsForBranch(branch.branchId, today, {
        publicOnly: true,
      }),
    ),
  );
  parts.push(
    await mark('revision_lookup', () =>
      getAvailabilityRevisionSqlStore().loadBatch({
        employeeIds: [empId],
        fromBusinessDate: today,
        toBusinessDate: to,
      }),
    ),
  );

  // Full warm matrix with breakdown via metrics if available
  const tWall0 = performance.now();
  const { metrics, body } = await buildPublicAvailabilityMatrix({
    employeeId: empId,
    branchCode: code,
    fromBusinessDate: today,
    toBusinessDate: to,
  });
  const wallMs = performance.now() - tWall0;

  console.log(
    JSON.stringify(
      {
        scenario: '1emp×14d warm',
        phases: parts,
        wallMs: +wallMs.toFixed(1),
        metrics,
        days: body.days.length,
        hotCache: metrics.hotCache,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
