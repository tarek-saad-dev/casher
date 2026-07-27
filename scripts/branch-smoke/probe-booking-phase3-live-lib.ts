/**
 * Live Phase 3 barber probe (library, read-only).
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
    listPublicBookingBarbers,
    getPublicBarberCalendar,
    getPublicBarberLocation,
    invalidatePublicBookingBarbersCache,
    PublicBookingBarberError,
  } = await import('../../src/lib/booking/publicBookingBarbers');

  invalidatePublicBookingBarbersCache();

  const t0 = Date.now();
  const global = await listPublicBookingBarbers({ mode: 'global' });
  const coldMs = Date.now() - t0;
  const t1 = Date.now();
  await listPublicBookingBarbers({ mode: 'global' });
  const warmMs = Date.now() - t1;

  const branch = await listPublicBookingBarbers({ mode: 'branch', branchCode: 'GLEEM' });
  const ids = global.barbers.map((b) => b.empId);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  const testLeak = global.barbers.filter(
    (b) => /\[TEST\]|\[SMOKE/i.test(b.name) || /\[TEST\]|\[SMOKE/i.test(b.nameAr),
  );

  let cc: { code?: string } | null = null;
  try {
    await listPublicBookingBarbers({ mode: 'branch', branchCode: 'CAMP_CAESAR' });
  } catch (e) {
    if (e instanceof PublicBookingBarberError) cc = { code: e.code };
  }

  const empId = global.barbers[0]?.empId ?? 12;
  const from = new Date().toISOString().slice(0, 10);
  const toDate = new Date();
  toDate.setUTCDate(toDate.getUTCDate() + 6);
  const to = toDate.toISOString().slice(0, 10);
  const calendar = await getPublicBarberCalendar({ empId, from, to });
  const workingDay = calendar.days.find((d) => d.isWorking)?.date ?? from;
  const offDay = calendar.days.find((d) => !d.isWorking)?.date ?? to;
  const locWork = await getPublicBarberLocation({ empId, date: workingDay });
  const locOff = await getPublicBarberLocation({ empId, date: offDay });

  let testEmp: { code?: string } | null = null;
  try {
    await getPublicBarberLocation({ empId: 1075, date: from });
  } catch (e) {
    if (e instanceof PublicBookingBarberError) testEmp = { code: e.code };
  }

  const out = {
    global: {
      count: global.meta.count,
      duplicateEmpIds: dupes,
      testSmokeLeak: testLeak.length,
      branches: [...new Set(global.barbers.flatMap((b) => b.branches.map((x) => x.branchCode)))],
      bytes: Buffer.byteLength(JSON.stringify(global), 'utf8'),
      coldMs,
      warmMs,
      sample: global.barbers.slice(0, 3).map((b) => ({ empId: b.empId, name: b.nameAr })),
    },
    branchGleem: {
      count: branch.meta.count,
      branch: branch.branch,
    },
    campCaesar: cc,
    calendar: {
      empId,
      from,
      to,
      days: calendar.days.length,
      statuses: [...new Set(calendar.days.map((d) => d.status))],
      overnight: calendar.days.some((d) => d.branches.some((b) => b.endDayOffset === 1)),
    },
    locationWorking: {
      date: workingDay,
      isWorking: locWork.isWorking,
      status: locWork.status,
      branchCode: locWork.branch?.branchCode ?? null,
    },
    locationOff: {
      date: offDay,
      isWorking: locOff.isWorking,
      status: locOff.status,
      branch: locOff.branch,
    },
    testEmpDirect: testEmp,
  };

  fs.writeFileSync(
    path.join(__dirname, '_booking-phase3-live-lib-probe.json'),
    JSON.stringify(out, null, 2),
    'utf8',
  );
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
