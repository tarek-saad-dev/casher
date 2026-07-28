#!/usr/bin/env npx tsx
/**
 * Phase 10C — local domain probe (DB) for correctness + query/timing.
 * BOOKING_PHASE_10C_DOMAIN=enabled npx tsx scripts/probe-booking-phase10c-cross-branch-domain.ts
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import { performance } from 'perf_hooks';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  if (process.env.BOOKING_PHASE_10C_DOMAIN !== 'enabled') {
    console.log('Set BOOKING_PHASE_10C_DOMAIN=enabled to run.');
    process.exit(0);
  }

  const {
    getPublicCrossBranchBarberAvailability,
    invalidatePublicBookingCrossBranchAvailabilityCache,
  } = await import('../src/lib/booking/publicBookingCrossBranchAvailability');
  const { evaluatePublicBookingSelection } = await import(
    '../src/lib/booking/publicBookingSelectionEvaluator'
  );

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  function addDays(ymd: string, n: number): string {
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function nextSaturday(from: string): string {
    let d = from;
    for (let i = 0; i < 14; i++) {
      if (new Date(`${d}T12:00:00Z`).getDay() === 6) return d;
      d = addDays(d, 1);
    }
    return from;
  }

  const failures: string[] = [];
  const proofs: Record<string, unknown> = {};

  // Warm DB pool + shared catalogs before timed cold (fair cold = warm infra, cold xbranch cache)
  const { getPool } = await import('../src/lib/db');
  await getPool();
  // Prime branch/service caches (not counted as xbranch cold)
  await getPublicCrossBranchBarberAvailability({
    empId: 18,
    serviceIds: [9],
    dateFrom: today,
    days: 1,
  });
  invalidatePublicBookingCrossBranchAvailabilityCache();

  const t0 = performance.now();
  const ahmedCold = await getPublicCrossBranchBarberAvailability({
    empId: 18,
    serviceIds: [9],
    dateFrom: today,
    days: 7,
  });
  const ahmedColdMs = Math.round(performance.now() - t0);

  const t1 = performance.now();
  const ahmedWarm = await getPublicCrossBranchBarberAvailability({
    empId: 18,
    serviceIds: [9],
    dateFrom: today,
    days: 7,
  });
  const ahmedWarmMs = Math.round(performance.now() - t1);

  proofs.ahmed = {
    coldMs: ahmedColdMs,
    warmMs: ahmedWarmMs,
    branches: ahmedCold.branches.map((b) => b.branchCode),
    slotBranches: [...new Set(ahmedCold.slots.map((s) => s.branchCode))],
    queryCount: ahmedCold.meta.queryCount,
    timingMs: ahmedCold.meta.timingMs,
    cacheHitWarm: ahmedWarm.meta.cacheHit,
    slotCount: ahmedCold.meta.slotCount,
  };

  if (!ahmedCold.branches.some((b) => b.branchCode === 'CAMP_CAESAR')) {
    failures.push('Ahmed missing CAMP_CAESAR');
  }
  if (ahmedCold.branches.some((b) => b.branchCode === 'GLEEM')) {
    failures.push('Ahmed unexpectedly has GLEEM');
  }

  const sat = nextSaturday(today);
  const ahmedSat = await getPublicCrossBranchBarberAvailability({
    empId: 18,
    serviceIds: [9],
    dateFrom: sat,
    days: 1,
  });
  const satSlots = ahmedSat.slots.filter((s) => s.date === sat);
  proofs.ahmedSaturday = { date: sat, slotCount: satSlots.length };
  if (satSlots.length > 0) failures.push(`Ahmed Saturday slots on ${sat}`);

  invalidatePublicBookingCrossBranchAvailabilityCache();
  const ziad = await getPublicCrossBranchBarberAvailability({
    empId: 12,
    serviceIds: [9],
    dateFrom: today,
    days: 7,
  });
  proofs.ziad = {
    branches: ziad.branches.map((b) => b.branchCode),
    slotBranches: [...new Set(ziad.slots.map((s) => s.branchCode))],
    queryCount: ziad.meta.queryCount,
    timingMs: ziad.meta.timingMs,
    slotCount: ziad.meta.slotCount,
  };
  const zb = ziad.branches.map((b) => b.branchCode);
  if (!zb.includes('GLEEM') || !zb.includes('CAMP_CAESAR')) {
    failures.push(`Ziad branches expected GLEEM+CAMP got ${zb.join(',')}`);
  }

  const sample = ahmedCold.slots.find((s) => s.branchCode === 'CAMP_CAESAR');
  if (sample) {
    const plan = await evaluatePublicBookingSelection({
      branchCode: sample.branchCode,
      date: sample.date,
      time: sample.time,
      dayOffset: sample.dayOffset,
      serviceIds: [9],
      empId: 18,
      mode: 'specific_barber',
      purpose: 'plan',
    });
    proofs.planParity = {
      available: plan.available,
      sample: {
        branchCode: sample.branchCode,
        date: sample.date,
        time: sample.time,
        dayOffset: sample.dayOffset,
      },
    };
    if (!plan.available) failures.push('slot→plan parity failed');
  } else {
    proofs.planParity = { skipped: true };
  }

  // No BranchID on wire object
  const wire = JSON.stringify({
    barber: ahmedCold.barber,
    branches: ahmedCold.branches,
    days: ahmedCold.days,
    slots: ahmedCold.slots,
  });
  if (/branchId|BranchID/i.test(wire)) failures.push('wire leaked BranchID');

  proofs.timingTargets = {
    coldUnder3s: ahmedColdMs < 3000,
    warmUnder1_2s: ahmedWarmMs < 1200,
  };
  if (ahmedColdMs >= 3000) failures.push('cold >= 3s');
  if (ahmedWarmMs >= 1200) failures.push('warm >= 1.2s');

  const artifact = {
    phase: 'booking-phase-10c-domain-probe',
    generatedAt: new Date().toISOString(),
    passed: failures.length === 0,
    failures,
    proofs,
  };
  const out = path.join(process.cwd(), '_booking-phase10c-domain-probe.json');
  fs.writeFileSync(out, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify(artifact, null, 2));
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
