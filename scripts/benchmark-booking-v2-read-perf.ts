#!/usr/bin/env npx tsx
/**
 * Booking V2 B9.5 — Production read performance harness (Hot Cache ON).
 *
 * Usage:
 *   BOOKING_V2_HOT_CACHE=on npx tsx scripts/benchmark-booking-v2-read-perf.ts
 */
import path from 'path';
import Module from 'module';
import { gzipSync } from 'node:zlib';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

process.env.BOOKING_V2_HOT_CACHE = process.env.BOOKING_V2_HOT_CACHE || 'on';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx]!;
}

function bytes(obj: unknown): { json: number; gzip: number } {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  return { json: raw.length, gzip: gzipSync(raw).length };
}

async function main() {
  const { buildPublicBookingV2Bootstrap, invalidatePublicBookingV2Bootstrap } =
    await import('../src/lib/booking/v2Frontend/buildPublicBootstrap');
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

  // Apply bootstrap snapshot migration best-effort
  try {
    const fs = await import('node:fs');
    const { getPool } = await import('../src/lib/db');
    const db = await getPool();
    const exists = await db.request().query(`
      SELECT CASE WHEN OBJECT_ID(N'dbo.TblBookingBootstrapSnapshot', N'U') IS NULL THEN 0 ELSE 1 END AS Ok
    `);
    if (Number(exists.recordset[0]?.Ok) !== 1) {
      const raw = fs.readFileSync(
        path.join(__dirname, '..', 'db/migrations/create-booking-bootstrap-snapshot.sql'),
        'utf8',
      );
      for (const batch of raw.split(/^\s*GO\s*$/gim).map((b) => b.trim()).filter(Boolean)) {
        await db.request().query(batch);
      }
      console.log('applied TblBookingBootstrapSnapshot');
    }
  } catch (e) {
    console.warn('bootstrap migration skip', e instanceof Error ? e.message : e);
  }

  const today = getCairoBusinessDate();
  const to = shiftCalendarDate(today, 13);
  const discoverable = await listPublicDiscoverableBranches();
  const code1 =
    process.env.BOOKING_V2_B9_BRANCH_CODE?.toUpperCase() ||
    discoverable[0]?.branchCode;
  const code2 =
    process.env.BOOKING_V2_B9_BRANCH_CODE_2?.toUpperCase() ||
    discoverable.find((b) => b.branchCode !== code1)?.branchCode ||
    code1;
  if (!code1) throw new Error('no branches');
  const branch1 = discoverable.find((b) => b.branchCode === code1)!;
  const empIds = await listBookableEmployeeIdsForBranch(branch1.branchId, today, {
    publicOnly: true,
  });
  const empId =
    Number(process.env.BOOKING_V2_B9_EMP_ID ?? 0) || empIds[0] || 0;
  if (!empId) throw new Error('no emp');

  console.log('BOOKING V2 B9.5 READ PERF');
  console.log(
    JSON.stringify({
      hotCache: process.env.BOOKING_V2_HOT_CACHE,
      today,
      range: `${today}..${to}`,
      code1,
      code2,
      empId,
    }),
  );

  // --- Bootstrap samples ---
  invalidatePublicBookingV2Bootstrap();
  const bootCold: number[] = [];
  const bootWarm: number[] = [];
  let bootTimingsCold: unknown = null;
  let bootSizes = { json: 0, gzip: 0 };

  for (let i = 0; i < 3; i++) {
    invalidatePublicBookingV2Bootstrap();
    const t0 = performance.now();
    const r = await buildPublicBookingV2Bootstrap({ forceRefresh: true });
    bootCold.push(performance.now() - t0);
    if (i === 0) {
      bootTimingsCold = r.timings;
      bootSizes = bytes(r.body);
    }
  }
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    await buildPublicBookingV2Bootstrap();
    bootWarm.push(performance.now() - t0);
  }
  bootCold.sort((a, b) => a - b);
  bootWarm.sort((a, b) => a - b);

  console.log('\n## Bootstrap');
  console.log(
    JSON.stringify(
      {
        cold_p50_ms: +pct(bootCold, 50).toFixed(1),
        cold_p95_ms: +pct(bootCold, 95).toFixed(1),
        warm_p50_ms: +pct(bootWarm, 50).toFixed(1),
        warm_p95_ms: +pct(bootWarm, 95).toFixed(1),
        gzip_kb: +(bootSizes.gzip / 1024).toFixed(2),
        timings_cold: bootTimingsCold,
      },
      null,
      2,
    ),
  );

  type MatrixSample = {
    wallMs: number;
    dbMs: number;
    queryCount: number;
    hotCache: {
      hotCacheHit?: number;
      hotCacheMiss?: number;
      hotCacheRebuild?: number;
      revisionQueryCount?: number;
      revisionLookupMs?: number;
      rebuildDbMs?: number;
    } | null;
  };

  async function sampleMatrix(
    label: string,
    req: Parameters<typeof buildPublicAvailabilityMatrix>[0],
    rounds = 3,
  ) {
    __resetHotAvailabilityCacheForTests();
    const coldSamples: MatrixSample[] = [];
    const warmSamples: MatrixSample[] = [];

    for (let i = 0; i < rounds; i++) {
      __resetHotAvailabilityCacheForTests();
      const t0 = performance.now();
      const { body, metrics } = await buildPublicAvailabilityMatrix(req);
      coldSamples.push({
        wallMs: performance.now() - t0,
        dbMs: metrics.dbMs,
        queryCount: metrics.queryCount,
        hotCache: metrics.hotCache as MatrixSample['hotCache'],
      });
      if (i === 0) {
        const sz = bytes(body);
        console.log(
          `\n## ${label} sizes json=${(sz.json / 1024).toFixed(1)}KB gzip=${(sz.gzip / 1024).toFixed(1)}KB days=${body.days.length}`,
        );
      }
    }

    for (let i = 0; i < rounds; i++) {
      const t0 = performance.now();
      const { metrics } = await buildPublicAvailabilityMatrix(req);
      warmSamples.push({
        wallMs: performance.now() - t0,
        dbMs: metrics.dbMs,
        queryCount: metrics.queryCount,
        hotCache: metrics.hotCache as MatrixSample['hotCache'],
      });
    }

    const summarize = (samples: MatrixSample[]) => {
      const walls = samples.map((s) => s.wallMs).sort((a, b) => a - b);
      const dbs = samples.map((s) => s.dbMs).sort((a, b) => a - b);
      const qs = samples.map((s) => s.queryCount);
      const hits = samples.map((s) => s.hotCache?.hotCacheHit ?? 0);
      const misses = samples.map((s) => s.hotCache?.hotCacheMiss ?? 0);
      const rebuilds = samples.map((s) => s.hotCache?.hotCacheRebuild ?? 0);
      const revQ = samples.map((s) => s.hotCache?.revisionQueryCount ?? 0);
      const hitSum = hits.reduce((a, b) => a + b, 0);
      const missSum = misses.reduce((a, b) => a + b, 0);
      return {
        wall_p50_ms: +pct(walls, 50).toFixed(1),
        wall_p95_ms: +pct(walls, 95).toFixed(1),
        db_p50_ms: +pct(dbs, 50).toFixed(1),
        query_count_avg: +(qs.reduce((a, b) => a + b, 0) / qs.length).toFixed(1),
        revision_queries_avg: +(revQ.reduce((a, b) => a + b, 0) / revQ.length).toFixed(1),
        heavy_rebuild_avg: +(
          rebuilds.reduce((a, b) => a + b, 0) / rebuilds.length
        ).toFixed(1),
        cache_hit_ratio:
          hitSum + missSum === 0
            ? null
            : +((hitSum / (hitSum + missSum)) * 100).toFixed(1),
        sample0: samples[0],
      };
    };

    const report = {
      cold: summarize(coldSamples),
      warm: summarize(warmSamples),
    };
    console.log(JSON.stringify(report, null, 2));
    return report;
  }

  await sampleMatrix('1 barber × 1 day', {
    employeeId: empId,
    branchCode: code1,
    fromBusinessDate: today,
    toBusinessDate: today,
  });

  await sampleMatrix('1 barber × 14 days', {
    employeeId: empId,
    branchCode: code1,
    fromBusinessDate: today,
    toBusinessDate: to,
  });

  await sampleMatrix('branch roster × 14 days', {
    branchCode: code1,
    fromBusinessDate: today,
    toBusinessDate: to,
  });

  if (code2 && code2 !== code1) {
    await sampleMatrix('Zeyad × 2 branches × 14 days', {
      employeeId: empId,
      branchCodes: [code1, code2],
      fromBusinessDate: today,
      toBusinessDate: to,
    });
  }

  console.log('\nBOOKING V2 PRODUCTION READ PERFORMANCE HARNESS DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
