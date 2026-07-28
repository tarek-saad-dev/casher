#!/usr/bin/env npx tsx
/**
 * Phase 10C — live cross-branch barber availability smoke + timing.
 * BOOKING_PHASE_10C_SMOKE=enabled npx tsx scripts/verify-booking-phase10c-cross-branch-availability.ts
 */
import path from 'path';
import fs from 'fs';
import { performance } from 'perf_hooks';

const BASE = process.env.PUBLIC_BOOKING_PROBE_BASE || 'https://casher-five.vercel.app';
const ORIGIN = 'https://cutsaloon.com';
const SERVICE_ID = 9;
const AHMED = 18;
const ZIAD = 12;

type Json = Record<string, unknown>;

function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function nextSaturday(from: string): string {
  let d = from;
  for (let i = 0; i < 14; i++) {
    const dow = new Date(`${d}T12:00:00Z`).getDay();
    if (dow === 6) return d;
    d = addDays(d, 1);
  }
  return from;
}

async function api(method: string, urlPath: string, body?: unknown) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Origin: ORIGIN,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const text = await res.text();
  let json: Json = {};
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return {
    status: res.status,
    headers: res.headers,
    json,
    ms: Math.round(performance.now() - t0),
    contract: res.headers.get('X-Booking-Contract-Version'),
  };
}

async function xbranch(empId: number, dateFrom: string, days: number) {
  return api(
    'POST',
    `/api/public/booking/barbers/${empId}/cross-branch-availability`,
    { serviceIds: [SERVICE_ID], dateFrom, days },
  );
}

function branchCodes(resp: Json): string[] {
  const branches = (resp.branches as Array<{ branchCode: string }>) || [];
  return branches.map((b) => b.branchCode).sort();
}

function slotBranchCodes(resp: Json): string[] {
  const slots = (resp.slots as Array<{ branchCode: string }>) || [];
  return [...new Set(slots.map((s) => s.branchCode))].sort();
}

async function main() {
  if (process.env.BOOKING_PHASE_10C_SMOKE !== 'enabled') {
    console.log('Set BOOKING_PHASE_10C_SMOKE=enabled to run.');
    process.exit(0);
  }

  const today = cairoToday();
  const proofs: Record<string, unknown> = {};
  const failures: string[] = [];

  // OPTIONS CORS
  const opt = await api(
    'OPTIONS',
    `/api/public/booking/barbers/${AHMED}/cross-branch-availability`,
  );
  proofs.options = {
    status: opt.status,
    acam: opt.headers.get('Access-Control-Allow-Methods'),
  };

  // Cold Ahmed
  const ahmedCold = await xbranch(AHMED, today, 7);
  const ahmedMeta = (ahmedCold.json.meta as Json) || {};
  proofs.ahmedCold = {
    status: ahmedCold.status,
    ms: ahmedCold.ms,
    branches: branchCodes(ahmedCold.json),
    slotBranches: slotBranchCodes(ahmedCold.json),
    queryCount: ahmedMeta.queryCount,
    timingMs: ahmedMeta.timingMs,
    contractHeader: ahmedCold.contract,
  };
  if (ahmedCold.status !== 200) failures.push(`ahmed cold status ${ahmedCold.status}`);
  if (!branchCodes(ahmedCold.json).includes('CAMP_CAESAR')) {
    failures.push('ahmed missing CAMP_CAESAR');
  }
  if (branchCodes(ahmedCold.json).includes('GLEEM')) {
    failures.push('ahmed unexpectedly includes GLEEM');
  }

  // Warm Ahmed
  const ahmedWarm = await xbranch(AHMED, today, 7);
  proofs.ahmedWarm = {
    status: ahmedWarm.status,
    ms: ahmedWarm.ms,
    cacheHit: ((ahmedWarm.json.meta as Json) || {}).cacheHit,
    queryCount: ((ahmedWarm.json.meta as Json) || {}).queryCount,
  };
  if (ahmedWarm.status !== 200) failures.push(`ahmed warm status ${ahmedWarm.status}`);

  // Saturday — Ahmed should have no Camp slots that day
  const sat = nextSaturday(today);
  const ahmedSat = await xbranch(AHMED, sat, 1);
  const satSlots = ((ahmedSat.json.slots as Array<{ date: string }>) || []).filter(
    (s) => s.date === sat,
  );
  proofs.ahmedSaturday = {
    date: sat,
    status: ahmedSat.status,
    slotCount: satSlots.length,
    branches: branchCodes(ahmedSat.json),
  };
  if (satSlots.length > 0) failures.push(`ahmed has Saturday slots on ${sat}`);

  // Ziad — expect GLEEM + Camp when assigned
  const ziadCold = await xbranch(ZIAD, today, 7);
  proofs.ziadCold = {
    status: ziadCold.status,
    ms: ziadCold.ms,
    branches: branchCodes(ziadCold.json),
    slotBranches: slotBranchCodes(ziadCold.json),
    queryCount: ((ziadCold.json.meta as Json) || {}).queryCount,
  };
  if (ziadCold.status !== 200) failures.push(`ziad cold status ${ziadCold.status}`);
  const ziadBranches = branchCodes(ziadCold.json);
  if (!ziadBranches.includes('GLEEM') || !ziadBranches.includes('CAMP_CAESAR')) {
    failures.push(`ziad branches expected GLEEM+CAMP_CAESAR got ${ziadBranches.join(',')}`);
  }

  // Slot → plan parity (first Ahmed Camp slot)
  const slots = (ahmedCold.json.slots as Array<{
    branchCode: string;
    branchName: string;
    date: string;
    time: string;
    dayOffset: 0 | 1;
  }>) || [];
  const sample = slots.find((s) => s.branchCode === 'CAMP_CAESAR');
  if (sample) {
    const plan = await api('POST', '/api/public/booking/plan', {
      branchCode: sample.branchCode,
      date: sample.date,
      time: sample.time,
      dayOffset: sample.dayOffset,
      serviceIds: [SERVICE_ID],
      empId: AHMED,
      mode: 'specific_barber',
    });
    proofs.planParity = {
      status: plan.status,
      available: (plan.json as Json).ok === true,
      sample: {
        branchCode: sample.branchCode,
        date: sample.date,
        time: sample.time,
        dayOffset: sample.dayOffset,
      },
    };
    if (plan.status !== 200 || (plan.json as Json).ok !== true) {
      failures.push('slot→plan parity failed for Ahmed Camp sample');
    }
  } else {
    proofs.planParity = { skipped: true, reason: 'no Ahmed Camp slots in window' };
  }

  // Wire must not leak BranchID
  const blob = JSON.stringify(ahmedCold.json);
  if (/"branchId"\s*:/i.test(blob) || /"BranchID"\s*:/.test(blob)) {
    failures.push('response leaked branchId');
  }

  const coldOk =
    typeof proofs.ahmedCold === 'object' &&
    proofs.ahmedCold !== null &&
    (proofs.ahmedCold as Json).ms != null &&
    Number((proofs.ahmedCold as Json).ms) < 3000;
  const warmOk =
    typeof proofs.ahmedWarm === 'object' &&
    proofs.ahmedWarm !== null &&
    (proofs.ahmedWarm as Json).ms != null &&
    Number((proofs.ahmedWarm as Json).ms) < 1200;

  proofs.timingTargets = {
    coldUnder3s: coldOk,
    warmUnder1_2s: warmOk,
    ahmedColdMs: (proofs.ahmedCold as Json).ms,
    ahmedWarmMs: (proofs.ahmedWarm as Json).ms,
  };
  if (!coldOk) failures.push('cold timing >= 3s');
  if (!warmOk) failures.push('warm timing >= 1.2s');

  const artifact = {
    phase: 'booking-phase-10c-cross-branch-availability',
    generatedAt: new Date().toISOString(),
    base: BASE,
    passed: failures.length === 0,
    failures,
    proofs,
  };

  const out = path.join(process.cwd(), '_booking-phase10c-cross-branch-availability.json');
  fs.writeFileSync(out, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify(artifact, null, 2));
  console.log(`Wrote ${out}`);
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
