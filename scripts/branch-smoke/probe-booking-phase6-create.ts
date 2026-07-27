/**
 * Live Phase 6 create smoke — disposable bookings, no real WhatsApp.
 * Marker phones are placeholders → notification skipped.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

const MARKER = 'P6CREATE';
const out: Record<string, unknown> = { ts: new Date().toISOString(), marker: MARKER };

async function main() {
  const { setDbTarget, getPool, sql } = await import('../../src/lib/db');
  await setDbTarget('cloud');
  const db = await getPool();

  const { createPublicBooking, PublicBookingCreateError } = await import(
    '../../src/lib/booking/publicBookingCreate'
  );
  const { evaluatePublicBookingSelection } = await import(
    '../../src/lib/booking/publicBookingSelectionEvaluator'
  );
  const { getPublicAvailableSlots, invalidatePublicBookingAvailabilityCache } = await import(
    '../../src/lib/booking/publicBookingAvailability'
  );
  const { ensurePublicBookingCreateIdempotencyTable } = await import(
    '../../src/lib/booking/publicBookingCreateIdempotency'
  );

  await ensurePublicBookingCreateIdempotencyTable();
  invalidatePublicBookingAvailabilityCache();

  const empId = 12;
  const serviceIds = [9];
  const slots = await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: '2026-08-10',
    serviceIds,
    empId,
  });
  const slot =
    slots.slots.find((s) => s.dayOffset === 0) ??
    slots.slots[0];
  const overnight = slots.slots.find((s) => s.dayOffset === 1);
  if (!slot) throw new Error('No available slot for smoke');

  const workDate = slots.date;
  const createdBookingIds: number[] = [];

  async function createOne(label: string, args: Record<string, unknown>) {
    const t0 = Date.now();
    try {
      const result = await createPublicBooking({
        branchCode: 'GLEEM',
        date: workDate,
        time: slot!.time,
        dayOffset: slot!.dayOffset,
        serviceIds,
        suppressNotification: true,
        customer: {
          name: `${MARKER} ${label}`,
          phone: '01000000000', // placeholder → no WhatsApp
        },
        ...args,
      } as never);
      const code = String(result.body.booking.code);
      const row = await db
        .request()
        .input('code', sql.NVarChar, code)
        .query(`SELECT BookingID, AssignedEmpID, BookingDate, Notes, BranchID FROM dbo.Bookings WHERE BookingCode=@code`);
      const bookingId = row.recordset[0]?.BookingID as number | undefined;
      if (bookingId) createdBookingIds.push(bookingId);
      out[label] = {
        ms: Date.now() - t0,
        ok: true,
        code,
        bookingId,
        empId: result.body.booking.barber
          ? (result.body.booking.barber as { empId: number }).empId
          : null,
        replay: result.body.meta.idempotentReplay,
        planTokenStatus: result.body.meta.planTokenStatus,
        assignmentStrategy: result.body.meta.assignmentStrategy,
        whatsapp: result.body.whatsapp,
      };
      return result;
    } catch (e) {
      out[label] = {
        ms: Date.now() - t0,
        ok: false,
        code: e instanceof PublicBookingCreateError ? e.code : String(e),
      };
      return null;
    }
  }

  // Specific create
  const key1 = `p6-${crypto.randomUUID()}`;
  await createOne('specific_create', {
    empId,
    mode: 'specific_barber',
    clientRequestId: key1,
    time: slot.time,
    dayOffset: slot.dayOffset,
  });

  // Idempotent replay
  await createOne('idempotent_replay', {
    empId,
    mode: 'specific_barber',
    clientRequestId: key1,
    time: slot.time,
    dayOffset: slot.dayOffset,
  });

  // Reused key different payload
  await createOne('idempotency_mismatch', {
    empId,
    mode: 'specific_barber',
    clientRequestId: key1,
    time: '10:00',
    dayOffset: 0,
  });

  // Camp Caesar
  try {
    await createPublicBooking({
      branchCode: 'CAMP_CAESAR',
      date: workDate,
      time: '10:00',
      dayOffset: 0,
      serviceIds,
      empId,
      mode: 'specific_barber',
      clientRequestId: `p6-cc-${crypto.randomUUID()}`,
      customer: { name: `${MARKER} CC`, phone: '01000000000' },
      suppressNotification: true,
    });
    out.camp_caesar = { ok: true, leaked: true };
  } catch (e) {
    out.camp_caesar = {
      ok: false,
      code: e instanceof PublicBookingCreateError ? e.code : String(e),
    };
  }

  // Concurrent different keys same slot (expect 1 success)
  const slot2 =
    slots.slots.find((s) => s.time !== slot.time && s.dayOffset === 0) ?? slot;
  // Use a later free slot for concurrency to avoid conflicting with key1 booking
  const free = await evaluatePublicBookingSelection({
    branchCode: 'GLEEM',
    date: workDate,
    time: slot2.time,
    dayOffset: slot2.dayOffset,
    serviceIds,
    empId,
    purpose: 'create_precheck',
  });
  const concTime = free.available ? slot2.time : slot.time;
  const concDay = free.available ? slot2.dayOffset : slot.dayOffset;

  const [a, b] = await Promise.all([
    createPublicBooking({
      branchCode: 'GLEEM',
      date: workDate,
      time: concTime,
      dayOffset: concDay,
      serviceIds,
      empId,
      mode: 'specific_barber',
      clientRequestId: `p6-cA-${crypto.randomUUID()}`,
      customer: { name: `${MARKER} ConcA`, phone: '01000000000' },
      suppressNotification: true,
    }).then(
      (r) => ({ ok: true as const, code: String(r.body.booking.code), emp: (r.body.booking.barber as { empId: number }).empId }),
      (e) => ({
        ok: false as const,
        code: e instanceof PublicBookingCreateError ? e.code : 'ERR',
      }),
    ),
    createPublicBooking({
      branchCode: 'GLEEM',
      date: workDate,
      time: concTime,
      dayOffset: concDay,
      serviceIds,
      empId,
      mode: 'specific_barber',
      clientRequestId: `p6-cB-${crypto.randomUUID()}`,
      customer: { name: `${MARKER} ConcB`, phone: '01000000000' },
      suppressNotification: true,
    }).then(
      (r) => ({ ok: true as const, code: String(r.body.booking.code), emp: (r.body.booking.barber as { empId: number }).empId }),
      (e) => ({
        ok: false as const,
        code: e instanceof PublicBookingCreateError ? e.code : 'ERR',
      }),
    ),
  ]);
  out.concurrency_specific = { a, b, successCount: [a, b].filter((x) => x.ok).length };
  for (const x of [a, b]) {
    if (x.ok) {
      const row = await db
        .request()
        .input('code', sql.NVarChar, x.code)
        .query(`SELECT BookingID FROM dbo.Bookings WHERE BookingCode=@code`);
      if (row.recordset[0]?.BookingID) createdBookingIds.push(row.recordset[0].BookingID);
    }
  }

  // Any-barber create on another slot
  const anySlots = await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: workDate,
    serviceIds,
  });
  const anySlot = anySlots.slots.find(
    (s) => !(s.time === concTime && s.dayOffset === concDay) && !(s.time === slot.time && s.dayOffset === slot.dayOffset),
  );
  if (anySlot) {
    await createOne('any_barber_create', {
      mode: 'any_barber',
      time: anySlot.time,
      dayOffset: anySlot.dayOffset,
      clientRequestId: `p6-any-${crypto.randomUUID()}`,
    });
  }

  if (overnight) {
    await createOne('overnight_create', {
      empId,
      mode: 'specific_barber',
      time: overnight.time,
      dayOffset: 1,
      clientRequestId: `p6-ov-${crypto.randomUUID()}`,
    });
  }

  // Cleanup smoke bookings
  let cleaned = 0;
  for (const id of createdBookingIds) {
    await db.request().input('id', sql.Int, id).query(`
      DELETE FROM dbo.BookingServices WHERE BookingID=@id;
      DELETE FROM dbo.Bookings WHERE BookingID=@id;
    `);
    cleaned += 1;
  }
  // Cleanup idempotency rows for this run
  await db.request().query(`
    DELETE FROM dbo.TblPublicBookingCreateRequest
    WHERE IdempotencyKey LIKE N'p6-%'
  `).catch(() => undefined);

  out.cleanup = { bookingIds: createdBookingIds, cleaned };
  out.createdCount = createdBookingIds.length;

  const dest = path.join(__dirname, '_booking-phase6-live-probe.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  console.log('wrote', dest);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
