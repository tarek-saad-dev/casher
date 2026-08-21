#!/usr/bin/env npx tsx
/**
 * B9.6 — Warm path before/after style benchmark (Hot Cache ON).
 * Usage: BOOKING_V2_HOT_CACHE=on npx tsx scripts/benchmark-booking-v2-warm-b96.ts
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });
process.env.BOOKING_V2_HOT_CACHE = 'on';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const orig = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return orig.call(this, r, ...rest);
};

function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i]!;
}

async function main() {
  const { buildPublicAvailabilityMatrix } = await import(
    '../src/lib/booking/v2Frontend/buildAvailabilityMatrix'
  );
  const { __resetHotAvailabilityCacheForTests } = await import(
    '../src/lib/booking/cache/HotAvailabilityCache'
  );
  const { __resetWarmMatrixContextForTests } = await import(
    '../src/lib/booking/cache/WarmMatrixContextCache'
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

  const today = getCairoBusinessDate();
  const to = shiftCalendarDate(today, 13);
  const disc = await listPublicDiscoverableBranches();
  const code1 = disc[0]!.branchCode;
  const code2 = disc.find((b) => b.branchCode !== code1)?.branchCode ?? code1;
  const empIds = await listBookableEmployeeIdsForBranch(disc[0]!.branchId, today, {
    publicOnly: true,
  });
  const empId = empIds[0]!;

  type Sample = {
    wallMs: number;
    revisionMs: number;
    branchSettingsMs: number;
    appComputeMs: number;
    queryCount: number;
    contextHit: boolean;
    revSoft: boolean;
    heavy: number;
  };

  async function run(
    label: string,
    req: Parameters<typeof buildPublicAvailabilityMatrix>[0],
  ) {
    __resetHotAvailabilityCacheForTests();
    __resetWarmMatrixContextForTests();
    // cold once to fill L1
    await buildPublicAvailabilityMatrix(req);
    // warm context once
    await buildPublicAvailabilityMatrix(req);

    const samples: Sample[] = [];
    for (let i = 0; i < 8; i++) {
      const t0 = performance.now();
      const { metrics } = await buildPublicAvailabilityMatrix(req);
      const wallMs = performance.now() - t0;
      const warm = metrics.warm!;
      const hot = metrics.hotCache as {
        hotCacheRebuild?: number;
        revisionQueryCount?: number;
      } | null;
      samples.push({
        wallMs,
        revisionMs: warm.revisionMs,
        branchSettingsMs: warm.branchSettingsMs,
        appComputeMs: warm.appComputeMs,
        queryCount: metrics.queryCount,
        contextHit: warm.contextCacheHit,
        revSoft: warm.revisionSoftHit,
        heavy: hot?.hotCacheRebuild ?? 0,
      });
    }

    const walls = samples.map((s) => s.wallMs);
    const revs = samples.map((s) => s.revisionMs);
    const ctx = samples.map((s) => s.branchSettingsMs);
    const app = samples.map((s) => s.appComputeMs);
    const out = {
      label,
      wall_p50: +pct(walls, 50).toFixed(1),
      wall_p95: +pct(walls, 95).toFixed(1),
      revision_p50: +pct(revs, 50).toFixed(1),
      branch_settings_p50: +pct(ctx, 50).toFixed(1),
      app_compute_p50: +pct(app, 50).toFixed(1),
      query_count_avg: +(
        samples.reduce((a, s) => a + s.queryCount, 0) / samples.length
      ).toFixed(2),
      heavy_avg: +(
        samples.reduce((a, s) => a + s.heavy, 0) / samples.length
      ).toFixed(2),
      context_hit_ratio:
        samples.filter((s) => s.contextHit).length / samples.length,
      rev_soft_ratio: samples.filter((s) => s.revSoft).length / samples.length,
      sample0: samples[0],
    };
    console.log(JSON.stringify(out, null, 2));
    return out;
  }

  console.log('BOOKING V2 B9.6 WARM BENCHMARK');
  console.log(JSON.stringify({ today, to, code1, code2, empId }));

  await run('1emp×14d', {
    employeeId: empId,
    branchCode: code1,
    fromBusinessDate: today,
    toBusinessDate: to,
  });
  await run('roster×14d', {
    branchCode: code1,
    fromBusinessDate: today,
    toBusinessDate: to,
  });
  if (code2 !== code1) {
    await run('multi×14d', {
      employeeId: empId,
      branchCodes: [code1, code2],
      fromBusinessDate: today,
      toBusinessDate: to,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
