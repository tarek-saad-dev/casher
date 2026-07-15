/**
 * Phase 3 Test D helper: create vs rescheduleBookingMove (bypasses HTTP session).
 * Temporary — delete after Phase 3 report.
 */
import fs from 'fs';
import path from 'path';

function loadEnvLocal() {
  const p = path.resolve('.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvLocal();

const BASE = process.env.PHASE3_BASE_URL || 'http://localhost:5500';
const MARKER = 'PHASE3AUDIT';
const ATTEMPTS = Number(process.env.PHASE3_ATTEMPTS || 10);

function phoneFor(i: number) {
  return `0109${String(1000000 + (i % 8000000)).padStart(7, '0')}`;
}

function addMinutes(hhmm: string, mins: number) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

async function postJson(url: string, body: unknown, ip: string) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  const { getPool, sql } = await import('./src/lib/db.ts');
  const { rescheduleBookingMove } = await import(
    './src/lib/bookingRescheduleCore.ts'
  );

  const resultsPath = path.resolve('tmp-phase3-concurrency-results.json');
  const prev = fs.existsSync(resultsPath)
    ? JSON.parse(fs.readFileSync(resultsPath, 'utf8'))
    : {};
  const fx = prev.fx;
  if (!fx) throw new Error('Run main harness first to discover fixtures');

  const pool = await getPool();

  async function cleanup() {
    await pool.request().query(`
      DECLARE @ids TABLE (BookingID INT);
      INSERT INTO @ids SELECT BookingID FROM dbo.Bookings WHERE Notes LIKE N'${MARKER}:Dcore%';
      DELETE FROM dbo.BookingServices WHERE BookingID IN (SELECT BookingID FROM @ids);
      DELETE FROM dbo.Bookings WHERE BookingID IN (SELECT BookingID FROM @ids);
    `);
  }

  let both = 0;
  let one = 0;
  let unexpected = 0;
  const evidence: unknown[] = [];

  for (let i = 0; i < ATTEMPTS; i++) {
    await cleanup();
    const moverTime = addMinutes(fx.time, fx.duration + 15);
    const seedMover = await postJson(
      `${BASE}/api/public/booking/create`,
      {
        customer: { name: 'Phase3 Audit', phone: phoneFor(21000 + i) },
        serviceIds: [fx.serviceId],
        date: fx.date,
        time: moverTime,
        dayOffset: 0,
        mode: 'specific',
        empId: fx.empId,
        notes: `${MARKER}:Dcore:${i}:mover`,
        source: 'operations',
      },
      `203.0.114.${10 + i}`,
    );
    if (seedMover.status !== 201) {
      unexpected++;
      evidence.push({ i, seedMover: seedMover.status, err: seedMover.json });
      continue;
    }
    const moverId = seedMover.json.booking.id as number;
    const newStartAt = new Date(
      Date.parse(`${fx.date}T${fx.time}:00+03:00`),
    ).toISOString();

    const createP = postJson(
      `${BASE}/api/public/booking/create`,
      {
        customer: { name: 'Phase3 Audit', phone: phoneFor(22000 + i) },
        serviceIds: [fx.serviceId],
        date: fx.date,
        time: fx.time,
        dayOffset: 0,
        mode: 'specific',
        empId: fx.empId,
        notes: `${MARKER}:Dcore:${i}:create`,
        source: 'operations',
      },
      `203.0.115.${10 + i}`,
    );

    const reschedP = (async () => {
      try {
        const r = await rescheduleBookingMove({
          bookingId: moverId,
          newStartAt,
          operationalDate: fx.date,
          source: 'phase3_audit',
          userId: 0,
        });
        return { status: 200, json: { ok: true, ...r } };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const isConflict =
          msg.includes('تداخل') ||
          msg.includes('غير متاح') ||
          msg.includes('SCHEDULE') ||
          (e as { code?: string })?.code === 'SCHEDULE_CONFLICT';
        return {
          status: isConflict ? 409 : 500,
          json: { ok: false, message: msg },
        };
      }
    })();

    const [rc, rr] = await Promise.all([createP, reschedP]);
    const overlaps = await pool
      .request()
      .input('empId', sql.Int, fx.empId)
      .input('bDate', sql.Date, fx.date)
      .input('sTime', sql.VarChar, `${fx.time}:00`)
      .input('eTime', sql.VarChar, `${fx.endTime}:00`).query(`
        SELECT BookingID FROM dbo.Bookings
        WHERE AssignedEmpID=@empId AND BookingDate=@bDate
          AND LOWER(Status) IN ('confirmed','arrived','queued','in_service','in_progress')
          AND (@sTime < EndTime AND @eTime > StartTime)
      `);

    const createOk = rc.status === 201;
    const reschedOk = rr.status === 200 && rr.json?.ok;
    evidence.push({
      i,
      create: rc.status,
      createId: rc.json?.booking?.id,
      reschedule: rr.status,
      rescheduleMsg: rr.json?.message,
      overlaps: overlaps.recordset.length,
      ids: overlaps.recordset.map((r: { BookingID: number }) => r.BookingID),
    });

    if (createOk && reschedOk && overlaps.recordset.length > 1) both++;
    else if (
      ((createOk && !reschedOk) || (!createOk && reschedOk)) &&
      overlaps.recordset.length === 1
    )
      one++;
    else unexpected++;
  }

  await cleanup();

  const summary = {
    test: 'D_create_vs_reschedule_core',
    attempts: ATTEMPTS,
    bothSucceeded: both,
    oneRejected: one,
    unexpected,
    verdict:
      both > 0
        ? 'FAIL_DOUBLE_BOOK'
        : one === ATTEMPTS
          ? 'PASS'
          : 'MIXED',
    evidence,
  };
  prev.results = (prev.results || []).filter(
    (r: { test: string }) =>
      r.test !== 'D_create_vs_reschedule' &&
      r.test !== 'D_create_vs_reschedule_core',
  );
  prev.results.push(summary);
  fs.writeFileSync(resultsPath, JSON.stringify(prev, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
