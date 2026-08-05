#!/usr/bin/env npx tsx
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
  const { getEmployeeBusyIntervals } = await import('../src/lib/scheduleIntegrity');
  const { getPool, sql } = await import('../src/lib/db');
  const { evaluatePublicBookingSelection } = await import(
    '../src/lib/booking/publicBookingSelectionEvaluator'
  );

  const startAt = new Date('2026-08-05T19:00:00.000Z');
  const endAt = new Date('2026-08-05T19:45:00.000Z');
  const busy = await getEmployeeBusyIntervals({
    empId: 5,
    now: new Date(),
    operationalDate: '2026-08-05',
    branchId: 1,
    rangeEndMs: endAt.getTime(),
  });
  const overlapping = busy.filter(
    (b) => b.start.getTime() < endAt.getTime() && b.end.getTime() > startAt.getTime(),
  );
  console.log(
    JSON.stringify(
      {
        busyCount: busy.length,
        overlapping: overlapping.map((b) => ({
          source: b.source,
          id: b.id,
          start: b.start.toISOString(),
          end: b.end.toISOString(),
          label: b.label,
        })),
        all: busy.map((b) => ({
          source: b.source,
          id: b.id,
          start: b.start.toISOString(),
          end: b.end.toISOString(),
          label: b.label,
        })),
      },
      null,
      2,
    ),
  );

  const ev = await evaluatePublicBookingSelection({
    branchCode: 'GLEEM',
    date: '2026-08-05',
    time: '22:00',
    dayOffset: 0,
    serviceIds: [20],
    empId: 5,
    mode: 'specific_barber',
    purpose: 'check_slot',
  });
  console.log(
    JSON.stringify({
      available: ev.available,
      code: ev.availabilityCode,
      message: ev.availabilityMessage,
      meta: ev.safeMetadata,
      start: ev.startDateTime,
      end: ev.endDateTime,
    }),
  );

  const db = await getPool();
  const q = await db
    .request()
    .input('d', sql.Date, '2026-08-05')
    .query(`
      SELECT BookingID, BookingDate,
             CONVERT(varchar(8), StartTime, 108) AS st,
             CONVERT(varchar(8), EndTime, 108) AS et,
             Status
      FROM dbo.Bookings
      WHERE AssignedEmpID = 5
        AND BookingDate IN (@d, DATEADD(day, 1, @d), DATEADD(day, -1, @d))
        AND Status NOT IN (N'cancelled', N'Canceled', N'no_show')
      ORDER BY BookingDate, StartTime
    `);
  console.log('bookings', JSON.stringify(q.recordset, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
