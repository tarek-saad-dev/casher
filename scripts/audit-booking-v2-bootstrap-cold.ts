/**
 * B9.5 — Bootstrap cold-path timing audit (no guessing).
 * Usage: npx tsx scripts/audit-booking-v2-bootstrap-cold.ts
 *
 * Compares legacy per-branch+date barbers path vs optimized buildPublicBookingV2Bootstrap.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

async function main() {
  const { getPool } = await import('../src/lib/db');
  const { invalidatePublicBookingV2Bootstrap, buildPublicBookingV2Bootstrap } =
    await import('../src/lib/booking/v2Frontend/buildPublicBootstrap');
  const { listPublicDiscoverableBranches } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const { listPublicBookingBarbers } = await import(
    '../src/lib/booking/publicBookingBarbers'
  );
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');

  invalidatePublicBookingV2Bootstrap();
  const tConn0 = performance.now();
  await getPool();
  const connectionMs = performance.now() - tConn0;

  const tDisc0 = performance.now();
  const discoverable = await listPublicDiscoverableBranches();
  const discoverMs = performance.now() - tDisc0;
  const today = getCairoBusinessDate();

  const legacyBarbers: Array<{ branchCode: string; barbersWithDateMs: number }> =
    [];
  for (const b of discoverable) {
    const t0 = performance.now();
    await listPublicBookingBarbers({
      mode: 'branch',
      branchCode: b.branchCode,
      date: today,
    });
    legacyBarbers.push({
      branchCode: b.branchCode,
      barbersWithDateMs: +(performance.now() - t0).toFixed(1),
    });
  }

  invalidatePublicBookingV2Bootstrap();
  const tOpt0 = performance.now();
  const built = await buildPublicBookingV2Bootstrap({ forceRefresh: true });
  const optimizedColdMs = performance.now() - tOpt0;

  const tWarm0 = performance.now();
  const warm = await buildPublicBookingV2Bootstrap();
  const warmMs = performance.now() - tWarm0;

  const tGlob0 = performance.now();
  await listPublicBookingBarbers({ mode: 'global' });
  const globalBarbersMs = performance.now() - tGlob0;

  console.log(
    JSON.stringify(
      {
        branchCount: discoverable.length,
        connection_acquisition_ms: +connectionMs.toFixed(1),
        list_discoverable_ms: +discoverMs.toFixed(1),
        legacy_barbers_with_date: legacyBarbers,
        legacy_barbers_with_date_total_ms: +legacyBarbers
          .reduce((a, r) => a + r.barbersWithDateMs, 0)
          .toFixed(1),
        optimized_bootstrap_cold_ms: +optimizedColdMs.toFixed(1),
        optimized_bootstrap_warm_ms: +warmMs.toFixed(1),
        warm_cache_hit: warm.cacheHit,
        timings: built.timings,
        global_barbers_no_date_ms: +globalBarbersMs.toFixed(1),
        revision: built.body.revision,
        employees: built.body.employees.length,
        root_cause:
          'listPublicBookingBarbers({ date }) → resolveEmployeeGlobalSchedule per emp',
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
