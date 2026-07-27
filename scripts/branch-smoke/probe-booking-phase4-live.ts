/**
 * Live Phase 4 availability probe (read-only).
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
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
  const {
    getPublicAvailableDays,
    getPublicAvailableSlots,
    PublicBookingAvailabilityError,
    invalidatePublicBookingAvailabilityCache,
  } = await import('../../src/lib/booking/publicBookingAvailability');
  const { getPublicBarberCalendar } = await import('../../src/lib/booking/publicBookingBarbers');

  invalidatePublicBookingAvailabilityCache();

  const serviceIds = '9'; // Hair Cut — live legitimate
  const empId = 12;

  const t0 = Date.now();
  const days = await getPublicAvailableDays({
    branchCode: 'GLEEM',
    serviceIds,
    empId,
    from: '2026-08-01',
    to: '2026-08-07',
  });
  const daysCold = Date.now() - t0;
  const t1 = Date.now();
  await getPublicAvailableDays({
    branchCode: 'GLEEM',
    serviceIds,
    empId,
    from: '2026-08-01',
    to: '2026-08-07',
  });
  const daysWarm = Date.now() - t1;

  const workDay =
    days.days.find((d) => d.isAvailable)?.date ||
    days.days.find((d) => d.status === 'fully_booked')?.date ||
    '2026-08-01';
  const offDay = days.days.find((d) => !d.isAvailable && d.status !== 'fully_booked')?.date;

  const s0 = Date.now();
  const slots = await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: workDay,
    serviceIds,
    empId,
  });
  const slotsCold = Date.now() - s0;
  const s1 = Date.now();
  await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: workDay,
    serviceIds,
    empId,
  });
  const slotsWarm = Date.now() - s1;

  const anySlots = await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: workDay,
    serviceIds,
  });

  const multi = await getPublicAvailableDays({
    branchCode: 'GLEEM',
    serviceIds: '9,10',
    empId,
    from: '2026-08-01',
    to: '2026-08-03',
  });

  const calPresence = await getPublicBarberCalendar({
    empId,
    from: '2026-08-01',
    to: '2026-08-03',
  });
  const calSlots = await getPublicBarberCalendar({
    empId,
    from: '2026-08-01',
    to: '2026-08-03',
    serviceIds: [9],
    branchCode: 'GLEEM',
  });

  let cc: { code?: string } | null = null;
  try {
    await getPublicAvailableSlots({
      branchCode: 'CAMP_CAESAR',
      date: workDay,
      serviceIds,
    });
  } catch (e) {
    if (e instanceof PublicBookingAvailabilityError) cc = { code: e.code };
  }

  const overnight = slots.slots.filter((s) => s.dayOffset === 1);
  const dupTimes = (() => {
    const keys = slots.slots.map((s) => `${s.dayOffset}|${s.time}`);
    return keys.filter((k, i) => keys.indexOf(k) !== i);
  })();

  const out = {
    days: {
      coldMs: daysCold,
      warmMs: daysWarm,
      statuses: [...new Set(days.days.map((d) => d.status))],
      availableDays: days.days.filter((d) => d.isAvailable).length,
      totalDuration: days.selection.totalDurationMinutes,
    },
    slotsWorking: {
      date: workDay,
      coldMs: slotsCold,
      warmMs: slotsWarm,
      slotCount: slots.meta.slotCount,
      first: slots.slots[0] ?? null,
      overnightCount: overnight.length,
      duplicateTopLevelTimes: dupTimes,
      duration: slots.services.totalDurationMinutes,
      price: slots.services.totalPrice,
    },
    anyBarber: {
      slotCount: anySlots.meta.slotCount,
      eligibleBarberCount: anySlots.meta.eligibleBarberCount,
      maxBarbersOnSlot: Math.max(0, ...anySlots.slots.map((s) => s.barbers.length)),
    },
    multiService: {
      totalDuration: multi.selection.totalDurationMinutes,
    },
    calendar: {
      presenceOnly: calPresence.presenceOnly,
      withServicesPresenceOnly: calSlots.presenceOnly,
      withServicesStatuses: [...new Set(calSlots.days.map((d) => d.status))],
    },
    offDay: offDay
      ? await getPublicAvailableSlots({
          branchCode: 'GLEEM',
          date: offDay,
          serviceIds,
          empId,
        }).then((r) => ({ date: offDay, slotCount: r.meta.slotCount }))
      : null,
    campCaesar: cc,
  };

  fs.writeFileSync(
    path.join(__dirname, '_booking-phase4-live-probe.json'),
    JSON.stringify(out, null, 2),
    'utf8',
  );
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
