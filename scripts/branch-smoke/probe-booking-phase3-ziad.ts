import path from 'path';
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
    getPublicBarberCalendar,
    getPublicBarberLocation,
    invalidatePublicBookingBarbersCache,
  } = await import('../../src/lib/booking/publicBookingBarbers');
  invalidatePublicBookingBarbersCache();
  const cal = await getPublicBarberCalendar({ empId: 12, from: '2026-08-01', to: '2026-08-07' });
  console.log(
    JSON.stringify(
      {
        statuses: [...new Set(cal.days.map((d) => d.status))],
        days: cal.days.map((d) => ({
          date: d.date,
          status: d.status,
          branches: d.branches.map((b) => ({
            c: b.branchCode,
            start: b.startTime,
            end: b.endTime,
            endDayOffset: b.endDayOffset,
          })),
        })),
      },
      null,
      2,
    ),
  );
  const w = cal.days.find((d) => d.isWorking);
  const off = cal.days.find((d) => !d.isWorking);
  if (w) console.log('working', JSON.stringify(await getPublicBarberLocation({ empId: 12, date: w.date })));
  if (off) console.log('off', JSON.stringify(await getPublicBarberLocation({ empId: 12, date: off.date })));
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
