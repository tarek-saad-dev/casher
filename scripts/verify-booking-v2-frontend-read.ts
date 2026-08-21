#!/usr/bin/env npx tsx
/**
 * Booking V2 B9 — Frontend Read API size / latency harness.
 *
 * Usage:
 *   npx tsx scripts/verify-booking-v2-frontend-read.ts
 *
 * Optional env:
 *   BOOKING_V2_B9_BRANCH_CODE / BOOKING_V2_B9_BRANCH_CODE_2
 *   BOOKING_V2_B9_EMP_ID
 */
import path from 'path';
import Module from 'module';
import { gzipSync } from 'node:zlib';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// Allow importing Next `server-only` modules from a CLI script.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

function bytes(obj: unknown): { json: number; gzip: number } {
  const raw = Buffer.from(JSON.stringify(obj), 'utf8');
  return { json: raw.length, gzip: gzipSync(raw).length };
}

function kb(n: number): string {
  return `${(n / 1024).toFixed(1)} KB`;
}

async function main() {
  const { buildPublicBookingV2Bootstrap, invalidatePublicBookingV2Bootstrap } =
    await import('../src/lib/booking/v2Frontend/buildPublicBootstrap');
  const { buildPublicAvailabilityMatrix } = await import(
    '../src/lib/booking/v2Frontend/buildAvailabilityMatrix'
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
  const to = shiftCalendarDate(today, 13); // 14 inclusive days

  invalidatePublicBookingV2Bootstrap();
  const tCold0 = performance.now();
  const cold = await buildPublicBookingV2Bootstrap({ forceRefresh: true });
  const coldMs = performance.now() - tCold0;

  const tWarm0 = performance.now();
  const warm = await buildPublicBookingV2Bootstrap();
  const warmMs = performance.now() - tWarm0;

  const bootSizes = bytes(cold.body);

  const discoverable = await listPublicDiscoverableBranches();
  const code1 =
    process.env.BOOKING_V2_B9_BRANCH_CODE?.toUpperCase() ||
    discoverable[0]?.branchCode;
  const code2 =
    process.env.BOOKING_V2_B9_BRANCH_CODE_2?.toUpperCase() ||
    discoverable.find((b) => b.branchCode !== code1)?.branchCode ||
    code1;
  if (!code1) {
    console.error('No public branches found');
    process.exit(1);
  }

  const branch1 = discoverable.find((b) => b.branchCode === code1)!;
  const empIds = await listBookableEmployeeIdsForBranch(
    branch1.branchId,
    today,
    { publicOnly: true },
  );
  const empId =
    Number(process.env.BOOKING_V2_B9_EMP_ID ?? 0) || empIds[0] || 0;
  if (!empId) {
    console.error('No public employees found');
    process.exit(1);
  }

  async function matrix(
    label: string,
    req: Parameters<typeof buildPublicAvailabilityMatrix>[0],
  ) {
    const t0 = performance.now();
    const { body, metrics } = await buildPublicAvailabilityMatrix(req);
    const wallMs = performance.now() - t0;
    const sizes = bytes(body);
    console.log(`\n## ${label}`);
    console.log(
      `  days=${body.days.length} json=${kb(sizes.json)} gzip=${kb(sizes.gzip)}`,
    );
    console.log(
      `  wall=${wallMs.toFixed(0)}ms db=${metrics.dbMs}ms compose=${metrics.composeMs}ms queries=${metrics.queryCount}`,
    );
    return { body, metrics, sizes, wallMs };
  }

  console.log('BOOKING V2 B9 FRONTEND READ HARNESS');
  console.log(`today=${today} range=${today}..${to}`);
  console.log(`branches=${code1},${code2} emp=${empId}`);
  console.log('\n## Bootstrap');
  console.log(
    `  revision=${cold.body.revision} branches=${cold.body.branches.length} employees=${cold.body.employees.length}`,
  );
  console.log(
    `  json=${kb(bootSizes.json)} gzip=${kb(bootSizes.gzip)} cold=${coldMs.toFixed(0)}ms warm=${warmMs.toFixed(0)}ms cacheHit=${warm.cacheHit}`,
  );

  await matrix('1 barber × 14 days', {
    employeeId: empId,
    branchCode: code1,
    fromBusinessDate: today,
    toBusinessDate: to,
  });

  await matrix('branch × all barbers × 14 days', {
    branchCode: code1,
    fromBusinessDate: today,
    toBusinessDate: to,
  });

  if (code2 && code2 !== code1) {
    await matrix('multi-branch barber × 14 days (Zeyad scenario)', {
      employeeId: empId,
      branchCodes: [code1, code2],
      fromBusinessDate: today,
      toBusinessDate: to,
    });
  } else {
    console.log('\n## multi-branch skipped (only one public branch)');
  }

  console.log('\nBOOKING V2 FRONTEND READ API VERIFIED (harness)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
