#!/usr/bin/env npx tsx
/**
 * Phase 8B1B — controlled live public booking smoke against production alias.
 * BOOKING_PHASE_8B1B_SMOKE=enabled npx tsx scripts/verify-booking-phase8b1b-live-smoke.ts
 *
 * Redacts planToken / bookingAccessToken / full phone in artifacts.
 */
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { performance } from 'perf_hooks';

const BASE = process.env.PUBLIC_BOOKING_PROBE_BASE || 'https://casher-five.vercel.app';
const ORIGIN = 'https://cutsaloon.com';
const SERVICE_ID = 9;
const SMOKE_PHONE = process.env.BOOKING_SMOKE_PHONE || '01099998888';
const SMOKE_NAME = '[SMOKE P8B1B] Live';

type Json = Record<string, unknown>;

function redactToken(v: unknown): string | null {
  if (v == null || v === '') return null;
  const s = String(v);
  if (s.length <= 12) return '[redacted]';
  return `${s.slice(0, 6)}…${s.slice(-4)}`;
}

function redactPhone(p: string): string {
  if (p.length < 4) return '****';
  return `****${p.slice(-4)}`;
}

async function api(
  method: string,
  urlPath: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; headers: Headers; json: Json; ms: number }> {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Origin: ORIGIN,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(extraHeaders || {}),
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

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  if (process.env.BOOKING_PHASE_8B1B_SMOKE !== 'enabled') {
    console.log('Set BOOKING_PHASE_8B1B_SMOKE=enabled to run.');
    process.exit(2);
  }

  const proofs: Record<string, unknown> = {
    phase: 'booking-phase-8b1b-live-smoke',
    base: BASE,
    smokedAt: new Date().toISOString(),
    smokePhone: redactPhone(SMOKE_PHONE),
  };
  const timings: Record<string, number> = {};

  // 1. branches
  const branches = await api('GET', '/api/public/branches');
  timings.branches_ms = branches.ms;
  const branchList = (branches.json.branches as Array<{ branchCode?: string }>) || [];
  proofs.branches_ok =
    branches.status === 200 && branchList.some((b) => b.branchCode === 'GLEEM');
  proofs.branchCodes = branchList.map((b) => b.branchCode);

  // 2. services
  const services = await api('GET', '/api/public/booking/services?branchCode=GLEEM');
  timings.services_ms = services.ms;
  const svcList = (services.json.services as unknown[]) || [];
  proofs.services_ok = services.status === 200 && svcList.length === 30;
  proofs.serviceCount = svcList.length;

  // 3. barbers
  const barbers = await api('GET', '/api/public/booking/barbers?branchCode=GLEEM');
  timings.barbers_ms = barbers.ms;
  const barList = (barbers.json.barbers as unknown[]) || [];
  proofs.barbers_ok = barbers.status === 200 && barList.length > 0;
  proofs.barberCount = barList.length;

  // 4. available-days → available-slots
  const days = await api(
    'GET',
    `/api/public/booking/available-days?branchCode=GLEEM&serviceIds=${SERVICE_ID}`,
  );
  timings.available_days_ms = days.ms;
  const dayRows =
    (days.json.days as Array<{
      date: string;
      isAvailable?: boolean;
      status?: string;
      firstAvailableTime?: string | null;
      firstAvailableDayOffset?: number | null;
    }>) || [];
  // Prefer a future calendar day so public cancel window (30m) stays open.
  const firstDay =
    dayRows.find((d) => d.isAvailable && d.date > new Date().toISOString().slice(0, 10)) ||
    dayRows.find((d) => d.isAvailable);
  proofs.available_days_ok = days.status === 200 && !!firstDay;
  proofs.available_days_statuses = [...new Set(dayRows.map((d) => d.status))];
  assert(firstDay, `no available day: status=${days.status} code=${(days.json.error as Json)?.code}`);

  const slots = await api(
    'GET',
    `/api/public/booking/available-slots?branchCode=GLEEM&date=${firstDay.date}&serviceIds=${SERVICE_ID}`,
  );
  timings.available_slots_ms = slots.ms;
  const slotRows =
    (slots.json.slots as Array<{
      time: string;
      dayOffset?: number;
      startDateTime?: string;
      endDateTime?: string;
    }>) || [];
  const nowMs = Date.now();
  const CANCEL_BUFFER_MS = 45 * 60 * 1000; // above 30m public cancel cutoff
  const firstSlot =
    slotRows.find((s) => {
      if (!s.startDateTime) return firstDay.date > new Date().toISOString().slice(0, 10);
      return new Date(s.startDateTime).getTime() - nowMs >= CANCEL_BUFFER_MS;
    }) || slotRows[0];
  proofs.available_slots_ok = slots.status === 200 && !!firstSlot;
  assert(firstSlot, 'no available slot');
  proofs.slot_startDateTime = firstSlot.startDateTime ?? null;

  const selected = {
    date: firstDay.date,
    time: firstSlot.time,
    dayOffset: (firstSlot.dayOffset ?? 0) as 0 | 1,
    serviceIds: [SERVICE_ID],
    mode: 'any_barber' as const,
  };
  proofs.selected = selected;

  // 5. check-slot
  const check = await api('POST', '/api/public/booking/check-slot', {
    branchCode: 'GLEEM',
    date: selected.date,
    time: selected.time,
    dayOffset: selected.dayOffset,
    serviceIds: selected.serviceIds,
    mode: selected.mode,
  });
  timings.check_slot_ms = check.ms;
  proofs.check_slot_ok =
    check.status === 200 &&
    (check.json.available === true || (check.json as Json).ok === true);
  // normalize: some responses nest available
  const checkAvailable =
    check.json.available === true ||
    (check.json.result as Json | undefined)?.available === true;
  proofs.check_slot_available = checkAvailable;
  assert(checkAvailable, `check-slot not available: ${JSON.stringify(check.json).slice(0, 300)}`);

  // 6. plan
  const plan = await api('POST', '/api/public/booking/plan', {
    branchCode: 'GLEEM',
    date: selected.date,
    time: selected.time,
    dayOffset: selected.dayOffset,
    serviceIds: selected.serviceIds,
    mode: selected.mode,
  });
  timings.plan_ms = plan.ms;
  const planToken = String(
    plan.json.planToken ||
      (plan.json.plan as Json | undefined)?.planToken ||
      '',
  );
  const planFingerprint = String(
    plan.json.planFingerprint ||
      (plan.json.plan as Json | undefined)?.planFingerprint ||
      '',
  );
  proofs.plan_ok = plan.status === 200 && planToken.length > 0;
  proofs.planTokenRedacted = redactToken(planToken);
  proofs.planFingerprintRedacted = redactToken(planFingerprint);
  proofs.planSubtotal =
    plan.json.subtotal ??
    (plan.json.plan as Json | undefined)?.subtotal ??
    null;
  proofs.planDuration =
    plan.json.totalDurationMinutes ??
    (plan.json.plan as Json | undefined)?.totalDurationMinutes ??
    null;
  assert(planToken, `plan failed: ${JSON.stringify(plan.json).slice(0, 400)}`);

  // 7–8. create + replay
  const createKey = `p8b1b-create-${crypto.randomUUID()}`;
  const createBody = {
    branchCode: 'GLEEM',
    date: selected.date,
    time: selected.time,
    dayOffset: selected.dayOffset,
    serviceIds: selected.serviceIds,
    mode: selected.mode,
    planToken,
    customer: { name: SMOKE_NAME, phone: SMOKE_PHONE },
    clientRequestId: createKey,
    suppressNotification: true,
  };

  const created = await api('POST', '/api/public/booking/create', createBody, {
    'Idempotency-Key': createKey,
  });
  timings.create_ms = created.ms;
  const booking = (created.json.booking as Json) || {};
  const bookingCode = String(booking.code || '');
  const accessToken = String(booking.bookingAccessToken || '');
  proofs.create_ok = (created.status === 200 || created.status === 201) && !!bookingCode;
  proofs.bookingCode = bookingCode;
  proofs.accessTokenRedacted = redactToken(accessToken);
  proofs.createStatus = created.status;
  if (!proofs.create_ok) {
    proofs.createError = created.json.error ?? created.json;
  }
  assert(bookingCode, `create failed: ${JSON.stringify(created.json).slice(0, 500)}`);

  const replay = await api('POST', '/api/public/booking/create', createBody, {
    'Idempotency-Key': createKey,
  });
  timings.replay_ms = replay.ms;
  const replayCode = String(((replay.json.booking as Json) || {}).code || '');
  const replayMeta = (replay.json.meta as Json) || {};
  proofs.idempotent_replay =
    (replay.status === 200 || replay.status === 201) &&
    replayCode === bookingCode &&
    replayMeta.idempotentReplay === true;

  // 9. lookup
  const lookup = await api(
    'GET',
    `/api/public/booking/${encodeURIComponent(bookingCode)}?phone=${encodeURIComponent(SMOKE_PHONE)}`,
    undefined,
    accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  );
  // Some routes use query accessToken
  let lookupFinal = lookup;
  if (lookup.status >= 400 && accessToken) {
    lookupFinal = await api(
      'GET',
      `/api/public/booking/${encodeURIComponent(bookingCode)}?accessToken=${encodeURIComponent(accessToken)}`,
    );
  }
  timings.lookup_ms = lookupFinal.ms;
  const lookupBooking = (lookupFinal.json.booking as Json) || lookupFinal.json;
  proofs.lookup_ok =
    lookupFinal.status === 200 &&
    String((lookupBooking as Json).code || '') === bookingCode;
  proofs.lookupStatus = (lookupBooking as Json).status ?? null;

  // 10–11. cancel + verify
  const cancelKey = `p8b1b-cancel-${crypto.randomUUID()}`;
  const cancelled = await api(
    'POST',
    '/api/public/booking/cancel',
    {
      code: bookingCode,
      phone: SMOKE_PHONE,
      accessToken,
      clientRequestId: cancelKey,
    },
    { 'Idempotency-Key': cancelKey },
  );
  timings.cancel_ms = cancelled.ms;
  proofs.cancel_ok =
    cancelled.status === 200 &&
    ((cancelled.json.ok === true) ||
      String(((cancelled.json.booking as Json) || {}).status || '') === 'cancelled');
  if (!proofs.cancel_ok) {
    proofs.cancelError = cancelled.json.error ?? cancelled.json;
  }

  const lookupAfter = await api(
    'GET',
    `/api/public/booking/${encodeURIComponent(bookingCode)}?accessToken=${encodeURIComponent(accessToken)}`,
  );
  const afterBooking = (lookupAfter.json.booking as Json) || lookupAfter.json;
  proofs.lookup_cancelled =
    lookupAfter.status === 200 &&
    String((afterBooking as Json).status || '') === 'cancelled';

  // Slot release: same slot should become available again (best-effort)
  const checkAfter = await api('POST', '/api/public/booking/check-slot', {
    branchCode: 'GLEEM',
    date: selected.date,
    time: selected.time,
    dayOffset: selected.dayOffset,
    serviceIds: selected.serviceIds,
    mode: selected.mode,
  });
  const afterAvail =
    checkAfter.json.available === true ||
    (checkAfter.json.result as Json | undefined)?.available === true;
  proofs.slot_released = afterAvail === true;
  proofs.slot_release_check_status = checkAfter.status;

  // 12. Camp Caesar
  const camp = await api('GET', '/api/public/booking/config?branchCode=CAMP_CAESAR');
  proofs.camp_caesar_hidden =
    camp.status === 404 &&
    String(((camp.json.error as Json) || {}).code || '') === 'BRANCH_NOT_PUBLIC';

  const required = [
    'branches_ok',
    'services_ok',
    'barbers_ok',
    'available_days_ok',
    'available_slots_ok',
    'check_slot_available',
    'plan_ok',
    'create_ok',
    'idempotent_replay',
    'lookup_ok',
    'cancel_ok',
    'lookup_cancelled',
    'slot_released',
    'camp_caesar_hidden',
  ] as const;
  const failed = required.filter((k) => !proofs[k]);
  const passed = failed.length === 0;

  const out = {
    phase: 'booking-phase-8b1b-live-smoke',
    passed,
    failed,
    timings,
    proofs,
  };
  const outPath = path.join(__dirname, '..', '_booking-phase8b1b-live-smoke.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(passed ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
