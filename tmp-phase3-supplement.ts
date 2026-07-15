/**
 * Phase 3 supplemental: Test D (core reschedule) + Test F (true cross-midnight overlap).
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
    )
      v = v.slice(1, -1);
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
  const day = Math.floor(total / (24 * 60));
  const rem = total % (24 * 60);
  return {
    time: `${String(Math.floor(rem / 60)).padStart(2, '0')}:${String(rem % 60).padStart(2, '0')}`,
    dayOffset: day as 0 | 1,
  };
}
function nextDateStr(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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
  const resultsPath = path.resolve('tmp-phase3-concurrency-results.json');
  const prev = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const fx = prev.fx;
  const { getPool, sql } = await import('./src/lib/db.ts');
  const { rescheduleBookingMove } = await import(
    './src/lib/bookingRescheduleCore.ts'
  );
  const pool = await getPool();

  async function cleanup(pattern: string) {
    await pool.request().query(`
      DECLARE @ids TABLE (BookingID INT);
      INSERT INTO @ids SELECT BookingID FROM dbo.Bookings WHERE Notes LIKE N'${pattern}';
      DELETE FROM dbo.BookingServices WHERE BookingID IN (SELECT BookingID FROM @ids);
      DELETE FROM dbo.Bookings WHERE BookingID IN (SELECT BookingID FROM @ids);
    `);
  }

  // ── Test D core ─────────────────────────────────────────────────────────
  {
    let both = 0,
      one = 0,
      unexpected = 0;
    const evidence: unknown[] = [];
    for (let i = 0; i < ATTEMPTS; i++) {
      await cleanup(`${MARKER}:Dcore%`);
      const moverTime = addMinutes(fx.time, fx.duration + 15).time;
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
        `203.0.114.${20 + i}`,
      );
      if (seedMover.status !== 201) {
        unexpected++;
        evidence.push({ i, seed: seedMover.status, err: seedMover.json?.message });
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
        `203.0.115.${20 + i}`,
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
          const conflict =
            /تداخل|غير متاح|SCHEDULE|خارج|مغلقة/.test(msg) ||
            (e as { name?: string })?.name === 'ScheduleConflictError';
          return { status: conflict ? 409 : 500, json: { ok: false, message: msg } };
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
        msg: rr.json?.message,
        overlaps: overlaps.recordset.length,
      });
      if (createOk && reschedOk && overlaps.recordset.length > 1) both++;
      else if (
        ((createOk && !reschedOk) || (!createOk && reschedOk)) &&
        overlaps.recordset.length === 1
      )
        one++;
      else unexpected++;
    }
    await cleanup(`${MARKER}:Dcore%`);
    const dSummary = {
      test: 'D_create_vs_reschedule_core',
      attempts: ATTEMPTS,
      bothSucceeded: both,
      oneRejected: one,
      unexpected,
      verdict: both > 0 ? 'FAIL_DOUBLE_BOOK' : one === ATTEMPTS ? 'PASS' : 'MIXED',
      evidence,
    };
    prev.results = (prev.results || []).filter(
      (r: { test: string }) =>
        !['D_create_vs_reschedule', 'D_create_vs_reschedule_core'].includes(r.test),
    );
    prev.results.push(dSummary);
    console.log('D:', JSON.stringify(dSummary, null, 2));
  }

  // ── Test F true cross-midnight ──────────────────────────────────────────
  {
    let both = 0,
      one = 0,
      unexpected = 0,
      skipped = 0;
    const evidence: unknown[] = [];
    // Prefer 23:30 + 40m service (crosses to 00:10)
    const longSvc = fx.serviceId2;
    let boardDate: string | null = null;
    let lateTime = '23:30';
    for (let d = 3; d <= 10; d++) {
      const tryDate = (() => {
        const now = new Date();
        const cairo = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
        cairo.setDate(cairo.getDate() + d);
        return `${cairo.getFullYear()}-${String(cairo.getMonth() + 1).padStart(2, '0')}-${String(cairo.getDate()).padStart(2, '0')}`;
      })();
      const qs = new URLSearchParams({
        date: tryDate,
        serviceIds: String(longSvc),
        mode: 'specific',
        empId: String(fx.empId),
        source: 'operations',
      });
      const data = await (await fetch(`${BASE}/api/public/booking/available-slots?${qs}`)).json();
      const slots = data.slots || [];
      const late = slots.find((s: { time: string; dayOffset?: number }) => s.time === '23:30' && (s.dayOffset ?? 0) === 0);
      const early = slots.find(
        (s: { time: string; dayOffset?: number }) =>
          s.dayOffset === 1 && (s.time === '00:00' || s.time === '00:15'),
      );
      if (late && early) {
        boardDate = tryDate;
        lateTime = late.time;
        break;
      }
    }

    if (!boardDate) {
      prev.results = (prev.results || []).filter(
        (r: { test: string }) => r.test !== 'F_cross_midnight' && r.test !== 'F_cross_midnight_overlap',
      );
      prev.results.push({
        test: 'F_cross_midnight_overlap',
        verdict: 'SKIPPED_NO_SLOTS',
        note: 'No 23:30 + dayOffset=1 early slots',
      });
    } else {
      for (let i = 0; i < ATTEMPTS; i++) {
        await cleanup(`${MARKER}:Fx%`);
        const seed = await postJson(
          `${BASE}/api/public/booking/create`,
          {
            customer: { name: 'Phase3 Audit', phone: phoneFor(30000 + i) },
            serviceIds: [longSvc],
            date: boardDate,
            time: lateTime,
            dayOffset: 0,
            mode: 'specific',
            empId: fx.empId,
            notes: `${MARKER}:Fx:${i}:seed`,
            source: 'operations',
          },
          `203.0.116.${10 + i}`,
        );
        if (seed.status !== 201) {
          skipped++;
          evidence.push({ i, seed: seed.status, err: seed.json?.message || seed.json?.error });
          continue;
        }
        // Race early creates — board date + dayOffset=1 @ 00:00 should overlap seed ending ~00:10
        const earlyCreate = postJson(
          `${BASE}/api/public/booking/create`,
          {
            customer: { name: 'Phase3 Audit', phone: phoneFor(31000 + i) },
            serviceIds: [fx.serviceId],
            date: boardDate,
            time: '00:00',
            dayOffset: 1,
            mode: 'specific',
            empId: fx.empId,
            notes: `${MARKER}:Fx:${i}:earlyCreate`,
            source: 'operations',
          },
          `203.0.117.${10 + i}`,
        );
        const earlyPlan = postJson(
          `${BASE}/api/public/booking/plan`,
          {
            customer: { name: 'Phase3 Audit', phone: phoneFor(32000 + i) },
            serviceIds: [fx.serviceId],
            date: boardDate,
            time: '00:00',
            dayOffset: 1,
            mode: 'specific',
            empId: fx.empId,
            notes: `${MARKER}:Fx:${i}:earlyPlan`,
          },
          `203.0.118.${10 + i}`,
        );
        const [rc, rp] = await Promise.all([earlyCreate, earlyPlan]);
        const rows = await pool.request().query(`
          SELECT BookingID, CONVERT(varchar(10), BookingDate, 120) BD,
                 CONVERT(varchar(8), StartTime, 108) ST,
                 CONVERT(varchar(8), EndTime, 108) ET, Status, Notes
          FROM dbo.Bookings
          WHERE Notes LIKE N'${MARKER}:Fx:${i}:%'
            AND LOWER(Status) IN ('confirmed','arrived','queued','in_service','in_progress')
          ORDER BY BookingID
        `);
        const earlyOk = rc.status === 201 || rp.status === 201;
        evidence.push({
          i,
          boardDate,
          lateTime,
          seedId: seed.json?.booking?.id,
          seedActualDate: seed.json?.booking?.actualDate,
          seedEnd: seed.json?.booking?.endTime,
          createEarly: rc.status,
          planEarly: rp.status,
          planReason: rp.json?.reason || rp.json?.error,
          activeRows: rows.recordset,
        });
        // Wall-clock overlap double-book if seed remains AND an early booking committed
        if (earlyOk && rows.recordset.length > 1) both++;
        else if (!earlyOk && rows.recordset.length === 1) one++;
        else unexpected++;
      }
      await cleanup(`${MARKER}:Fx%`);
      const fSummary = {
        test: 'F_cross_midnight_overlap',
        attempts: ATTEMPTS - skipped,
        skipped,
        bothSucceeded: both,
        oneRejected: one,
        unexpected,
        boardDate,
        lateTime,
        longSvc,
        verdict:
          both > 0
            ? 'FAIL_DOUBLE_BOOK'
            : one > 0 && both === 0
              ? 'PASS'
              : 'MIXED_OR_SKIP',
        evidence,
      };
      prev.results = (prev.results || []).filter(
        (r: { test: string }) =>
          r.test !== 'F_cross_midnight' && r.test !== 'F_cross_midnight_overlap',
      );
      prev.results.push(fSummary);
      console.log('F:', JSON.stringify(fSummary, null, 2));
    }
  }

  // ── Direct proof: plan write-guard SQL cannot see cross-date / wrap-end ──
  {
    await cleanup(`${MARKER}:Fsql%`);
    // Insert A ending past midnight using raw SQL (same shape create would write for overnight end)
    const client = await pool.request().query(`
      SELECT TOP 1 ClientID FROM dbo.TblClient ORDER BY ClientID DESC
    `);
    const clientId = client.recordset[0]?.ClientID ?? 1;
    const dateA = fx.date;
    const dateB = nextDateStr(fx.date);
    const ins = await pool
      .request()
      .input('c', sql.Int, clientId)
      .input('e', sql.Int, fx.empId)
      .input('d', sql.Date, dateA)
      .query(`
        INSERT INTO dbo.Bookings
          (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime, Status, Source, Notes, BookingCode, CreatedByUserID)
        OUTPUT INSERTED.BookingID
        VALUES (@c, @e, @d, '23:30:00', '00:20:00', 'confirmed', 'operations', N'${MARKER}:Fsql:A', N'P3FSQLA', 0)
      `);
    const idA = ins.recordset[0].BookingID;

    // Same conflict predicate as plan/route.ts L597-606 on date B
    const planStyle = await pool
      .request()
      .input('empId', sql.Int, fx.empId)
      .input('bDate', sql.Date, dateB)
      .input('sTime', sql.VarChar, '00:00:00')
      .input('eTime', sql.VarChar, '00:30:00').query(`
        SELECT BookingID FROM dbo.Bookings WITH (UPDLOCK, HOLDLOCK)
        WHERE AssignedEmpID = @empId
          AND BookingDate = @bDate
          AND Status IN ('confirmed', 'arrived', 'queued', 'in_service')
          AND (@sTime < EndTime AND @eTime > StartTime)
      `);

    // Same predicate on date A (would string-compare wrap end incorrectly)
    const planStyleSameDay = await pool
      .request()
      .input('empId', sql.Int, fx.empId)
      .input('bDate', sql.Date, dateA)
      .input('sTime', sql.VarChar, '00:00:00')
      .input('eTime', sql.VarChar, '00:30:00').query(`
        SELECT BookingID FROM dbo.Bookings
        WHERE AssignedEmpID = @empId
          AND BookingDate = @bDate
          AND Status IN ('confirmed', 'arrived', 'queued', 'in_service')
          AND (@sTime < EndTime AND @eTime > StartTime)
      `);

    prev.planWriteGuardCrossMidnightProof = {
      seedBookingId: idA,
      seed: { date: dateA, start: '23:30:00', end: '00:20:00' },
      candidate: { date: dateB, start: '00:00:00', end: '00:30:00' },
      planStyleConflictOnNextDate: planStyle.recordset.length,
      planStyleConflictOnSameDateStringCompare: planStyleSameDay.recordset.length,
      note:
        'plan write guard filters BookingDate equality and compares TIME strings; neither query detects wall-clock overlap with wrap-around EndTime',
    };
    console.log(
      'planWriteGuardProof:',
      JSON.stringify(prev.planWriteGuardCrossMidnightProof, null, 2),
    );
    await cleanup(`${MARKER}:Fsql%`);
  }

  fs.writeFileSync(resultsPath, JSON.stringify(prev, null, 2));
  console.log('Updated', resultsPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
