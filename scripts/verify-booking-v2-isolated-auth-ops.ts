#!/usr/bin/env npx tsx
/**
 * Re-run only the auth-blocked isolated write paths against :5500.
 * TEST DB only. Never touches last132.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { requireBookingV2WriteTestSafety } from '../src/lib/booking/bookingV2WriteSafety';

const root = process.cwd();
dotenv.config({ path: path.join(root, '.env.booking-v2-isolated'), override: true });

process.env.HAWAI_DB_CLASS = 'isolated';
process.env.BOOKING_V2_WRITE_TEST_OK = '1';
process.env.BOOKING_V2_TEST_DB_SERVER = '.\\SQLEXPRESS';
process.env.BOOKING_V2_TEST_DB_NAME = 'HawaiBookingV2Isolated';
process.env.DB_SERVER = '.\\SQLEXPRESS';
process.env.DB_DATABASE = 'HawaiBookingV2Isolated';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:5500';
const EMP = Number(process.env.VERIFY_EMP_ID || 12);
const SERVICE = Number(process.env.VERIFY_SERVICE_ID || 9);

type Json = Record<string, unknown>;
const results: { name: string; ok: boolean; detail: string }[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} — ${detail}`);
}

function cairoTodayPlus(days: number): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date(Date.now() + days * 86400000));
}

async function http(
  method: string,
  urlPath: string,
  opts?: { body?: unknown; cookie?: string; redirect?: RequestRedirect },
): Promise<{ status: number; json: Json | null; text: string; location: string | null; setCookie: string }> {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    redirect: opts?.redirect ?? 'manual',
    headers: {
      Accept: 'application/json',
      ...(opts?.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(opts?.cookie ? { Cookie: `pos_session=${opts.cookie}` } : {}),
    },
    body: opts?.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = null;
  }
  const setCookie = (res.headers.getSetCookie?.() || [res.headers.get('set-cookie') || '']).join(',');
  return { status: res.status, json, text, location: res.headers.get('location'), setCookie };
}

function pickStart(matrix: Json | null): { date: string; time: string; dayOffset: 0 | 1 } | null {
  const days = (matrix?.days as Json[]) || [];
  for (const day of days) {
    const date = String(day.businessDate || day.date || '');
    const starts = (day.generatedStarts as string[]) || [];
    const free = (day.freeRanges as Array<{ startMin?: number; endMin?: number }>) || [];
    const times = [...starts];
    for (const r of free) {
      const sm = Number(r.startMin ?? -1);
      const em = Number(r.endMin ?? -1);
      if (sm < 0 || em - sm < 30) continue;
      for (let m = sm; m + 30 <= em; m += 15) {
        times.push(
          `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
        );
      }
    }
    for (const time of times) {
      if (time < '11:00' || time > '21:00') continue;
      const hh = Number(time.slice(0, 2));
      return { date, time, dayOffset: hh < 4 ? 1 : 0 };
    }
  }
  return null;
}

async function matrix() {
  const from = cairoTodayPlus(1);
  const to = cairoTodayPlus(14);
  const r = await http('POST', '/api/public/booking/v2/availability', {
    body: {
      employeeId: EMP,
      branchCode: 'GLEEM',
      fromBusinessDate: from,
      toBusinessDate: to,
      serviceIds: [SERVICE],
    },
  });
  return r.status === 200 ? r.json : null;
}

async function main() {
  const safety = requireBookingV2WriteTestSafety();
  if (!safety.ok || safety.isLast132 || safety.isAzure) {
    throw new Error(safety.reason);
  }

  const login = await http('POST', '/api/auth/login', {
    body: { loginName: 'localadmin', password: 'LocalTest123' },
  });
  const token = (login.setCookie.match(/pos_session=([^;]+)/) || [])[1] || '';
  if (login.status !== 200 || !token) {
    record('login', false, `status=${login.status} cookie=${token ? 'yes' : 'no'}`);
    throw new Error('login failed');
  }
  record('login', true, `userId=${(login.json as Json)?.UserID} cookie=PASS`);

  const cookie = token;

  // --- Operations Create (source=operations, session branch) ---
  const slot = pickStart(await matrix());
  if (!slot) {
    record('Operations Create', false, 'no slot');
  } else {
    const phone = `01${String(Date.now()).slice(-9)}`;
    const created = await http('POST', '/api/public/booking/create', {
      cookie,
      body: {
        source: 'operations',
        date: slot.date,
        time: slot.time,
        dayOffset: slot.dayOffset,
        empId: EMP,
        mode: 'specific',
        serviceIds: [SERVICE],
        customer: { name: 'Ops Auth Create', phone },
        notes: 'isolated-auth-ops-create',
        suppressNotification: true,
      },
    });
    const booking = (created.json?.booking as Json) || {};
    const ok = created.status === 200 || created.status === 201;
    const bookingId = Number(booking.id ?? booking.bookingId ?? 0);
    record(
      'Operations Create',
      ok,
      `status=${created.status} id=${bookingId} code=${booking.code ?? booking.bookingCode}`,
    );

    // --- Cancel (operations session path; public cancel rejects operations origin) ---
    if (bookingId) {
      const cancel = await http('POST', '/api/operations/affected-bookings', {
        cookie,
        body: { action: 'cancel-booking', bookingId },
      });
      record(
        'Cancel',
        cancel.status === 200 && cancel.json?.ok === true,
        `status=${cancel.status} ${cancel.text.slice(0, 180)}`,
      );
    } else {
      record('Cancel', false, 'no booking id from ops create');
    }
  }

  // --- Reschedule ---
  const rsSlot = pickStart(await matrix());
  const moveSlot = pickStart(await matrix());
  if (!rsSlot || !moveSlot) {
    record('Reschedule', false, 'no slots');
  } else {
    const phone = `01${String(Date.now() + 1).slice(-9)}`;
    const seed = await http('POST', '/api/public/booking/create', {
      cookie,
      body: {
        source: 'operations',
        date: rsSlot.date,
        time: rsSlot.time,
        dayOffset: rsSlot.dayOffset,
        empId: EMP,
        mode: 'specific',
        serviceIds: [SERVICE],
        customer: { name: 'Ops Auth Reschedule', phone },
        suppressNotification: true,
      },
    });
    const bid = Number(
      ((seed.json?.booking as Json)?.id ?? (seed.json?.booking as Json)?.bookingId) || 0,
    );
    if (!bid) {
      record('Reschedule', false, `seed status=${seed.status} ${seed.text.slice(0, 160)}`);
    } else {
      const moved = await http('PATCH', `/api/operations/bookings/${bid}/reschedule`, {
        cookie,
        body: {
          newStartAt: `${moveSlot.date}T${moveSlot.time}:00`,
          operationalDate: moveSlot.date,
          source: 'operations_drag_drop',
        },
      });
      record(
        'Reschedule',
        moved.status === 200 && (moved.json?.ok === true || moved.json?.ok == null),
        `status=${moved.status} ${moved.text.slice(0, 200)}`,
      );
    }
  }

  // --- Queue ---
  const q = await http('GET', '/api/queue', { cookie });
  record('Queue', q.status === 200, `GET /api/queue status=${q.status} ${q.text.slice(0, 160)}`);

  const planDay = cairoTodayPlus(0);
  const qCreate = await http('POST', '/api/operations/queue/create', {
    cookie,
    body: {
      empId: EMP,
      serviceIds: [SERVICE],
      customer: { name: 'Ops Auth Queue', phone: `01${String(Date.now() + 2).slice(-9)}` },
      expectedStartTime: `${planDay}T14:00:00`,
      expectedEndTime: `${planDay}T14:30:00`,
      source: 'walk_in',
      trustExpectedStart: true,
      useClientPlannedTimes: true,
    },
  });
  record(
    'Queue create',
    qCreate.status === 200 || qCreate.status === 201 || qCreate.status === 409,
    `status=${qCreate.status} ${qCreate.text.slice(0, 180)}`,
  );

  // --- Workforce ---
  const wfDate = cairoTodayPlus(3);
  const wf = await http('POST', '/api/operations/schedule-control/apply', {
    cookie,
    body: {
      empId: EMP,
      date: wfDate,
      type: 'day_off',
      reason: 'isolated-auth-workforce',
      forceApply: true,
    },
  });
  record(
    'Workforce',
    wf.status === 200 || wf.status === 201,
    `status=${wf.status} ${wf.text.slice(0, 220)}`,
  );

  const opsPage = await http('GET', '/operations', { cookie, redirect: 'manual' });
  record(
    '/operations',
    opsPage.status === 200,
    `status=${opsPage.status} loc=${opsPage.location}`,
  );

  console.log('\n=== AUTH-BLOCKED RETEST ===');
  console.log(JSON.stringify(results, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
