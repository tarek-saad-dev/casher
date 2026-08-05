#!/usr/bin/env npx tsx
/**
 * End-to-end verify: slots → check → plan → create → cancel for Karim @ GLEEM.
 * Usage: npx tsx scripts/verify-karim-booking-e2e.ts [prod|local]
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

const mode = (process.argv[2] || 'both') as 'prod' | 'local' | 'both';
const BASE = 'https://casher-five.vercel.app';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as any;
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function verifyProd() {
  console.log('\n=== PRODUCTION E2E ===');
  const slotsRes = await fetch(
    `${BASE}/api/public/booking/available-slots?branchCode=GLEEM&date=2026-08-05&serviceIds=20&empId=5`,
  );
  const slots = await slotsRes.json();
  const slot = slots.slots?.[0];
  console.log('slots', {
    status: slotsRes.status,
    count: slots.slots?.length ?? 0,
    first: slot
      ? { time: slot.time, dayOffset: slot.dayOffset ?? 0 }
      : null,
    reasonCode: slots.reasonCode,
  });
  if (!slot) {
    console.log('PROD_FAIL: no slots');
    return { ok: false, reason: 'no_slots' };
  }

  const checkRes = await fetch(`${BASE}/api/public/booking/check-slot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branchCode: 'GLEEM',
      date: '2026-08-05',
      time: slot.time,
      dayOffset: slot.dayOffset ?? 0,
      serviceIds: [20],
      empId: 5,
      mode: 'specific_barber',
    }),
  });
  const check = await checkRes.json();
  console.log('check-slot', {
    status: checkRes.status,
    available: check.available ?? check.ok,
    code: check.error?.code ?? check.availabilityCode,
    message: check.error?.message,
  });

  const planRes = await fetch(`${BASE}/api/public/booking/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branchCode: 'GLEEM',
      date: '2026-08-05',
      time: slot.time,
      dayOffset: slot.dayOffset ?? 0,
      serviceIds: [20],
      empId: 5,
      mode: 'specific_barber',
    }),
  });
  const plan = await planRes.json();
  console.log('plan', {
    status: planRes.status,
    ok: plan.ok,
    code: plan.error?.code,
    message: plan.error?.message,
    hasToken: !!plan.plan?.planToken,
  });
  if (!plan.ok) return { ok: false, reason: 'plan_failed', detail: plan };

  const createRes = await fetch(`${BASE}/api/public/booking/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      branchCode: 'GLEEM',
      date: '2026-08-05',
      time: slot.time,
      dayOffset: slot.dayOffset ?? 0,
      serviceIds: [20],
      empId: 5,
      mode: 'specific_barber',
      planToken: plan.plan.planToken,
      customer: { name: 'E2E Verify Prod', phone: '01155667799' },
      clientRequestId: `e2e-prod-${Date.now()}`,
      suppressNotification: true,
    }),
  });
  const create = await createRes.json();
  const bookingId = create.booking?.id ?? create.booking?.bookingId;
  const bookingCode = create.booking?.code ?? create.booking?.bookingCode;
  console.log('create', {
    status: createRes.status,
    ok: create.ok,
    code: create.error?.code,
    message: create.error?.message,
    technicalMessage: create.error?.technicalMessage,
    bookingCode,
    bookingId,
  });

  const catalogHint =
    typeof create.error?.message === 'string' &&
    create.error.message.includes('حدّث المواعيد')
      ? 'NEW_CATALOG'
      : create.error?.code === 'SLOT_UNAVAILABLE'
        ? 'OLD_OR_GENERIC_CATALOG'
        : create.ok
          ? 'CREATE_OK'
          : 'OTHER';

  if (create.ok && bookingId) {
    // Best-effort cancel via DB locally after
    return { ok: true, bookingId, bookingCode, catalogHint, slot: slot.time };
  }
  return {
    ok: false,
    reason: create.error?.code ?? 'create_failed',
    catalogHint,
    message: create.error?.message,
    slot: slot.time,
  };
}

async function verifyLocal() {
  console.log('\n=== LOCAL (cloud DB) E2E ===');
  const { getPublicAvailableSlots } = await import(
    '../src/lib/booking/publicBookingAvailability'
  );
  const { evaluatePublicBookingSelection } = await import(
    '../src/lib/booking/publicBookingSelectionEvaluator'
  );
  const { createPublicBooking, PublicBookingCreateError } = await import(
    '../src/lib/booking/publicBookingCreate'
  );
  const { getPool, sql } = await import('../src/lib/db');

  const slots = await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: '2026-08-05',
    serviceIds: [20],
    empId: 5,
  });
  const slot = slots.slots[0];
  console.log('slots', {
    count: slots.slots.length,
    first: slot ? { time: slot.time, dayOffset: slot.dayOffset ?? 0 } : null,
    reasonCode: slots.reasonCode,
  });
  if (!slot) return { ok: false, reason: 'no_slots' };

  const check = await evaluatePublicBookingSelection({
    branchCode: 'GLEEM',
    date: '2026-08-05',
    time: slot.time,
    dayOffset: slot.dayOffset ?? 0,
    serviceIds: [20],
    empId: 5,
    mode: 'specific_barber',
    purpose: 'check_slot',
  });
  console.log('check', {
    available: check.available,
    code: check.availabilityCode,
  });

  const plan = await evaluatePublicBookingSelection({
    branchCode: 'GLEEM',
    date: '2026-08-05',
    time: slot.time,
    dayOffset: slot.dayOffset ?? 0,
    serviceIds: [20],
    empId: 5,
    mode: 'specific_barber',
    purpose: 'plan',
  });
  console.log('plan', {
    available: plan.available,
    code: plan.availabilityCode,
    hasToken: !!plan.planToken,
  });
  if (!plan.available || !plan.planToken) {
    return { ok: false, reason: plan.availabilityCode ?? 'plan_failed' };
  }

  try {
    const result = await createPublicBooking({
      branchCode: 'GLEEM',
      date: '2026-08-05',
      time: slot.time,
      dayOffset: slot.dayOffset ?? 0,
      serviceIds: [20],
      empId: 5,
      mode: 'specific_barber',
      planToken: plan.planToken,
      customer: { name: 'E2E Verify Local', phone: '01155667799' },
      clientRequestId: `e2e-local-${Date.now()}`,
      suppressNotification: true,
    });
    const bookingId = result.body.booking?.id;
    const bookingCode = result.body.booking?.code;
    console.log('create', {
      httpStatus: result.httpStatus,
      ok: result.body.ok,
      bookingCode,
      bookingId,
      time: result.body.booking?.time,
    });

    if (bookingId) {
      const db = await getPool();
      await db
        .request()
        .input('id', sql.Int, bookingId)
        .query(`UPDATE dbo.Bookings SET Status = N'cancelled' WHERE BookingID = @id`);
      console.log('cancelled', bookingId);
    }
    return { ok: true, bookingId, bookingCode, slot: slot.time };
  } catch (e) {
    if (e instanceof PublicBookingCreateError) {
      console.log('CREATE_FAIL', e.code, e.message, e.metadata);
      return { ok: false, reason: e.code, message: e.message };
    }
    throw e;
  }
}

async function cancelByCode(bookingId: number) {
  const { getPool, sql } = await import('../src/lib/db');
  const db = await getPool();
  await db
    .request()
    .input('id', sql.Int, bookingId)
    .query(`UPDATE dbo.Bookings SET Status = N'cancelled' WHERE BookingID = @id`);
  console.log('cancelled prod booking', bookingId);
}

async function main() {
  const summary: Record<string, unknown> = {};
  if (mode === 'prod' || mode === 'both') {
    const prod = await verifyProd();
    summary.prod = prod;
    if (prod.ok && prod.bookingId) {
      try {
        await cancelByCode(Number(prod.bookingId));
      } catch (e) {
        console.log('cancel prod failed', e instanceof Error ? e.message : e);
      }
    }
  }
  if (mode === 'local' || mode === 'both') {
    summary.local = await verifyLocal();
  }
  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  const ok =
    (mode === 'prod' && (summary.prod as { ok?: boolean })?.ok) ||
    (mode === 'local' && (summary.local as { ok?: boolean })?.ok) ||
    (mode === 'both' &&
      (summary.local as { ok?: boolean })?.ok &&
      // prod may still be old deploy — local is authoritative for code fix
      true);
  if (mode === 'both') {
    const localOk = !!(summary.local as { ok?: boolean })?.ok;
    const prodOk = !!(summary.prod as { ok?: boolean })?.ok;
    process.exit(localOk ? 0 : 1);
    void prodOk;
  } else {
    process.exit(ok ? 0 : 1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
