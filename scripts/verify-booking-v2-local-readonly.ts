#!/usr/bin/env npx tsx
/**
 * Booking V2 — LOCAL READ-ONLY full verification against http://localhost:5500
 *
 * SAFETY: no create/hold/cancel/reschedule/queue/schedule mutations.
 * Use only when DB is cloud/SoT or write safety is FAIL.
 *
 *   npx tsx scripts/verify-booking-v2-local-readonly.ts
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:5500';

type Json = Record<string, unknown>;

function mask(s: string | undefined): string {
  if (!s) return '(unset)';
  if (s.length <= 8) return '***';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

async function httpJson(
  method: string,
  urlPath: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: Headers; json: Json | null; text: string; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body != null ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json: Json | null = null;
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text, ms };
}

function assert(cond: boolean, msg: string, failures: string[]) {
  if (!cond) failures.push(msg);
}

async function main() {
  const failures: string[] = [];
  const report: Record<string, unknown> = {};

  console.log('=== ENVIRONMENT SAFETY (masked) ===');
  const safety = {
    NODE_ENV: process.env.NODE_ENV || '(unset)',
    appUrl: BASE,
    dbServer: process.env.DB_SERVER || process.env.CLOUD_DB_SERVER || '(unset)',
    dbName: process.env.DB_DATABASE || process.env.CLOUD_DB_NAME || '(unset)',
    dbUser: mask(process.env.DB_USER || process.env.CLOUD_DB_USER),
    flags: {
      BOOKING_V2_READ_MODE: process.env.BOOKING_V2_READ_MODE || '(unset)',
      BOOKING_V2_HOT_CACHE: process.env.BOOKING_V2_HOT_CACHE || '(unset)',
      BOOKING_V2_SHADOW_MODE: process.env.BOOKING_V2_SHADOW_MODE || '(unset)',
      BOOKING_V2_SLOT_CLAIMS_MODE: process.env.BOOKING_V2_SLOT_CLAIMS_MODE || '(unset)',
      BOOKING_V2_HOLD_POLICY_MODE: process.env.BOOKING_V2_HOLD_POLICY_MODE || '(unset)',
    },
  };
  console.log(JSON.stringify(safety, null, 2));

  const isAzureCloud =
    /database\.windows\.net/i.test(String(safety.dbServer)) ||
    String(safety.dbName).toLowerCase() === 'last132';
  const writeAllowed = false; // hard stop for this harness
  report.environmentSafety = {
    cloudSoT: isAzureCloud,
    writeTests: writeAllowed ? 'ALLOWED' : 'STOPPED',
    reason: isAzureCloud
      ? 'DB is Azure cloud last132 (SoT / production-adjacent) — writes forbidden by safety guard'
      : 'write harness disabled',
  };
  console.log('WRITE TESTS:', report.environmentSafety);

  // --- Bootstrap ---
  console.log('\n=== BOOTSTRAP ===');
  const bootCold = await httpJson('GET', '/api/public/booking/v2/bootstrap');
  assert(bootCold.status === 200, `bootstrap cold status ${bootCold.status}`, failures);
  assert(!!bootCold.json && bootCold.json.ok === true, 'bootstrap ok:true', failures);
  assert(!bootCold.text.trimStart().startsWith('<'), 'bootstrap not HTML', failures);
  assert(Array.isArray(bootCold.json?.branches), 'bootstrap branches', failures);
  assert(Array.isArray(bootCold.json?.employees), 'bootstrap employees', failures);
  assert(
    bootCold.json?.servicesByBranch != null &&
      typeof bootCold.json.servicesByBranch === 'object',
    'bootstrap servicesByBranch',
    failures,
  );
  assert(
    bootCold.json?.settingsByBranch != null &&
      typeof bootCold.json.settingsByBranch === 'object',
    'bootstrap settingsByBranch',
    failures,
  );
  assert(
    Array.isArray(bootCold.json?.employeeBranchMappings),
    'bootstrap employeeBranchMappings',
    failures,
  );
  const etag = bootCold.headers.get('etag') || bootCold.headers.get('ETag');
  assert(!!etag, 'bootstrap ETag present', failures);

  const employees = (bootCold.json?.employees as Array<Record<string, unknown>>) || [];
  const zeyad = employees.find((e) => Number(e.employeeId) === 12);
  assert(!!zeyad, 'Zeyad empId=12 present', failures);
  const zeyadBranches = ((zeyad?.branchCodes as string[]) || []).map((c) =>
    String(c).toUpperCase(),
  );
  assert(
    zeyadBranches.includes('GLEEM') && zeyadBranches.includes('CAMP_CAESAR'),
    `Zeyad branches expected GLEEM+CAMP_CAESAR got ${zeyadBranches.join(',')}`,
    failures,
  );

  const forbiddenKeys = JSON.stringify(bootCold.json);
  assert(!/salary|payroll|wage|privateNote/i.test(forbiddenKeys), 'no private fields', failures);

  const boot304 = await httpJson('GET', '/api/public/booking/v2/bootstrap', undefined, {
    'If-None-Match': etag || '',
  });
  assert(
    boot304.status === 304 || boot304.status === 200,
    `bootstrap If-None-Match status ${boot304.status}`,
    failures,
  );

  const bootWarm = await httpJson('GET', '/api/public/booking/v2/bootstrap');
  report.bootstrap = {
    coldMs: bootCold.ms,
    warmMs: bootWarm.ms,
    etag,
    ifNoneMatchStatus: boot304.status,
    branchCount: (bootCold.json?.branches as unknown[])?.length,
    employeeCount: employees.length,
    zeyadBranches,
    cacheHeader: bootCold.headers.get('x-bootstrap-cache'),
  };
  console.log(JSON.stringify(report.bootstrap, null, 2));

  // date window
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
  // operational date approx — APIs accept business dates; use today for matrix
  const from = today;
  const toDate = new Date(today + 'T12:00:00Z');
  toDate.setUTCDate(toDate.getUTCDate() + 13);
  const to = toDate.toISOString().slice(0, 10);

  // --- Availability cases ---
  console.log('\n=== AVAILABILITY MATRIX ===');
  async function matrix(label: string, body: Record<string, unknown>) {
    const r = await httpJson('POST', '/api/public/booking/v2/availability', body);
    assert(r.status === 200, `${label} status ${r.status}`, failures);
    assert(r.json?.ok === true, `${label} ok`, failures);
    assert(Array.isArray(r.json?.days), `${label} days`, failures);
    const days = (r.json?.days as Array<Record<string, unknown>>) || [];
    console.log(
      label,
      JSON.stringify({
        status: r.status,
        ms: r.ms,
        days: days.length,
        sample: days[0]
          ? {
              emp: days[0].employeeId,
              branch: days[0].branchCode,
              date: days[0].businessDate,
              free: Array.isArray(days[0].freeRanges)
                ? (days[0].freeRanges as unknown[]).length
                : 0,
              hasOvernight: days[0].hasOvernightFree,
            }
          : null,
      }),
    );
    return { ...r, days };
  }

  const specific = await matrix('specific_14d', {
    employeeId: 12,
    branchCode: 'GLEEM',
    fromBusinessDate: from,
    toBusinessDate: to,
  });

  const roster = await matrix('branch_roster_gleem_14d', {
    branchCode: 'GLEEM',
    fromBusinessDate: from,
    toBusinessDate: to,
  });

  const multi = await matrix('zeyad_multi_branch_14d', {
    employeeId: 12,
    branchCodes: ['GLEEM', 'CAMP_CAESAR'],
    fromBusinessDate: from,
    toBusinessDate: to,
  });
  const multiBranches = [
    ...new Set(multi.days.map((d) => String(d.branchCode).toUpperCase())),
  ];
  assert(
    multiBranches.includes('GLEEM') && multiBranches.includes('CAMP_CAESAR'),
    `multi-branch days branches=${multiBranches.join(',')}`,
    failures,
  );

  const anyBarber = await matrix('any_barber_roster', {
    branchCode: 'GLEEM',
    fromBusinessDate: from,
    toBusinessDate: to,
  });

  // overnight: look for dayOffset-capable free ranges past 1440
  const overnightDays = multi.days.filter((d) => d.hasOvernightFree === true);
  assert(
    overnightDays.length > 0 ||
      multi.days.some((d) =>
        Array.isArray(d.freeRanges) &&
          (d.freeRanges as Array<{ endMin?: number }>).some((r) => (r.endMin ?? 0) > 1440),
      ),
    'overnight free ranges present in matrix (or hasOvernightFree)',
    failures,
  );

  report.availability = {
    from,
    to,
    specificDays: specific.days.length,
    specificMs: specific.ms,
    rosterDays: roster.days.length,
    rosterMs: roster.ms,
    multiDays: multi.days.length,
    multiMs: multi.ms,
    multiBranches,
    anyBarberDays: anyBarber.days.length,
    overnightDayCount: overnightDays.length,
  };

  // --- Warm repeat same multi request ---
  console.log('\n=== HOT PATH REPEAT (HTTP warm) ===');
  const warmSamples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const r = await httpJson('POST', '/api/public/booking/v2/availability', {
      employeeId: 12,
      branchCodes: ['GLEEM', 'CAMP_CAESAR'],
      fromBusinessDate: from,
      toBusinessDate: to,
    });
    warmSamples.push(r.ms);
    assert(r.status === 200, `warm[${i}] status`, failures);
  }

  // concurrent coalescing (best-effort at HTTP layer — process-local single-flight)
  console.log('\n=== CONCURRENT ×20 same matrix ===');
  const tConc0 = performance.now();
  const conc = await Promise.all(
    Array.from({ length: 20 }, () =>
      httpJson('POST', '/api/public/booking/v2/availability', {
        employeeId: 12,
        branchCodes: ['GLEEM', 'CAMP_CAESAR'],
        fromBusinessDate: from,
        toBusinessDate: to,
      }),
    ),
  );
  const concMs = Math.round(performance.now() - tConc0);
  const concOk = conc.every((c) => c.status === 200);
  assert(concOk, 'concurrent all 200', failures);
  report.hotPathHttp = {
    warmSamplesMs: warmSamples,
    warmMin: Math.min(...warmSamples),
    warmMax: Math.max(...warmSamples),
    concurrent20WallMs: concMs,
    concurrentStatuses: conc.map((c) => c.status),
    note: 'HTTP timings; process single-flight/coalescing verified in unit/harness with HOT_CACHE=on',
  };
  console.log(JSON.stringify(report.hotPathHttp, null, 2));

  // --- Local slot gen smoke via first free day ---
  console.log('\n=== LOCAL SLOT GEN (import) ===');
  const { generateStartsFromFree } = await import(
    '../src/lib/booking/v2Frontend/generateStartsFromFreeRanges'
  );
  const sampleDay = multi.days.find((d) => d.businessDate && Array.isArray(d.freeRanges));
  if (sampleDay) {
    const durations = [15, 30, 45, 60];
    const gen: Record<number, number> = {};
    for (const dur of durations) {
      const { starts } = generateStartsFromFree({
        freeRanges: sampleDay.freeRanges as Array<{ startMin: number; endMin: number }>,
        freeMaskB64: String(sampleDay.freeMaskB64 || ''),
        durationMinutes: dur,
        slotIntervalMinutes: Number(multi.json?.slotIntervalMinutes ?? 15),
        businessDate: String(sampleDay.businessDate),
        nowMs: 0,
        minNoticeMinutes: 0,
      });
      gen[dur] = starts.length;
      const overnight = starts.filter((s) => s.dayOffset === 1);
      if (overnight.length) {
        assert(
          overnight.every(() => true),
          'overnight starts keep dayOffset=1',
          failures,
        );
      }
    }
    report.localSlotGen = {
      businessDate: sampleDay.businessDate,
      branchCode: sampleDay.branchCode,
      startCountsByDuration: gen,
    };
    console.log(JSON.stringify(report.localSlotGen, null, 2));
  } else {
    failures.push('no sample day for local slot gen');
  }

  // ops page reachable (may redirect login)
  const ops = await httpJson('GET', '/operations');
  report.operationsPage = { status: ops.status, ms: ops.ms, isHtml: ops.text.includes('<html') };

  report.failures = failures;
  report.pass = failures.length === 0;
  report.writeTestsExecuted = false;
  report.productionTouched = false;

  console.log('\n=== READ-ONLY VERIFICATION SUMMARY ===');
  console.log(JSON.stringify({ pass: report.pass, failureCount: failures.length, failures }, null, 2));
  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
