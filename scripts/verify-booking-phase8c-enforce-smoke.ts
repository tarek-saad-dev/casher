#!/usr/bin/env npx tsx
/**
 * Phase 8C — enforce-mode final live smoke.
 * BOOKING_PHASE_8C_SMOKE=enabled npx tsx scripts/verify-booking-phase8c-enforce-smoke.ts
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { performance } from 'perf_hooks';

const BASE = process.env.PUBLIC_BOOKING_PROBE_BASE || 'https://casher-five.vercel.app';
const ORIGIN = 'https://cutsaloon.com';
const SERVICE_ID = 9;
const PHONE_BRANCH = '01088881111';
const PHONE_BARBER = '01088882222';

type Json = Record<string, unknown>;

function redact(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  return s.length <= 12 ? '[redacted]' : `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function api(
  method: string,
  urlPath: string,
  body?: unknown,
  extra?: Record<string, string>,
): Promise<{ status: number; headers: Headers; json: Json; ms: number }> {
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
  return { status: res.status, headers: res.headers, json, ms: Math.round(performance.now() - t0) };
}

async function pickSlot(mode: 'any_barber' | 'specific_barber', empId?: number) {
  const days = await api(
    'GET',
    `/api/public/booking/available-days?branchCode=GLEEM&serviceIds=${SERVICE_ID}${
      empId ? `&empId=${empId}` : ''
    }`,
  );
  if (days.status !== 200) {
    throw new Error(
      `days failed ${days.status} code=${String(((days.json.error as Json) || {}).code || '')} empId=${empId ?? 'any'}`,
    );
  }
  const dayRows =
    (days.json.days as Array<{
      date: string;
      isAvailable?: boolean;
      status?: string;
    }>) || [];
  // Prefer future days; fall back to any available (slot filter enforces cancel window).
  const cairoToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const day =
    dayRows.find((d) => d.isAvailable && d.date > cairoToday) ||
    dayRows.find((d) => d.isAvailable);
  if (!day) {
    const statuses = [...new Set(dayRows.map((d) => d.status))];
    throw new Error(
      `no available day empId=${empId ?? 'any'} statuses=${statuses.join(',')} count=${dayRows.length}`,
    );
  }

  const slotsPath = empId
    ? `/api/public/booking/barbers/${empId}/available-slots?branchCode=GLEEM&date=${day.date}&serviceIds=${SERVICE_ID}`
    : `/api/public/booking/available-slots?branchCode=GLEEM&date=${day.date}&serviceIds=${SERVICE_ID}`;
  const slots = await api('GET', slotsPath);
  if (slots.status !== 200) {
    throw new Error(`slots failed ${slots.status} empId=${empId ?? 'any'}`);
  }
  const now = Date.now();
  const slotRows =
    (slots.json.slots as Array<{
      time: string;
      dayOffset?: number;
      startDateTime?: string;
    }>) || [];
  const slot =
    slotRows.find(
      (s) =>
        s.startDateTime &&
        new Date(s.startDateTime).getTime() - now >= 45 * 60 * 1000,
    ) ||
    (day.date > cairoToday ? slotRows[0] : undefined);
  if (!slot) {
    throw new Error(
      `no slot outside cancel window empId=${empId ?? 'any'} date=${day.date} slotCount=${slotRows.length}`,
    );
  }
  return {
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
  mode: 'any_barber' | 'specific_barber';
  empId?: number;
  phone: string;
  name: string;
}) {
  const sel = await pickSlot(args.mode, args.empId);
  const bodyBase = {
    branchCode: 'GLEEM',
    date: sel.date,
    time: sel.time,
    dayOffset: sel.dayOffset,
    serviceIds: sel.serviceIds,
    mode: sel.mode,
    ...(sel.empId ? { empId: sel.empId } : {}),
  };

  const check = await api('POST', '/api/public/booking/check-slot', bodyBase);
  assert(
    check.status === 200 && check.json.available === true,
    `${args.label} check-slot unavailable`,
  );

  const plan = await api('POST', '/api/public/booking/plan', bodyBase);
  const planObj = (plan.json.plan as Json) || {};
  const planToken = String(planObj.planToken || plan.json.planToken || '');
  assert(plan.status === 200 && planToken, `${args.label} plan missing token`);

  const createKey = `p8c-${args.label}-c-${crypto.randomUUID()}`;
  const createBody = {
    ...bodyBase,
    planToken,
    customer: { name: args.name, phone: args.phone },
    clientRequestId: createKey,
    suppressNotification: true,
  };
  const created = await api('POST', '/api/public/booking/create', createBody, {
    'Idempotency-Key': createKey,
  });
  const booking = (created.json.booking as Json) || {};
  const code = String(booking.code || '');
  const accessToken = String(booking.bookingAccessToken || '');
  assert(
    (created.status === 201 || created.status === 200) && code,
    `${args.label} create failed: ${JSON.stringify(created.json).slice(0, 300)}`,
  );

  const replay = await api('POST', '/api/public/booking/create', createBody, {
    'Idempotency-Key': createKey,
  });
  const replayCode = String(((replay.json.booking as Json) || {}).code || '');
  const replayMeta = (replay.json.meta as Json) || {};
  assert(
    replayCode === code && replayMeta.idempotentReplay === true,
    `${args.label} replay mismatch`,
  );

  const lookup = await api(
    'GET',
    `/api/public/booking/${encodeURIComponent(code)}?accessToken=${encodeURIComponent(accessToken)}`,
  );
  assert(
    lookup.status === 200 &&
      String(((lookup.json.booking as Json) || {}).code || '') === code,
    `${args.label} lookup failed`,
  );

  const cancelKey = `p8c-${args.label}-x-${crypto.randomUUID()}`;
  const cancelBody = {
    code,
    phone: args.phone,
    accessToken,
    clientRequestId: cancelKey,
  };
  const cancelled = await api('POST', '/api/public/booking/cancel', cancelBody, {
    'Idempotency-Key': cancelKey,
  });
  assert(
    cancelled.status === 200 &&
      (cancelled.json.ok === true ||
        String(((cancelled.json.booking as Json) || {}).status || '') ===
          'cancelled'),
    `${args.label} cancel failed: ${JSON.stringify(cancelled.json).slice(0, 300)}`,
  );

  const cancelReplay = await api(
    'POST',
    '/api/public/booking/cancel',
    cancelBody,
    { 'Idempotency-Key': cancelKey },
  );
  assert(
    cancelReplay.status === 200,
    `${args.label} cancel replay failed`,
  );

  const lookupAfter = await api(
    'GET',
    `/api/public/booking/${encodeURIComponent(code)}?accessToken=${encodeURIComponent(accessToken)}`,
  );
  const afterStatus = String(
    (((lookupAfter.json.booking as Json) || {}).status as string) || '',
  );

  return {
    label: args.label,
    selected: sel,
    planTokenRedacted: redact(planToken),
    bookingCode: code,
    createStatus: created.status,
    idempotentReplay: true,
    lookupOk: true,
    cancelOk: true,
    cancelReplayOk: cancelReplay.status === 200,
    lookupCancelled: afterStatus === 'cancelled',
    timings: {
      check_ms: check.ms,
      plan_ms: plan.ms,
      create_ms: created.ms,
      replay_ms: replay.ms,
      cancel_ms: cancelled.ms,
    },
  };
}

async function main() {
  if (process.env.BOOKING_PHASE_8C_SMOKE !== 'enabled') {
    console.log('Set BOOKING_PHASE_8C_SMOKE=enabled to run.');
    process.exit(2);
  }

  const proofs: Record<string, unknown> = {
    phase: 'booking-phase-8c-enforce-smoke',
    smokedAt: new Date().toISOString(),
    base: BASE,
  };

  // CORS / expose
  const branches = await api('GET', '/api/public/branches');
  proofs.branches_ok =
    branches.status === 200 &&
    ((branches.json.branches as Array<{ branchCode?: string }>) || []).some(
      (b) => b.branchCode === 'GLEEM',
    );
  proofs.branchCodes = (
    (branches.json.branches as Array<{ branchCode?: string }>) || []
  ).map((b) => b.branchCode);
  proofs.cors_expose =
    (branches.headers.get('Access-Control-Expose-Headers') || '').includes(
      'X-Booking-Contract-Version',
    );
  proofs.contract_version =
    branches.headers.get('X-Booking-Contract-Version') === 'booking-public-v1';

  // Enforce rejection: no planToken
  const rejPlan = await api('POST', '/api/public/booking/create', {
    branchCode: 'GLEEM',
    date: '2026-07-29',
    time: '12:00',
    dayOffset: 0,
    serviceIds: [SERVICE_ID],
    mode: 'any_barber',
    customer: { name: '[SMOKE P8C]', phone: PHONE_BRANCH },
    clientRequestId: `p8c-rej-plan-${crypto.randomUUID()}`,
  });
  proofs.reject_no_planToken =
    rejPlan.status === 400 &&
    String(((rejPlan.json.error as Json) || {}).code || '') ===
      'PLAN_TOKEN_REQUIRED';

  // Enforce rejection: planToken but no idempotency
  // Need a real plan token first for this path — use a disposable plan
  const selTmp = await pickSlot('any_barber');
  const planTmp = await api('POST', '/api/public/booking/plan', {
    branchCode: 'GLEEM',
    date: selTmp.date,
    time: selTmp.time,
    dayOffset: selTmp.dayOffset,
    serviceIds: selTmp.serviceIds,
    mode: 'any_barber',
  });
  const tokenTmp = String(
    ((planTmp.json.plan as Json) || {}).planToken || '',
  );
  const rejIdem = await api('POST', '/api/public/booking/create', {
    branchCode: 'GLEEM',
    date: selTmp.date,
    time: selTmp.time,
    dayOffset: selTmp.dayOffset,
    serviceIds: selTmp.serviceIds,
    mode: 'any_barber',
    planToken: tokenTmp,
    customer: { name: '[SMOKE P8C]', phone: PHONE_BRANCH },
  });
  proofs.reject_no_idempotency =
    rejIdem.status === 400 &&
    String(((rejIdem.json.error as Json) || {}).code || '') ===
      'IDEMPOTENCY_KEY_REQUIRED';

  // Cancel without idempotency (valid-format code so normalization passes first)
  const rejCancel = await api('POST', '/api/public/booking/cancel', {
    code: 'BK-ZZZZZZ',
    phone: PHONE_BRANCH,
  });
  proofs.reject_cancel_no_idempotency =
    rejCancel.status === 400 &&
    String(((rejCancel.json.error as Json) || {}).code || '') ===
      'IDEMPOTENCY_KEY_REQUIRED';
  proofs.reject_cancel_detail = {
    status: rejCancel.status,
    code: String(((rejCancel.json.error as Json) || {}).code || ''),
  };

  proofs.enforce_active =
    proofs.reject_no_planToken === true &&
    proofs.reject_no_idempotency === true;

  // Branch-first flow
  proofs.branch_first = await flow({
    label: 'branch',
    mode: 'any_barber',
    phone: PHONE_BRANCH,
    name: '[SMOKE P8C] Branch',
  });

  // Barber-first: try barbers until one has availability
  const barbers = await api(
    'GET',
    `/api/public/booking/barbers?branchCode=GLEEM&serviceIds=${SERVICE_ID}`,
  );
  const barList =
    (barbers.json.barbers as Array<{ empId?: number }>) || [];
  let barberFlow: Record<string, unknown> | null = null;
  const barberErrors: string[] = [];
  for (const b of barList) {
    const empId = Number(b.empId);
    if (!(empId > 0)) continue;
    try {
      barberFlow = await flow({
        label: `barber-${empId}`,
        mode: 'specific_barber',
        empId,
        phone: PHONE_BARBER,
        name: '[SMOKE P8C] Barber',
      });
      break;
    } catch (err) {
      barberErrors.push(
        `empId=${empId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  assert(barberFlow, `no barber-first success: ${barberErrors.join(' | ')}`);
  proofs.barber_first = barberFlow;
  proofs.barber_first_attempts = barberErrors;

  // Camp Caesar
  const camp = await api(
    'GET',
    '/api/public/booking/config?branchCode=CAMP_CAESAR',
  );
  proofs.camp_caesar_hidden =
    camp.status === 404 &&
    String(((camp.json.error as Json) || {}).code || '') ===
      'BRANCH_NOT_PUBLIC';

  const bf = proofs.branch_first as Record<string, unknown>;
  const sp = proofs.barber_first as Record<string, unknown>;
  const required = [
    'enforce_active',
    'branches_ok',
    'cors_expose',
    'contract_version',
    'reject_no_planToken',
    'reject_no_idempotency',
    'reject_cancel_no_idempotency',
    'camp_caesar_hidden',
  ] as const;
  const failed = required.filter((k) => !proofs[k]);
  if (!bf.lookupCancelled || !bf.cancelOk || !bf.idempotentReplay) {
    failed.push('branch_first' as never);
  }
  if (!sp.lookupCancelled || !sp.cancelOk || !sp.idempotentReplay) {
    failed.push('barber_first' as never);
  }

  const out = {
    phase: 'booking-phase-8c-enforce-smoke',
    passed: failed.length === 0,
    failed,
    proofs,
  };
  fs.writeFileSync(
    path.join(__dirname, '..', '_booking-phase8c-enforce-smoke.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
