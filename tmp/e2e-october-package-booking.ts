/**
 * E2E: October Package (PackageID 7) public booking — catalog → slots → plan → check-slot → create → verify → cancel.
 * WhatsApp is forced off in-process and suppressNotification is set, so no customer/team messages are sent.
 * Usage: npx tsx tmp/e2e-october-package-booking.ts [GLEEM CAMP_CAESAR]
 */
import { readFileSync } from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import Module from 'module';

const mod = Module as any;
const origLoad = mod._load;
mod._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {};
  return origLoad.call(this, request, ...rest);
};

for (const envPath of ['.env.local', '.env']) {
  try {
    for (const line of readFileSync(path.join(process.cwd(), envPath), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    /* ignore */
  }
}
delete process.env.HAWAI_DB_CLASS;
process.env.WHATSAPP_INTEGRATION_ENABLED = 'false';

const PACKAGE_ID = 7;
const SERVICE_IDS = [9, 10, 22, 29];
const TEST_PHONE = '01000033307';
const TEST_NAME = 'اختبار باكدج أكتوبر (يلغى)';

function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const branches = process.argv.slice(2).length ? process.argv.slice(2) : ['GLEEM', 'CAMP_CAESAR'];
  const { getPool, setDbTarget, sql } = await import('../src/lib/db');
  await setDbTarget('cloud');
  const db = await getPool();
  const { getPublicPackagesCatalog } = await import('../src/lib/catalog/publicPackagesCatalog');
  const { getPublicAvailableSlots } = await import('../src/lib/booking/publicBookingAvailability');
  const { evaluatePublicBookingSelection, assertCheckSlotPlanParity } = await import(
    '../src/lib/booking/publicBookingSelectionEvaluator'
  );
  const { createPublicBooking } = await import('../src/lib/booking/publicBookingCreate');
  const { cancelPublicBooking } = await import('../src/lib/booking/publicBookingCancellation');

  let fail = 0;
  const check = (ok: boolean, msg: string) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
    if (!ok) fail += 1;
  };

  const existingClient = await db
    .request()
    .input('m', sql.NVarChar(30), TEST_PHONE)
    .query(`SELECT ClientID, [Name] FROM dbo.TblClient WHERE Mobile = @m`);
  if (existingClient.recordset.some((r: any) => String(r.Name) !== TEST_NAME)) {
    throw new Error(`Test phone ${TEST_PHONE} belongs to a real client — aborting`);
  }

  const catalog = await getPublicPackagesCatalog();
  const oct = catalog.packages.find((p) => p.packageId === PACKAGE_ID);
  check(!!oct && oct.price === 333, `public packages catalog lists October @333 (kind=${oct?.kind})`);

  for (const branchCode of branches) {
    console.log(`\n===== ${branchCode} =====`);
    let picked: { date: string; time: string; dayOffset: 0 | 1; empId: number } | null = null;
    let slotDuration = 0;
    for (let d = 1; d <= 6 && !picked; d++) {
      const date = addDays(cairoToday(), d);
      const slots = await getPublicAvailableSlots({ branchCode, date, serviceIds: SERVICE_IDS });
      slotDuration = slots.services.totalDurationMinutes;
      const slot = slots.slots.find((s) => s.barbers.length > 0);
      if (slot) picked = { date, time: slot.time, dayOffset: slot.dayOffset, empId: slot.barbers[0].empId };
    }
    check(!!picked, `availability found a slot for services ${SERVICE_IDS} (duration ${slotDuration}m)`);
    if (!picked) continue;
    console.log(`  slot ${picked.date} ${picked.time} dayOffset=${picked.dayOffset} empId=${picked.empId}`);

    const selection = {
      branchCode,
      date: picked.date,
      time: picked.time,
      dayOffset: picked.dayOffset,
      serviceIds: SERVICE_IDS,
      packageId: PACKAGE_ID,
      empId: picked.empId,
      mode: 'specific_barber',
    };
    const plan = await evaluatePublicBookingSelection({ ...selection, purpose: 'plan' });
    check(plan.available, `plan available (${plan.availabilityCode ?? 'ok'})`);
    check(plan.subtotal === 333, `plan total=333 (got ${plan.subtotal})`);
    check(plan.packageBooking?.packageId === PACKAGE_ID, 'plan carries packageId=7');
    check(
      JSON.stringify(plan.selectedServices.map((s) => s.serviceId)) === JSON.stringify(SERVICE_IDS),
      `plan services ${plan.selectedServices.map((s) => `${s.serviceId}:${s.price}/${s.durationMinutes}m`).join(', ')}`,
    );
    check(
      plan.totalDurationMinutes === slotDuration,
      `plan duration ${plan.totalDurationMinutes}m == branch services duration ${slotDuration}m`,
    );
    if (!plan.available || !plan.planToken) continue;

    const checkSlot = await evaluatePublicBookingSelection({ ...selection, purpose: 'check_slot' });
    let parity = true;
    try {
      assertCheckSlotPlanParity(checkSlot, plan);
    } catch {
      parity = false;
    }
    check(checkSlot.available && parity, 'check-slot available and matches plan');

    const created = await createPublicBooking({
      ...selection,
      planToken: plan.planToken,
      customer: { name: TEST_NAME, phone: TEST_PHONE },
      notes: 'E2E test — October package (auto-cancelled)',
      idempotencyKeyHeader: randomUUID(),
      suppressNotification: true,
    });
    const body: any = created.body;
    check(created.httpStatus === 201 && body.ok === true, 'create returned 201');
    const code = String(body.booking?.code ?? '');
    console.log(`  booking code=${code} whatsapp=${JSON.stringify(body.whatsapp)}`);

    const row = await db
      .request()
      .input('code', sql.NVarChar(40), code)
      .query(`
        SELECT b.BookingID, b.Status, b.Notes, b.TotalPrice, b.TotalDurationMinutes, b.AssignedEmpID
        FROM dbo.Bookings b WHERE b.BookingCode = @code
      `)
      .catch(async () =>
        db.request().input('code', sql.NVarChar(40), code).query(`
          SELECT b.* FROM dbo.Bookings b WHERE b.BookingCode = @code
        `),
      );
    const booking: any = row.recordset[0];
    check(!!booking, `booking row exists (BookingID=${booking?.BookingID})`);
    if (booking) {
      check(
        String(booking.Notes ?? '').includes(`[groomPackage] packageId=${PACKAGE_ID};packagePrice=333;`),
        'booking notes carry package metadata (packageId=7, packagePrice=333)',
      );
      const svc = await db
        .request()
        .input('id', sql.Int, booking.BookingID)
        .query(`SELECT ProID, Price, DurationMinutes FROM dbo.BookingServices WHERE BookingID = @id ORDER BY BookingServiceID`);
      const lines = svc.recordset as Array<{ ProID: number; Price: number; DurationMinutes: number }>;
      console.log(`  BookingServices: ${lines.map((l) => `${l.ProID}:${l.Price}/${l.DurationMinutes}m`).join(', ')}`);
      check(
        JSON.stringify(lines.map((l) => Number(l.ProID))) === JSON.stringify(SERVICE_IDS),
        'BookingServices has the 4 package services',
      );
      check(lines.reduce((s, l) => s + Number(l.Price), 0) === 333, 'BookingServices price sum = 333');
      check(
        lines.reduce((s, l) => s + Number(l.DurationMinutes), 0) === plan.totalDurationMinutes,
        'BookingServices duration sum = plan duration',
      );
      if (booking.TotalPrice != null) check(Number(booking.TotalPrice) === 333, `Bookings.TotalPrice=333`);
    }

    const cancel = await cancelPublicBooking({
      code,
      phone: TEST_PHONE,
      reasonText: 'E2E test booking',
      idempotencyKey: randomUUID(),
    });
    check((cancel.body as any).ok === true, `cancelled ${code}`);
  }

  console.log('\n===== Regression (plan only, no create) =====');
  for (const groom of catalog.groom) {
    for (let d = 1; d <= 6; d++) {
      const date = addDays(cairoToday(), d);
      const p = await evaluatePublicBookingSelection({
        branchCode: 'GLEEM',
        date,
        time: '14:00',
        dayOffset: 0,
        packageId: groom.packageId,
        purpose: 'plan',
      });
      check(
        p.subtotal === groom.price && p.totalDurationMinutes === groom.durationMinutes,
        `groom ${groom.nameEn}: total=${p.subtotal} (exp ${groom.price}), duration=${p.totalDurationMinutes} (exp package ${groom.durationMinutes})`,
      );
      break;
    }
  }
  const normal = await evaluatePublicBookingSelection({
    branchCode: 'GLEEM',
    date: addDays(cairoToday(), 2),
    time: '14:00',
    dayOffset: 0,
    serviceIds: SERVICE_IDS,
    purpose: 'plan',
  });
  check(
    normal.packageBooking == null && normal.subtotal === 720,
    `normal services booking unchanged: total=${normal.subtotal} (sum of list prices 720), no package`,
  );

  console.log(`\nOVERALL: ${fail === 0 ? 'PASS' : 'FAIL'} (failures=${fail})`);
  // allow post-response schedulers to flush (WhatsApp disabled)
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 2000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
