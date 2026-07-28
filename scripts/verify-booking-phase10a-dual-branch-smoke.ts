#!/usr/bin/env npx tsx
/**
 * Phase 10A — live dual-branch public booking smoke (fake customers; cancel all).
 * BOOKING_PHASE_10A_SMOKE=enabled npx tsx scripts/verify-booking-phase10a-dual-branch-smoke.ts
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { performance } from 'perf_hooks';

const BASE = process.env.PUBLIC_BOOKING_PROBE_BASE || 'https://casher-five.vercel.app';
const ORIGIN = 'https://cutsaloon.com';
const SERVICE_ID = 9;
const AHMED = 18;
const PHONE_GLEEM = '01077771111';
const PHONE_CAMP_BARBER = '01077772222';
const PHONE_CAMP_BRANCH = '01077773333';

type Json = Record<string, unknown>;

function redact(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  return s.length <= 12 ? '[redacted]' : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

async function api(
  method: string,
  urlPath: string,
  body?: unknown,
  extra?: Record<string, string>,
) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Origin: ORIGIN,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(extra || {}),
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
  };
}

async function pickSlot(
  branchCode: string,
  mode: 'any_barber' | 'specific_barber',
  empId?: number,
) {
  const days = await api(
    'GET',
    `/api/public/booking/available-days?branchCode=${branchCode}&serviceIds=${SERVICE_ID}${
      empId ? `&empId=${empId}` : ''
    }`,
  );
  if (days.status !== 200) {
    throw new Error(
      `days ${branchCode} emp=${empId ?? 'any'} status=${days.status} code=${((days.json.error as Json) || {}).code}`,
    );
  }
  const cairoToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const dayRows =
    (days.json.days as Array<{ date: string; isAvailable?: boolean; status?: string }>) ||
    [];
  const day =
    dayRows.find((d) => d.isAvailable && d.date > cairoToday) ||
    dayRows.find((d) => d.isAvailable);
  if (!day) {
    throw new Error(
      `no day ${branchCode} emp=${empId ?? 'any'} statuses=${[...new Set(dayRows.map((d) => d.status))].join(',')}`,
    );
  }
  const slotsPath = empId
    ? `/api/public/booking/barbers/${empId}/available-slots?branchCode=${branchCode}&date=${day.date}&serviceIds=${SERVICE_ID}`
    : `/api/public/booking/available-slots?branchCode=${branchCode}&date=${day.date}&serviceIds=${SERVICE_ID}`;
  const slots = await api('GET', slotsPath);
  if (slots.status !== 200) throw new Error(`slots failed ${slots.status}`);
  const now = Date.now();
  const slotRows =
    (slots.json.slots as Array<{ time: string; dayOffset?: number; startDateTime?: string }>) ||
    [];
  const slot =
    slotRows.find(
      (s) =>
        s.startDateTime &&
        new Date(s.startDateTime).getTime() - now >= 45 * 60 * 1000,
    ) || (day.date > cairoToday ? slotRows[0] : undefined);
  if (!slot) throw new Error(`no slot ${branchCode} ${day.date}`);
  return {
    branchCode,
    date: day.date,
    time: slot.time,
    dayOffset: (slot.dayOffset ?? 0) as 0 | 1,
    mode,
    empId: empId ?? null,
    serviceIds: [SERVICE_ID],
  };
}

async function flow(args: {
  label: string;
  branchCode: string;
  mode: 'any_barber' | 'specific_barber';
  empId?: number;
  phone: string;
  name: string;
}) {
  const sel = await pickSlot(args.branchCode, args.mode, args.empId);
  const plan = await api('POST', '/api/public/booking/plan', {
    branchCode: sel.branchCode,
    date: sel.date,
    time: sel.time,
    dayOffset: sel.dayOffset,
    serviceIds: sel.serviceIds,
    mode: sel.mode,
    ...(sel.empId ? { empId: sel.empId } : {}),
  });
  const planToken = String(((plan.json.plan as Json) || {}).planToken || '');
  if (!planToken) throw new Error(`${args.label} no planToken`);
  const idem = `p10a-${args.label}-${crypto.randomUUID()}`;
  const createBody = {
    branchCode: sel.branchCode,
    date: sel.date,
    time: sel.time,
    dayOffset: sel.dayOffset,
    serviceIds: sel.serviceIds,
    mode: sel.mode,
    ...(sel.empId ? { empId: sel.empId } : {}),
    planToken,
    customer: { name: args.name, phone: args.phone },
    clientRequestId: idem,
  };
  const create = await api('POST', '/api/public/booking/create', createBody, {
    'Idempotency-Key': idem,
  });
  const bookingCode = String(
    ((create.json.booking as Json) || {}).code ||
      create.json.bookingCode ||
      '',
  );
  if (create.status !== 201 || !bookingCode) {
    throw new Error(
      `${args.label} create failed ${create.status} ${JSON.stringify(create.json).slice(0, 300)}`,
    );
  }
  const replay = await api('POST', '/api/public/booking/create', createBody, {
    'Idempotency-Key': idem,
  });
  const replayCode = String(
    ((replay.json.booking as Json) || {}).code || '',
  );
  const lookup = await api(
    'GET',
    `/api/public/booking/${encodeURIComponent(bookingCode)}?phone=${encodeURIComponent(args.phone)}`,
  );
  const cancelIdem = `p10a-c-${args.label}-${crypto.randomUUID()}`;
  const cancel = await api(
    'POST',
    '/api/public/booking/cancel',
    { code: bookingCode, phone: args.phone, clientRequestId: cancelIdem },
    { 'Idempotency-Key': cancelIdem },
  );
  // slot release check
  const check = await api('POST', '/api/public/booking/check-slot', {
    branchCode: sel.branchCode,
    date: sel.date,
    time: sel.time,
    dayOffset: sel.dayOffset,
    serviceIds: sel.serviceIds,
    mode: sel.mode,
    ...(sel.empId ? { empId: sel.empId } : {}),
  });
  return {
    label: args.label,
    selected: sel,
    planTokenRedacted: redact(planToken),
    bookingCode,
    createStatus: create.status,
    idempotentReplay: replayCode === bookingCode,
    lookupOk: lookup.status === 200,
    cancelOk: cancel.status < 400,
    slotReleased:
      check.status === 200 &&
      (check.json.available === true ||
        (check.json.slot as Json)?.available === true ||
        String(((check.json as Json).status || '')).includes('available')),
    contract:
      create.headers.get('X-Booking-Contract-Version') ||
      cancel.headers.get('X-Booking-Contract-Version'),
  };
}

async function main() {
  if (process.env.BOOKING_PHASE_10A_SMOKE !== 'enabled') {
    console.error('Set BOOKING_PHASE_10A_SMOKE=enabled');
    process.exit(2);
  }

  const proofs: Record<string, unknown> = {
    phase: 'booking-phase-10a-dual-branch-smoke',
    smokedAt: new Date().toISOString(),
    base: BASE,
  };

  const branches = await api('GET', '/api/public/branches');
  const codes = (
    (branches.json.branches as Array<{ branchCode?: string }>) || []
  ).map((b) => String(b.branchCode || '').toUpperCase());
  proofs.branches = {
    status: branches.status,
    codes,
    hasGleem: codes.includes('GLEEM'),
    hasCamp: codes.includes('CAMP_CAESAR'),
  };

  const gleemServices = await api(
    'GET',
    '/api/public/booking/services?branchCode=GLEEM',
  );
  const campServices = await api(
    'GET',
    '/api/public/booking/services?branchCode=CAMP_CAESAR',
  );
  proofs.services = {
    gleemStatus: gleemServices.status,
    gleemCount: ((gleemServices.json.services as unknown[]) || []).length,
    campStatus: campServices.status,
    campCount: ((campServices.json.services as unknown[]) || []).length,
    campNotPublic:
      String(((campServices.json.error as Json) || {}).code || '') ===
      'BRANCH_NOT_PUBLIC',
  };

  const gleemBarbers = await api(
    'GET',
    `/api/public/booking/barbers?branchCode=GLEEM&serviceIds=${SERVICE_ID}`,
  );
  const campBarbers = await api(
    'GET',
    `/api/public/booking/barbers?branchCode=CAMP_CAESAR&serviceIds=${SERVICE_ID}`,
  );
  const gleemIds = (
    (gleemBarbers.json.barbers as Array<{ empId?: number }>) || []
  ).map((b) => Number(b.empId));
  const campIds = (
    (campBarbers.json.barbers as Array<{ empId?: number }>) || []
  ).map((b) => Number(b.empId));
  proofs.barbers = {
    gleemHasAhmed: gleemIds.includes(AHMED),
    campHasAhmed: campIds.includes(AHMED),
    gleemCount: gleemIds.length,
    campCount: campIds.length,
  };

  // Saturday unavailability for Ahmed at Camp — find next Saturday
  const cairoToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  let sat = new Date(`${cairoToday}T12:00:00Z`);
  while (sat.getUTCDay() !== 6) {
    sat = new Date(sat.getTime() + 24 * 60 * 60 * 1000);
  }
  if (sat.toISOString().slice(0, 10) === cairoToday) {
    sat = new Date(sat.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  const satYmd = sat.toISOString().slice(0, 10);
  const satDays = await api(
    'GET',
    `/api/public/booking/available-days?branchCode=CAMP_CAESAR&serviceIds=${SERVICE_ID}&empId=${AHMED}`,
  );
  const satRow = (
    (satDays.json.days as Array<{ date: string; isAvailable?: boolean; status?: string }>) ||
    []
  ).find((d) => d.date === satYmd);
  proofs.ahmedSaturday = {
    date: satYmd,
    row: satRow || null,
    unavailable: satRow ? satRow.isAvailable !== true : null,
  };

  // Sun–Fri availability sample
  const weekDays = await api(
    'GET',
    `/api/public/booking/available-days?branchCode=CAMP_CAESAR&serviceIds=${SERVICE_ID}&empId=${AHMED}`,
  );
  const availableWorking = (
    (weekDays.json.days as Array<{ date: string; isAvailable?: boolean }>) || []
  ).filter((d) => d.isAvailable);
  proofs.ahmedSunFri = {
    availableCount: availableWorking.length,
    sample: availableWorking.slice(0, 3),
  };

  proofs.gleem_branch_first = await flow({
    label: 'gleem-branch',
    branchCode: 'GLEEM',
    mode: 'any_barber',
    phone: PHONE_GLEEM,
    name: '[SMOKE P10A] Gleem',
  });

  proofs.camp_barber_first = await flow({
    label: 'camp-ahmed',
    branchCode: 'CAMP_CAESAR',
    mode: 'specific_barber',
    empId: AHMED,
    phone: PHONE_CAMP_BARBER,
    name: '[SMOKE P10A] Camp Ahmed',
  });

  proofs.camp_branch_first = await flow({
    label: 'camp-branch',
    branchCode: 'CAMP_CAESAR',
    mode: 'any_barber',
    phone: PHONE_CAMP_BRANCH,
    name: '[SMOKE P10A] Camp Branch',
  });

  const contractProbe = await api('GET', '/api/public/branches');
  proofs.contractModeHeader =
    contractProbe.headers.get('X-Booking-Contract-Version');

  const failed: string[] = [];
  const b = proofs.branches as {
    hasGleem: boolean;
    hasCamp: boolean;
  };
  if (!b.hasGleem || !b.hasCamp) failed.push('branches');
  const s = proofs.services as {
    gleemStatus: number;
    campStatus: number;
    campNotPublic: boolean;
    gleemCount: number;
    campCount: number;
  };
  if (s.gleemStatus !== 200 || s.campStatus !== 200 || s.campNotPublic) {
    failed.push('services');
  }
  if (s.gleemCount < 1 || s.campCount < 1) failed.push('service_counts');
  const bar = proofs.barbers as { gleemHasAhmed: boolean; campHasAhmed: boolean };
  if (bar.gleemHasAhmed) failed.push('gleem_still_has_ahmed');
  if (!bar.campHasAhmed) failed.push('camp_missing_ahmed');
  const satP = proofs.ahmedSaturday as { unavailable: boolean | null };
  if (satP.unavailable !== true) failed.push('ahmed_saturday');
  const sun = proofs.ahmedSunFri as { availableCount: number };
  if (!(sun.availableCount > 0)) failed.push('ahmed_sun_fri');
  for (const key of [
    'gleem_branch_first',
    'camp_barber_first',
    'camp_branch_first',
  ] as const) {
    const f = proofs[key] as {
      createStatus: number;
      idempotentReplay: boolean;
      cancelOk: boolean;
      lookupOk: boolean;
    };
    if (
      !(
        f.createStatus === 201 &&
        f.idempotentReplay &&
        f.cancelOk &&
        f.lookupOk
      )
    ) {
      failed.push(key);
    }
  }
  if (proofs.contractModeHeader !== 'booking-public-v1') {
    failed.push('contract_header');
  }

  const out = {
    phase: 'booking-phase-10a-dual-branch-smoke',
    passed: failed.length === 0,
    failed,
    proofs,
  };
  fs.writeFileSync(
    path.join(process.cwd(), '_booking-phase10a-dual-branch-smoke.json'),
    JSON.stringify(out, null, 2),
    'utf8',
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
