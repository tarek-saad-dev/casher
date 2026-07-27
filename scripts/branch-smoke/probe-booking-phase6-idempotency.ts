/**
 * Focused Phase 6 idempotency + concurrent create proof (cleanup after).
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

async function main() {
  const { setDbTarget, getPool, sql } = await import('../../src/lib/db');
  await setDbTarget('cloud');
  const db = await getPool();
  const { createPublicBooking, PublicBookingCreateError } = await import(
    '../../src/lib/booking/publicBookingCreate'
  );
  const { getPublicAvailableSlots, invalidatePublicBookingAvailabilityCache } = await import(
    '../../src/lib/booking/publicBookingAvailability'
  );
  const { ensurePublicBookingCreateIdempotencyTable } = await import(
    '../../src/lib/booking/publicBookingCreateIdempotency'
  );
  await ensurePublicBookingCreateIdempotencyTable();
  invalidatePublicBookingAvailabilityCache();

  const slots = await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: '2026-08-03',
    serviceIds: [9],
    empId: 12,
  });
  const slot = slots.slots.find((s) => s.dayOffset === 0) ?? slots.slots[0];
  if (!slot) throw new Error('no slot');
  const workDate = slots.date;
  const key = `p6idemp-${crypto.randomUUID()}`;
  const base = {
    branchCode: 'GLEEM',
    date: workDate,
    time: slot.time,
    dayOffset: slot.dayOffset,
    serviceIds: [9],
    empId: 12,
    mode: 'specific_barber' as const,
    customer: { name: 'P6 Idemp', phone: '01000000000' },
    suppressNotification: true,
    clientRequestId: key,
  };

  const first = await createPublicBooking(base);
  const replay = await createPublicBooking(base);
  let mismatchCode = '';
  try {
    await createPublicBooking({ ...base, time: '10:00', dayOffset: 0 });
  } catch (e) {
    mismatchCode = e instanceof PublicBookingCreateError ? e.code : String(e);
  }

  const keyA = `p6conc-${crypto.randomUUID()}`;
  const keyB = `p6conc-${crypto.randomUUID()}`;
  // pick another free slot
  const slot2 = slots.slots.find((s) => s.time !== slot.time && s.dayOffset === 0);
  let conc = null;
  if (slot2) {
    const [a, b] = await Promise.all([
      createPublicBooking({
        ...base,
        time: slot2.time,
        dayOffset: slot2.dayOffset,
        clientRequestId: keyA,
      }).then(
        (r) => ({ ok: true, code: String(r.body.booking.code) }),
        (e) => ({ ok: false, code: e instanceof PublicBookingCreateError ? e.code : 'ERR' }),
      ),
      createPublicBooking({
        ...base,
        time: slot2.time,
        dayOffset: slot2.dayOffset,
        clientRequestId: keyB,
      }).then(
        (r) => ({ ok: true, code: String(r.body.booking.code) }),
        (e) => ({ ok: false, code: e instanceof PublicBookingCreateError ? e.code : 'ERR' }),
      ),
    ]);
    conc = { a, b, successCount: [a, b].filter((x) => x.ok).length };
  }

  let cc = '';
  try {
    await createPublicBooking({
      ...base,
      branchCode: 'CAMP_CAESAR',
      clientRequestId: `p6cc-${crypto.randomUUID()}`,
    });
  } catch (e) {
    cc = e instanceof PublicBookingCreateError ? e.code : String(e);
  }

  const codes = [String(first.body.booking.code)];
  if (conc?.a.ok) codes.push(conc.a.code);
  if (conc?.b.ok) codes.push(conc.b.code);
  for (const code of codes) {
    await db.request().input('code', sql.NVarChar, code).query(`
      DECLARE @id INT = (SELECT BookingID FROM dbo.Bookings WHERE BookingCode=@code);
      IF @id IS NOT NULL BEGIN
        DELETE FROM dbo.BookingServices WHERE BookingID=@id;
        DELETE FROM dbo.Bookings WHERE BookingID=@id;
      END
    `);
  }
  await db.request().query(`
    DELETE FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey LIKE N'p6idemp-%' OR IdempotencyKey LIKE N'p6conc-%' OR IdempotencyKey LIKE N'p6cc-%'
  `);

  const out = {
    firstCode: first.body.booking.code,
    replayOk: replay.body.meta.idempotentReplay === true,
    replaySameCode: replay.body.booking.code === first.body.booking.code,
    mismatchCode,
    conc,
    campCaesar: cc,
  };
  fs.writeFileSync(
    path.join(__dirname, '_booking-phase6-idempotency-probe.json'),
    JSON.stringify(out, null, 2),
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
