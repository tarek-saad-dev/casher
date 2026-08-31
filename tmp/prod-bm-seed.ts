#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
import path from 'path';
import Module from 'module';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

const mod = Module as unknown as { _load: (...args: unknown[]) => unknown };
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

const PHONE = process.env.BM_SMOKE_PHONE || '201557994946';

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

async function main() {
  const { listPublicUpcomingBookings } = await import('../src/lib/booking/publicBookingReader');
  const { evaluatePublicBookingSelection } = await import(
    '../src/lib/booking/publicBookingSelectionEvaluator'
  );
  const { createPublicBooking } = await import('../src/lib/booking/publicBookingCreate');
  const { listPublicDiscoverableBranches } = await import(
    '../src/lib/booking/publicBookingBranchContext'
  );
  const { listPublicBookingBarbers } = await import('../src/lib/booking/publicBookingBarbers');
  const { getCairoBusinessDate } = await import('../src/lib/businessDate');
  const { closePool } = await import('../src/lib/db');

  const up = await listPublicUpcomingBookings({ phone: PHONE, limit: 5 });
  const need = Math.max(0, 2 - up.bookings.length);
  console.log('upcoming', up.bookings.length, 'need', need);
  if (need === 0) {
    console.log('seed skip');
    await closePool();
    return;
  }

  const branches = await listPublicDiscoverableBranches();
  const branch = branches.find((b) => /gleem|جليم/i.test(b.branchName || b.branchCode)) ?? branches[0];
  if (!branch) throw new Error('no branch');
  const workDate = addDaysYmd(getCairoBusinessDate(), 3);
  const barbers = await listPublicBookingBarbers({
    mode: 'branch',
    branchCode: branch.branchCode,
    date: workDate,
  });
  const emp = barbers.barbers[0];
  if (!emp) throw new Error('no barber');

  const times: Array<{ time: string; dayOffset?: 0 | 1 }> = [
    { time: '15:00' },
    { time: '17:00' },
    { time: '18:00' },
    { time: '13:00' },
    { time: '14:00' },
    { time: '20:00', dayOffset: 1 },
    { time: '21:00', dayOffset: 1 },
    { time: '19:00', dayOffset: 1 },
    { time: '12:00' },
    { time: '11:00' },
  ];
  let created = 0;
  const usedTimes = new Set<string>();
  for (let i = 0; i < need; i++) {
    const barber = barbers.barbers[i % barbers.barbers.length] ?? emp;
    for (const slot of times) {
      const key = `${slot.time}:${slot.dayOffset ?? 0}:${barber.empId}`;
      if (usedTimes.has(key)) continue;
      try {
        const ev = await evaluatePublicBookingSelection({
          branchCode: branch.branchCode,
          date: workDate,
          time: slot.time,
          dayOffset: slot.dayOffset ?? 0,
          serviceIds: [20],
          empId: barber.empId,
          mode: 'specific',
          purpose: 'public_booking',
        });
        if (!ev.available) continue;
        const r = await createPublicBooking({
          branchCode: branch.branchCode,
          date: workDate,
          time: slot.time,
          dayOffset: slot.dayOffset ?? 0,
          serviceIds: [20],
          empId: barber.empId,
          mode: 'specific_barber',
          customer: { name: 'BM Smoke', phone: PHONE },
          clientRequestId: `bm-seed-${Date.now()}-${i}`,
          suppressNotification: true,
        });
        usedTimes.add(key);
        console.log('created', r.body.booking.code, workDate, slot.time, barber.nameAr);
        created++;
        break;
      } catch (e) {
        console.log('skip', slot.time, barber.nameAr, e instanceof Error ? e.message : e);
      }
    }
  }
  if (created < 1) throw new Error(`only created ${created}/${need}`);
  await closePool();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
