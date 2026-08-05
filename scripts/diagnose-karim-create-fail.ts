#!/usr/bin/env npx tsx
/**
 * Pinpoint why Karim 20:45 passes slots/plan but create returns SLOT_UNAVAILABLE.
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
  const { evaluatePublicBookingSelection } = await import(
    '../src/lib/booking/publicBookingSelectionEvaluator'
  );
  const { assertEmployeeIntervalAvailable, ScheduleConflictError } = await import(
    '../src/lib/scheduleIntegrity'
  );
  const { resolveSelectedBookingServices } = await import(
    '../src/lib/booking/bookingServiceDuration'
  );
  const { resolvePublicBookingBranchContext } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const { getEmployeeBusyIntervals } = await import('../src/lib/scheduleIntegrity');
  const { listActiveBookingHoldsForEmployee, assertNoHoldConflict } = await import(
    '../src/lib/booking/bookingHold'
  );

  const date = '2026-08-05';
  const time = process.argv[2] || '20:45';
  const serviceIds = [Number(process.argv[3] || 20)];
  const empId = 5;

  console.log(JSON.stringify({ date, time, serviceIds, empId }));

  for (const purpose of ['check_slot', 'plan', 'create_precheck'] as const) {
    const ev = await evaluatePublicBookingSelection({
      branchCode: 'GLEEM',
      date,
      time,
      dayOffset: 0,
      serviceIds,
      empId,
      mode: 'specific_barber',
      purpose,
    });
    console.log(
      JSON.stringify({
        purpose,
        available: ev.available,
        code: ev.availabilityCode,
        dur: ev.totalDurationMinutes,
        subtotal: ev.subtotal,
        start: ev.startDateTime,
        end: ev.endDateTime,
        emp: ev.specificBarber?.empId,
        meta: ev.safeMetadata,
      }),
    );
  }

  const precheck = await evaluatePublicBookingSelection({
    branchCode: 'GLEEM',
    date,
    time,
    dayOffset: 0,
    serviceIds,
    empId,
    mode: 'specific_barber',
    purpose: 'create_precheck',
  });

  if (!precheck.available || !precheck.startDateTime || !precheck.endDateTime) {
    console.log('PRECHECK_FAIL');
    return;
  }

  const branchNow = await resolvePublicBookingBranchContext({
    branchCode: 'GLEEM',
    purpose: 'public_booking',
  });
  console.log(
    JSON.stringify({
      branchId: branchNow.branchId,
      bookingEnabled: branchNow.bookingEnabled,
      publicBookingEnabled: branchNow.publicBookingEnabled,
      tz: branchNow.timezone,
    }),
  );

  const servicesNow = await resolveSelectedBookingServices({
    branchContext: branchNow,
    serviceIds: precheck.selectedServices.map((s) => s.serviceId),
  });
  console.log(
    JSON.stringify({
      durationMatch: servicesNow.totalDurationMinutes === precheck.totalDurationMinutes,
      priceMatch: servicesNow.totalPrice === precheck.subtotal,
      precheckDur: precheck.totalDurationMinutes,
      nowDur: servicesNow.totalDurationMinutes,
      precheckPrice: precheck.subtotal,
      nowPrice: servicesNow.totalPrice,
    }),
  );

  const startAt = new Date(precheck.startDateTime);
  const endAt = new Date(precheck.endDateTime);

  try {
    await assertNoHoldConflict({
      empId,
      startAt,
      endAt,
      excludeHoldKey: null,
    });
    console.log('holdConflict: OK');
  } catch (e) {
    console.log('holdConflict:', e instanceof Error ? e.message : e, (e as any)?.code);
  }

  const busy = await getEmployeeBusyIntervals({
    empId,
    now: new Date(),
    operationalDate: date,
    branchId: branchNow.branchId,
    excludeHoldKey: null,
    rangeEndMs: endAt.getTime(),
  });
  const overlapping = busy.filter(
    (b) => b.start.getTime() < endAt.getTime() && b.end.getTime() > startAt.getTime(),
  );
  console.log(
    JSON.stringify({
      busyCount: busy.length,
      overlappingCount: overlapping.length,
      overlapping: overlapping.map((b) => ({
        source: b.source,
        id: b.id,
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        label: b.label,
      })),
    }),
  );

  try {
    await assertEmployeeIntervalAvailable({
      empId,
      startAt,
      endAt,
      operationalDate: date,
      branchId: branchNow.branchId,
      excludeHoldKey: null,
    });
    console.log('writeGuard: OK');
  } catch (e) {
    console.log(
      'writeGuard FAIL:',
      e instanceof ScheduleConflictError ? 'ScheduleConflictError' : e instanceof Error ? e.message : e,
      (e as any)?.code,
      JSON.stringify((e as any)?.details ?? null),
    );
  }

  const holds = await listActiveBookingHoldsForEmployee({
    empId,
    rangeStart: startAt,
    rangeEnd: endAt,
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

  // Raw overlapping bookings around the slot
  const db = await getPool();
  const raw = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('d', sql.Date, date)
    .query(`
      SELECT BookingID, BookingDate, StartTime, EndTime, Status, WorkDate, DayOffset, BranchID
      FROM dbo.Bookings
      WHERE AssignedEmpID = @empId
        AND Status IN (N'confirmed', N'Confirmed', N'pending', N'Pending', N'in_progress', N'InProgress')
        AND (
          BookingDate IN (@d, DATEADD(day, 1, @d), DATEADD(day, -1, @d))
          OR WorkDate IN (@d, DATEADD(day, 1, @d), DATEADD(day, -1, @d))
        )
      ORDER BY BookingDate, StartTime
    `);
  console.log(
    'rawBookings',
    raw.recordset.map((r: any) => ({
      id: r.BookingID,
      bd: r.BookingDate,
      st: String(r.StartTime),
      et: String(r.EndTime),
      status: r.Status,
      wd: r.WorkDate,
      off: r.DayOffset,
      br: r.BranchID,
    })),
  );

  await db.close?.();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
