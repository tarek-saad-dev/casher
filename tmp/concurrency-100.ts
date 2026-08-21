import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env.booking-v2-isolated'), override: true });
import { requireBookingV2WriteTestSafety } from '../src/lib/booking/bookingV2WriteSafety';

async function main() {
  requireBookingV2WriteTestSafety();
  const BASE = 'http://localhost:5500';
  const body = (i: number, time: string, date: string) => ({
    branchCode: 'GLEEM',
    date,
    time,
    dayOffset: 0,
    empId: 12,
    mode: 'specific_barber',
    serviceIds: [9],
    customer: { name: 'Conc', phone: `015${String(100000000 + i).slice(-8)}` },
    notes: 'concurrency',
    suppressNotification: true,
    clientRequestId: `conc-only-${Date.now()}-${i}`,
  });

  const boot = await fetch(`${BASE}/api/public/booking/v2/availability`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      employeeId: 12,
      branchCode: 'GLEEM',
      fromBusinessDate: '2026-08-20',
      toBusinessDate: '2026-08-20',
      serviceIds: [9],
    }),
  });
  const matrix = await boot.json();
  const day = matrix.days?.[0];
  const ranges = day?.freeRanges || [];
  const r = ranges.find((x: { startMin: number; endMin: number }) => x.endMin - x.startMin >= 45);
  if (!r) {
    console.log('no range', JSON.stringify(day)?.slice(0, 400));
    process.exit(2);
  }
  const startMin = r.startMin + 15;
  const hh = String(Math.floor(startMin / 60) % 24).padStart(2, '0');
  const mm = String(startMin % 60).padStart(2, '0');
  const time = `${hh}:${mm}`;
  const date = day.businessDate;
  console.log('target', date, time);
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      fetch(`${BASE}/api/public/booking/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': `c20-${Date.now()}-${i}`,
        },
        body: JSON.stringify(body(i, time, date)),
      }).then(async (res) => ({
        status: res.status,
        json: await res.json().catch(() => null),
      })),
    ),
  );
  const winners = results.filter((x) => x.status === 201 || x.status === 200);
  console.log(
    JSON.stringify(
      {
        requests: 20,
        winners: winners.length,
        statuses: results.reduce((a, r) => {
          a[r.status] = (a[r.status] || 0) + 1;
          return a;
        }, {} as Record<number, number>),
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
