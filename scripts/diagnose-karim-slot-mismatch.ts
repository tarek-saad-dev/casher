#!/usr/bin/env npx tsx
/**
 * Diagnose Karim (emp 5) slots that appear free then fail strong check.
 */
import path from 'path';
import Module from 'module';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as any;
const o = mod._load;
mod._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

async function main() {
  const { getPool, sql } = await import('../src/lib/db');
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const { getPublicAvailableSlots } = await import(
    '../src/lib/booking/publicBookingAvailability'
  );
  const { evaluatePublicBookingSelection } = await import(
    '../src/lib/booking/publicBookingSelectionEvaluator'
  );
  const { assertEmployeeIntervalAvailable } = await import('../src/lib/scheduleIntegrity');
  const { listActiveBookingHoldsForEmployee } = await import('../src/lib/booking/bookingHold');
  const { buildBookingIntervals, buildQueueIntervals, getDefaultDuration } = await import(
    '../src/lib/queueEstimateEngine'
  );

  const db = await getPool();
  const bd = getCairoBusinessDate();
  const now = new Date();

  // Prefer a real public service used at GLEEM
  const svc = await db.request().query(`
    SELECT TOP 5 bs.ProID, p.ProName, bs.DurationMinutes, COUNT(*) AS Cnt
    FROM dbo.BookingServices bs
    INNER JOIN dbo.Bookings b ON b.BookingID = bs.BookingID
    LEFT JOIN dbo.TblPro p ON p.ProID = bs.ProID
    WHERE b.AssignedEmpID = 5
      AND b.BookingDate >= DATEADD(day, -14, CAST(GETDATE() AS date))
    GROUP BY bs.ProID, p.ProName, bs.DurationMinutes
    ORDER BY COUNT(*) DESC
  `);
  console.log(JSON.stringify({ businessDate: bd, now: now.toISOString(), services: svc.recordset }, null, 2));
  if (!svc.recordset.length) {
    console.log('NO_SERVICES');
    return;
  }
  const serviceIds = [Number(svc.recordset[0].ProID)];

  const defaultDur = await getDefaultDuration(db);
  const bookings = await buildBookingIntervals(db, 5, bd, defaultDur, { failHard: true });
  const queue = await buildQueueIntervals(db, 5, bd, now, defaultDur, undefined, {
    failHard: true,
    filterStale: true,
    graceMinutes: 30,
  });
  console.log(
    JSON.stringify(
      {
        bookingBusy: bookings.map((b) => ({
          id: b.id,
          start: b.start.toISOString(),
          end: b.end.toISOString(),
        })),
        queueBusy: queue.map((q) => ({
          id: q.id,
          start: q.start.toISOString(),
          end: q.end.toISOString(),
          label: q.label,
        })),
      },
      null,
      2,
    ),
  );

  const slots = await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: bd,
    serviceIds,
    empId: 5,
  });
  console.log(
    JSON.stringify(
      {
        slotCount: slots.slots.length,
        first10: slots.slots.slice(0, 10).map((s) => ({
          time: s.time,
          dayOffset: s.dayOffset ?? 0,
        })),
        reasonCode: slots.reasonCode,
      },
      null,
      2,
    ),
  );

  const candidates = slots.slots.slice(0, 8);
  for (const c of candidates) {
    const check = await evaluatePublicBookingSelection({
      branchCode: 'GLEEM',
      date: bd,
      time: c.time,
      dayOffset: c.dayOffset ?? 0,
      serviceIds,
      empId: 5,
      mode: 'specific_barber',
      purpose: 'check_slot',
    });
    let writeGuard: string = 'n/a';
    if (check.available && check.startDateTime && check.endDateTime) {
      try {
        await assertEmployeeIntervalAvailable({
          empId: 5,
          startAt: new Date(check.startDateTime),
          endAt: new Date(check.endDateTime),
          operationalDate: bd,
          branchId: 1,
        });
        writeGuard = 'OK';
      } catch (err) {
        writeGuard = err instanceof Error ? err.message : String(err);
      }
    }
    console.log(
      JSON.stringify({
        slot: `${c.time}/d${c.dayOffset ?? 0}`,
        checkAvailable: check.available,
        checkCode: check.availabilityCode,
        start: check.startDateTime,
        end: check.endDateTime,
        writeGuard,
      }),
    );
  }

  // Active holds around tonight
  try {
    const holds = await listActiveBookingHoldsForEmployee({
      empId: 5,
      rangeStart: new Date(`${bd}T00:00:00+03:00`),
      rangeEnd: new Date(Date.now() + 48 * 3600_000),
    });
    console.log(
      'holds',
      holds.map((h) => ({
        key: h.holdKey,
        start: h.startAt.toISOString(),
        end: h.endAt.toISOString(),
        exp: h.expiresAt.toISOString(),
      })),
    );
  } catch (e) {
    console.log('holds_error', e instanceof Error ? e.message : e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
