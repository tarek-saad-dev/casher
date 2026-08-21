#!/usr/bin/env npx tsx
/**
 * Live probe: create → cancel → V2 availability for 10:00 restore.
 * TEST DB HawaiBookingV2Isolated only. Never touches last132.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { AvailabilityBitmap } from '../src/lib/booking/domain/AvailabilityBitmap';
import { ACTIVE_BOOKING_BLOCK_STATUSES } from '../src/lib/scheduleIntervals';
import { requireBookingV2WriteTestSafety } from '../src/lib/booking/bookingV2WriteSafety';
import { getOperationalDate, shiftCalendarDate } from '../src/lib/businessDate';

const root = process.cwd();
dotenv.config({ path: path.join(root, '.env.booking-v2-isolated'), override: true });

process.env.HAWAI_DB_CLASS = 'isolated';
process.env.BOOKING_V2_WRITE_TEST_OK = '1';
process.env.BOOKING_V2_FORCE_LOCAL_DB = '1';
process.env.BOOKING_V2_USE_TRUSTED_CONNECTION = '1';
process.env.BOOKING_V2_TEST_DB_SERVER = '.\\SQLEXPRESS';
process.env.BOOKING_V2_TEST_DB_NAME = 'HawaiBookingV2Isolated';
process.env.DB_SERVER = '.\\SQLEXPRESS';
process.env.DB_DATABASE = 'HawaiBookingV2Isolated';

const BASE = process.env.VERIFY_BASE_URL || 'http://localhost:5500';
const TARGET_TIME = process.env.VERIFY_SLOT_TIME || '10:00';
const BRANCH_CODE = 'GLEEM';

type Json = Record<string, unknown>;

function log(section: string, data: unknown) {
  console.log(`\n=== ${section} ===`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

function cairoToday(): string {
  return getOperationalDate();
}

function findFreeSlotHhmm(day: Json, durationMin = 30): string | null {
  const freeRanges = (day.freeRanges as Array<{ startMin: number; endMin: number }>) || [];
  for (const r of freeRanges) {
    for (let m = r.startMin; m + durationMin <= r.endMin; m += 15) {
      const h = Math.floor(m / 60);
      const mi = m % 60;
      return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    }
  }
  return null;
}
function slotFreeInDay(
  day: Json,
  timeHhmm: string,
  durationMin = 30,
): { free: boolean; startMin: number; freeRanges: Array<{ startMin: number; endMin: number }> } {
  const [h, m] = timeHhmm.split(':').map(Number);
  const startMin = h! * 60 + m!;
  const freeRanges = (day.freeRanges as Array<{ startMin: number; endMin: number }>) || [];
  let maskB64 = typeof day.freeMaskB64 === 'string' ? day.freeMaskB64 : '';
  if (!maskB64 && freeRanges.length) {
    maskB64 = AvailabilityBitmap.fromFreeRanges(freeRanges).toBase64();
  }
  const mask = AvailabilityBitmap.fromBase64(maskB64);
  const free = mask.hasConsecutiveFreeAt(startMin, durationMin);
  return { free, startMin, freeRanges };
}

async function http(
  method: string,
  urlPath: string,
  opts?: { body?: unknown; cookie?: string },
): Promise<{ status: number; json: Json | null; text: string }> {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(opts?.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(opts?.cookie ? { Cookie: `pos_session=${opts.cookie}` } : {}),
    },
    body: opts?.body != null ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let json: Json | null = null;
  try {
    json = JSON.parse(text) as Json;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

async function login(): Promise<string> {
  const res = await http('POST', '/api/auth/login', {
    body: { loginName: 'localadmin', password: 'LocalTest123' },
  });
  const m = res.text.match(/pos_session=([^;]+)/) || res.text.match(/pos_session=([^,]+)/);
  const fromSetCookie = res.text.includes('pos_session')
    ? null
    : null;
  const header = (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginName: 'localadmin', password: 'LocalTest123' }),
  })).headers.get('set-cookie');
  const cookieMatch = header?.match(/pos_session=([^;]+)/);
  if (!cookieMatch) throw new Error(`login failed ${res.status} ${res.text.slice(0, 200)}`);
  return cookieMatch[1]!;
}

async function findKareemEmpId(cookie: string): Promise<number> {
  const res = await http('GET', '/api/public/booking/v2/bootstrap', { cookie });
  if (!res.json?.employees) throw new Error('bootstrap failed');
  const employees = res.json.employees as Array<{ employeeId: number; nameAr?: string; name?: string; nameEn?: string }>;
  const kareem = employees.find(
    (e) =>
      (e.nameAr && e.nameAr.includes('كريم'))
      || (e.nameEn && e.nameEn.toLowerCase().includes('kareem'))
      || (e.name && e.name.includes('كريم')),
  );
  if (!kareem) {
    log('employees', employees.map((e) => ({ id: e.employeeId, name: e.nameAr || e.name || e.nameEn })));
    throw new Error('Kareem not found in bootstrap');
  }
  return kareem.employeeId;
}

async function v2Availability(args: {
  employeeId: number;
  businessDate: string;
  cookie?: string;
}): Promise<Json> {
  const res = await http('POST', '/api/public/booking/v2/availability', {
    cookie: args.cookie,
    body: {
      employeeId: args.employeeId,
      branchCodes: [BRANCH_CODE],
      fromBusinessDate: args.businessDate,
      toBusinessDate: args.businessDate,
    },
  });
  if (!res.json?.ok) throw new Error(`availability ${res.status} ${res.text.slice(0, 300)}`);
  return res.json;
}

async function resolveProbeDateAndTime(args: {
  empId: number;
  cookie: string;
  targetTime: string;
}): Promise<{ businessDate: string; probeTime: string }> {
  const seen = new Set<string>();
  const candidates = [
    process.env.VERIFY_BUSINESS_DATE?.slice(0, 10),
    cairoToday(),
    shiftCalendarDate(cairoToday(), 1),
  ].filter((d): d is string => Boolean(d))
    .filter((d) => (seen.has(d) ? false : (seen.add(d), true)));

  for (const businessDate of candidates) {
    const matrix = await v2Availability({
      employeeId: args.empId,
      businessDate,
      cookie: args.cookie,
    });
    const day = ((matrix.days as Json[]) || []).find(
      (d) => d.branchCode === BRANCH_CODE && d.businessDate === businessDate,
    );
    if (!day) continue;
    if (slotFreeInDay(day, args.targetTime).free) {
      return { businessDate, probeTime: args.targetTime };
    }
  }

  for (const businessDate of candidates) {
    const matrix = await v2Availability({
      employeeId: args.empId,
      businessDate,
      cookie: args.cookie,
    });
    const day = ((matrix.days as Json[]) || []).find(
      (d) => d.branchCode === BRANCH_CODE && d.businessDate === businessDate,
    );
    if (!day) continue;
    const fallback = findFreeSlotHhmm(day);
    if (fallback) return { businessDate, probeTime: fallback };
  }
  throw new Error(`no free slot for ${args.targetTime} on candidate dates`);
}

async function main() {
  requireBookingV2WriteTestSafety();
  log('CONFIG', {
    BASE,
    operationalToday: cairoToday(),
    TARGET_TIME,
    ACTIVE_BOOKING_BLOCK_STATUSES,
  });

  const cookie = await login();
  log('LOGIN', 'ok');

  const empId = await findKareemEmpId(cookie);
  log('KAREEM', { empId });

  const { businessDate, probeTime } = await resolveProbeDateAndTime({
    empId,
    cookie,
    targetTime: TARGET_TIME,
  });

  const beforeMatrix = await v2Availability({ employeeId: empId, businessDate, cookie });
  const beforeDay = ((beforeMatrix.days as Json[]) || []).find(
    (d) => d.branchCode === BRANCH_CODE && d.businessDate === businessDate,
  );
  if (!beforeDay) throw new Error('no day cell before create');
  const beforeSlot = slotFreeInDay(beforeDay, probeTime);
  log('V2 BEFORE CREATE', {
    businessDate,
    availabilityRevision: beforeDay.availabilityRevision,
    probeTime,
    slotFree: beforeSlot.free,
    freeRanges: beforeSlot.freeRanges,
  });
  if (!beforeSlot.free) throw new Error(`probe slot ${probeTime} not free before create`);

  const createRes = await http('POST', '/api/public/booking/create', {
    cookie,
    body: {
      customer: { name: 'Cancel Live Probe', phone: '01000000999' },
      serviceIds: [Number(process.env.VERIFY_SERVICE_ID || 9)],
      date: businessDate,
      time: probeTime,
      dayOffset: 0,
      mode: 'specific',
      empId,
      source: 'operations',
    },
  });
  if (!createRes.json?.ok) throw new Error(`create failed ${createRes.status} ${createRes.text}`);
  const booking = createRes.json.booking as Json;
  const bookingId = Number(booking.id);
  log('CREATE', {
    bookingId,
    code: booking.code,
    empId: (booking.barber as Json)?.empId ?? empId,
    date: booking.date,
    startDateTime: booking.startDateTime,
    endDateTime: booking.endDateTime,
    branch: booking.branch,
  });

  const afterCreateMatrix = await v2Availability({ employeeId: empId, businessDate, cookie });
  const afterCreateDay = ((afterCreateMatrix.days as Json[]) || []).find(
    (d) => d.branchCode === BRANCH_CODE && d.businessDate === businessDate,
  )!;
  const afterCreateSlot = slotFreeInDay(afterCreateDay, probeTime);
  log('V2 AFTER CREATE', {
    availabilityRevision: afterCreateDay.availabilityRevision,
    probeTime,
    slotFree: afterCreateSlot.free,
    freeRanges: afterCreateSlot.freeRanges,
  });

  const cancelRes = await http('PATCH', `/api/bookings/${bookingId}`, {
    cookie,
    body: { action: 'cancel' },
  });
  if (!cancelRes.json?.ok) throw new Error(`cancel failed ${cancelRes.status} ${cancelRes.text}`);
  log('CANCEL API', cancelRes.json);

  const { getPool, sql } = await import('../src/lib/db');
  const db = await getPool();
  const row = await db.request().input('id', bookingId).query(`
    SELECT BookingID, BookingCode, AssignedEmpID, BranchID, BookingDate,
           StartTime, EndTime, Status, CancelReason, CancelledAt, CreatedAt, UpdatedAt
    FROM dbo.Bookings WHERE BookingID = @id
  `);
  log('DB ROW AFTER CANCEL', row.recordset[0]);

  const revRow = await db.request()
    .input('empId', empId)
    .input('bd', businessDate)
    .query(`
      SELECT TOP 1 *
      FROM dbo.TblBookingAvailabilityRevision
      WHERE EmpID = @empId AND BusinessDate = @bd
    `).catch(() => ({ recordset: [] }));
  log('REVISION SQL', revRow.recordset[0] ?? 'table missing or no row');

  const statusList = ACTIVE_BOOKING_BLOCK_STATUSES.map((s) => `'${s}'`).join(',');
  const occRes = await db.request()
    .input('empId', sql.Int, empId)
    .input('bd', sql.Date, businessDate)
    .query(`
      SELECT b.BookingID, b.Status, b.StartTime, b.EndTime
      FROM dbo.Bookings b
      WHERE b.AssignedEmpID = @empId
        AND b.BookingDate = @bd
        AND LOWER(b.Status) IN (${statusList})
      ORDER BY b.StartTime
    `);
  log('OCCUPANCY SQL (ACTIVE_BOOKING_BLOCK_STATUSES)', {
    rows: occRes.recordset,
    cancelledBookingStillPresent: (occRes.recordset as Array<{ BookingID: number }>).some(
      (r) => r.BookingID === bookingId,
    ),
  });

  const afterCancelMatrix = await v2Availability({ employeeId: empId, businessDate, cookie });
  const afterCancelDay = ((afterCancelMatrix.days as Json[]) || []).find(
    (d) => d.branchCode === BRANCH_CODE && d.businessDate === businessDate,
  )!;
  const afterCancelSlot = slotFreeInDay(afterCancelDay, probeTime);
  log('V2 AFTER CANCEL (DIRECT API)', {
    availabilityRevision: afterCancelDay.availabilityRevision,
    probeTime,
    slotFree: afterCancelSlot.free,
    freeRanges: afterCancelSlot.freeRanges,
    revisionChanged: beforeDay.availabilityRevision !== afterCancelDay.availabilityRevision,
    freeMaskChanged: beforeDay.freeMaskB64 !== afterCancelDay.freeMaskB64,
  });

  const timelinePredicate = "Status IN ('confirmed','arrived','in_progress','queued','in_service')";
  const v2Predicate = `LOWER(Status) IN (${ACTIVE_BOOKING_BLOCK_STATUSES.map((s) => `'${s}'`).join(',')})`;

  console.log('\n=== PREDICATES ===');
  console.log('Timeline:', timelinePredicate);
  console.log('V2 loadOccupancyBatch:', v2Predicate);

  const occRows = occRes.recordset as Array<{ BookingID: number }>;
  const pass =
    !occRows.some((r) => r.BookingID === bookingId)
    && afterCancelSlot.free;

  console.log('\n=== VERDICT ===');
  if (pass) {
    console.log(`V2 API AFTER CANCEL: ${probeTime} FREE — if modal still broken → FRONTEND store`);
  } else if (occRows.some((r) => r.BookingID === bookingId)) {
    console.log('ROOT CAUSE: BACKEND — cancelled booking still in occupancy SQL');
  } else if (!afterCancelSlot.free) {
    console.log(`ROOT CAUSE: BACKEND/CACHE — V2 API still shows ${probeTime} occupied`);
  }

  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
