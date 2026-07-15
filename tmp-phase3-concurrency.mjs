/**
 * Phase 3 concurrency verification harness (temporary).
 * Calls live HTTP APIs + direct DB cleanup with PHASE3AUDIT marker.
 * Does not patch production routes.
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

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

function nextDateStr(dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function addDaysCairo(days) {
  const now = new Date();
  const cairo = new Date(
    now.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }),
  );
  cairo.setDate(cairo.getDate() + days);
  const y = cairo.getFullYear();
  const m = String(cairo.getMonth() + 1).padStart(2, '0');
  const d = String(cairo.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function getDb() {
  const sql = (await import('mssql')).default;
  const pool = await sql.connect({
    server: process.env.LOCAL_DB_SERVER || process.env.DB_SERVER,
    database:
      process.env.LOCAL_DB_NAME ||
      process.env.DB_DATABASE ||
      process.env.DB_NAME,
    user: process.env.LOCAL_DB_USER || process.env.DB_USER,
    password: process.env.LOCAL_DB_PASSWORD || process.env.DB_PASSWORD,
    options: { encrypt: true, trustServerCertificate: true },
    connectionTimeout: 15000,
    requestTimeout: 30000,
  });
  return { sql, pool };
}

async function sqlCancel(pool, bookingId) {
  await pool.request().input('id', bookingId).query(`
    UPDATE dbo.Bookings
    SET Status='cancelled', CancelReason='phase3', CancelledAt=GETDATE(), UpdatedAt=GETDATE()
    WHERE BookingID=@id
  `);
}

async function cleanupFixtures(pool) {
  await pool.request().query(`
    DECLARE @ids TABLE (BookingID INT);
    INSERT INTO @ids
    SELECT BookingID FROM dbo.Bookings
    WHERE Notes LIKE N'${MARKER}%' OR BookingCode LIKE N'P3%';

    DELETE FROM dbo.BookingServices WHERE BookingID IN (SELECT BookingID FROM @ids);
    DELETE FROM dbo.Bookings WHERE BookingID IN (SELECT BookingID FROM @ids);
  `);
}


async function countActiveOverlaps(pool, empId, date, startTime, endTime) {
  const r = await pool
    .request()
    .input('empId', empId)
    .input('bDate', date)
    .input('sTime', startTime)
    .input('eTime', endTime).query(`
      SELECT BookingID, StartTime, EndTime, Status, Notes, BookingCode
      FROM dbo.Bookings
      WHERE AssignedEmpID = @empId
        AND BookingDate = @bDate
        AND LOWER(Status) IN ('confirmed','arrived','queued','in_service','in_progress')
        AND (@sTime < EndTime AND @eTime > StartTime)
      ORDER BY BookingID
    `);
  return r.recordset;
}

async function countByNotes(pool, notePrefix) {
  const r = await pool.request().query(`
    SELECT BookingID, Status, BookingDate,
           CONVERT(varchar(8), StartTime, 108) AS StartTime,
           CONVERT(varchar(8), EndTime, 108) AS EndTime,
           Notes, BookingCode
    FROM dbo.Bookings
    WHERE Notes LIKE N'${notePrefix}%'
    ORDER BY BookingID
  `);
  return r.recordset;
}

function phoneFor(i) {
  // Valid Egyptian-style mobile for isValidPhone
  return `0109${String(1000000 + (i % 8000000)).padStart(7, '0')}`;
}

async function postJson(url, body, headers = {}) {
  const t0 = Date.now();
  const ip =
    headers['x-forwarded-for'] ||
    `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return {
    status: res.status,
    json,
    ms: Date.now() - t0,
    ip,
  };
}

async function patchJson(url, body, headers = {}) {
  const t0 = Date.now();
  const ip =
    headers['x-forwarded-for'] ||
    `198.51.100.${Math.floor(Math.random() * 200) + 1}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'x-forwarded-for': ip,
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json, ms: Date.now() - t0, ip };
}

function barrierPair() {
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  return {
    wait: () => gate,
    release: () => release(),
  };
}

async function discoverFixtures() {
  const cfg = await (await fetch(`${BASE}/api/public/booking/config`)).json();
  const maxAhead = cfg?.settings?.maxBookingDaysAhead ?? 14;

  // Prefer a weekday ~5-7 days ahead for availability
  let date = null;
  let slot = null;
  let empId = null;
  let serviceId = null;
  let duration = 30;
  let serviceId2 = null;

  const svcRes = await (
    await fetch(`${BASE}/api/public/booking/services`)
  ).json();
  const services = svcRes.services || [];
  const usable = services.filter(
    (s) => (s.durationMinutes || 30) >= 20 && (s.durationMinutes || 30) <= 60,
  );
  if (usable.length < 1) throw new Error('No usable services');
  serviceId = usable.find((s) => s.id === 9)?.id || usable[0].id;
  duration =
    usable.find((s) => s.id === serviceId)?.durationMinutes ||
    usable[0].durationMinutes ||
    30;
  serviceId2 =
    usable.find((s) => s.id !== serviceId)?.id ?? serviceId;

  const barbers = await (
    await fetch(`${BASE}/api/public/booking/barbers`)
  ).json();
  const list = barbers.barbers || barbers || [];
  const empIds = (Array.isArray(list) ? list : [])
    .map((b) => b.empId || b.EmpID || b.id)
    .filter(Boolean);

  for (let d = 3; d <= Math.min(maxAhead - 1, 12); d++) {
    const tryDate = addDaysCairo(d);
    for (const mode of ['nearest', 'specific']) {
      const candidates =
        mode === 'nearest' ? [null] : empIds.slice(0, 8);
      for (const e of candidates) {
        const qs = new URLSearchParams({
          date: tryDate,
          serviceIds: String(serviceId),
          mode: mode === 'nearest' ? 'nearest' : 'specific',
          source: 'operations',
        });
        if (e) qs.set('empId', String(e));
        const res = await fetch(
          `${BASE}/api/public/booking/available-slots?${qs}`,
        );
        const data = await res.json();
        const slots = (data.slots || data.availableSlots || []).filter(
          (s) => s.available !== false && (s.dayOffset ?? 0) === 0,
        );
        // Prefer afternoon slots for overlap tests
        const preferred = slots.filter((s) => {
          const [hh] = s.time.split(':').map(Number);
          return hh >= 15 && hh <= 19;
        });
        const pick = preferred[0] || slots[2] || slots[0];
        if (pick?.empId && pick?.time) {
          date = tryDate;
          slot = pick;
          empId = pick.empId;
          break;
        }
      }
      if (date) break;
    }
    if (date) break;
  }

  if (!date || !slot || !empId) {
    throw new Error('Could not find available slot for fixtures');
  }

  const endMinutes =
    Number(slot.time.split(':')[0]) * 60 +
    Number(slot.time.split(':')[1]) +
    duration;
  const endH = String(Math.floor(endMinutes / 60) % 24).padStart(2, '0');
  const endM = String(endMinutes % 60).padStart(2, '0');

  return {
    date,
    time: slot.time,
    endTime: `${endH}:${endM}`,
    empId,
    serviceId,
    serviceId2,
    duration,
    nextDate: nextDateStr(date),
    maxAhead,
  };
}

function addMinutes(hhmm, mins) {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function createPayload(fx, note, overrides = {}) {
  return {
    customer: {
      name: 'Phase3 Audit',
      phone: overrides.phone || phoneFor(Math.floor(Math.random() * 1e6)),
    },
    serviceIds: overrides.serviceIds || [fx.serviceId],
    date: overrides.date || fx.date,
    time: overrides.time || fx.time,
    dayOffset: overrides.dayOffset ?? 0,
    mode: 'specific',
    empId: overrides.empId || fx.empId,
    notes: `${MARKER}:${note}`,
    source: 'operations',
  };
}

function planPayload(fx, note, overrides = {}) {
  const p = createPayload(fx, note, overrides);
  delete p.source;
  return p;
}

async function raceTwo(label, fnA, fnB) {
  const gate = barrierPair();
  const a = (async () => {
    await gate.wait();
    return fnA();
  })();
  const b = (async () => {
    await gate.wait();
    return fnB();
  })();
  // stagger microtask then release together
  await Promise.resolve();
  gate.release();
  const [ra, rb] = await Promise.all([a, b]);
  return { label, ra, rb };
}

function classifyPair(ra, rb) {
  const statuses = [ra.status, rb.status].sort((x, y) => x - y);
  const successes = [ra, rb].filter((r) => r.status === 201 || r.status === 200);
  const conflicts = [ra, rb].filter((r) => r.status === 409);
  const errors = [ra, rb].filter(
    (r) => r.status !== 201 && r.status !== 200 && r.status !== 409,
  );
  return {
    statuses,
    successCount: successes.length,
    conflictCount: conflicts.length,
    unexpectedCount: errors.length,
    bothSucceeded: successes.length >= 2,
    oneRejected: successes.length === 1 && conflicts.length === 1,
    bookingIds: successes
      .map((s) => s.json?.booking?.id || s.json?.plan?.[0]?.bookingId)
      .filter(Boolean),
  };
}

async function main() {
  const results = [];
  const evidence = [];
  const { pool } = await getDb();

  console.log('Discovering fixtures...');
  await cleanupFixtures(pool);
  const fx = await discoverFixtures();
  console.log('Fixtures:', JSON.stringify(fx));

  // ── Test A: create vs create ──────────────────────────────────────────
  {
    let both = 0;
    let one = 0;
    let unexpected = 0;
    for (let i = 0; i < ATTEMPTS; i++) {
      await cleanupFixtures(pool);
      const noteA = `A:${i}:a`;
      const noteB = `A:${i}:b`;
      const { ra, rb } = await raceTwo(
        `A-${i}`,
        () =>
          postJson(`${BASE}/api/public/booking/create`, createPayload(fx, noteA, { phone: phoneFor(1000 + i) })),
        () =>
          postJson(`${BASE}/api/public/booking/create`, createPayload(fx, noteB, { phone: phoneFor(2000 + i) })),
      );
      const c = classifyPair(ra, rb);
      const overlaps = await countActiveOverlaps(
        pool,
        fx.empId,
        fx.date,
        `${fx.time}:00`,
        `${fx.endTime}:00`,
      );
      evidence.push({
        test: 'A_create_vs_create',
        attempt: i,
        ra: { status: ra.status, id: ra.json?.booking?.id, ms: ra.ms },
        rb: { status: rb.status, id: rb.json?.booking?.id, ms: rb.ms },
        activeOverlaps: overlaps.length,
        overlapIds: overlaps.map((o) => o.BookingID),
      });
      if (c.bothSucceeded || overlaps.length > 1) both++;
      else if (c.oneRejected && overlaps.length === 1) one++;
      else unexpected++;
    }
    results.push({
      test: 'A_create_vs_create',
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
    });
  }

  // ── Test B: plan vs plan ──────────────────────────────────────────────
  {
    let both = 0;
    let one = 0;
    let unexpected = 0;
    for (let i = 0; i < ATTEMPTS; i++) {
      await cleanupFixtures(pool);
      const { ra, rb } = await raceTwo(
        `B-${i}`,
        () =>
          postJson(
            `${BASE}/api/public/booking/plan`,
            planPayload(fx, `B:${i}:a`, { phone: phoneFor(3000 + i) }),
          ),
        () =>
          postJson(
            `${BASE}/api/public/booking/plan`,
            planPayload(fx, `B:${i}:b`, { phone: phoneFor(4000 + i) }),
          ),
      );
      const c = classifyPair(ra, rb);
      const overlaps = await countActiveOverlaps(
        pool,
        fx.empId,
        fx.date,
        `${fx.time}:00`,
        `${fx.endTime}:00`,
      );
      evidence.push({
        test: 'B_plan_vs_plan',
        attempt: i,
        ra: { status: ra.status, id: ra.json?.plan?.[0]?.bookingId, ms: ra.ms, err: ra.json?.reason || ra.json?.error },
        rb: { status: rb.status, id: rb.json?.plan?.[0]?.bookingId, ms: rb.ms, err: rb.json?.reason || rb.json?.error },
        activeOverlaps: overlaps.length,
        overlapIds: overlaps.map((o) => o.BookingID),
      });
      if (c.bothSucceeded || overlaps.length > 1) both++;
      else if (c.oneRejected && overlaps.length === 1) one++;
      else unexpected++;
    }
    results.push({
      test: 'B_plan_vs_plan',
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
    });
  }

  // ── Test C: create vs plan ────────────────────────────────────────────
  {
    let both = 0;
    let one = 0;
    let unexpected = 0;
    for (let i = 0; i < ATTEMPTS; i++) {
      await cleanupFixtures(pool);
      const { ra, rb } = await raceTwo(
        `C-${i}`,
        () =>
          postJson(
            `${BASE}/api/public/booking/create`,
            createPayload(fx, `C:${i}:create`, { phone: phoneFor(5000 + i) }),
          ),
        () =>
          postJson(
            `${BASE}/api/public/booking/plan`,
            planPayload(fx, `C:${i}:plan`, { phone: phoneFor(6000 + i) }),
          ),
      );
      const overlaps = await countActiveOverlaps(
        pool,
        fx.empId,
        fx.date,
        `${fx.time}:00`,
        `${fx.endTime}:00`,
      );
      evidence.push({
        test: 'C_create_vs_plan',
        attempt: i,
        ra: { status: ra.status, id: ra.json?.booking?.id, ms: ra.ms },
        rb: { status: rb.status, id: rb.json?.plan?.[0]?.bookingId, ms: rb.ms },
        activeOverlaps: overlaps.length,
        overlapIds: overlaps.map((o) => o.BookingID),
      });
      const successes = [ra, rb].filter((r) => r.status === 201).length;
      const conflicts = [ra, rb].filter((r) => r.status === 409).length;
      if (successes >= 2 || overlaps.length > 1) both++;
      else if (successes === 1 && conflicts === 1 && overlaps.length === 1) one++;
      else unexpected++;
    }
    results.push({
      test: 'C_create_vs_plan',
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
    });
  }

  // ── Test E: overlapping starts (17:00-end vs mid-overlap) ─────────────
  {
    let both = 0;
    let one = 0;
    let unexpected = 0;
    const mid = addMinutes(fx.time, Math.max(10, Math.floor(fx.duration / 2)));
    for (let i = 0; i < ATTEMPTS; i++) {
      await cleanupFixtures(pool);
      const { ra, rb } = await raceTwo(
        `E-${i}`,
        () =>
          postJson(
            `${BASE}/api/public/booking/create`,
            createPayload(fx, `E:${i}:full`, {
              phone: phoneFor(7000 + i),
              time: fx.time,
            }),
          ),
        () =>
          postJson(
            `${BASE}/api/public/booking/create`,
            createPayload(fx, `E:${i}:mid`, {
              phone: phoneFor(8000 + i),
              time: mid,
            }),
          ),
      );
      const overlaps = await countActiveOverlaps(
        pool,
        fx.empId,
        fx.date,
        `${fx.time}:00`,
        `${addMinutes(mid, fx.duration)}:00`,
      );
      evidence.push({
        test: 'E_partial_overlap',
        attempt: i,
        mid,
        ra: { status: ra.status, id: ra.json?.booking?.id },
        rb: { status: rb.status, id: rb.json?.booking?.id },
        activeInUnion: overlaps.length,
      });
      const successes = [ra, rb].filter((r) => r.status === 201).length;
      if (successes >= 2 || overlaps.length > 1) both++;
      else if (successes === 1 && overlaps.length === 1) one++;
      else unexpected++;
    }
    results.push({
      test: 'E_partial_overlap_starts',
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
    });
  }

  // ── Test F: cross-midnight via plan same-day SQL vs create busy intervals ─
  // Pre-create A near end of day; race B on next calendar morning if slots allow.
  {
    let both = 0;
    let one = 0;
    let unexpected = 0;
    let skipped = 0;
    // Discover late slot dayOffset 0 or overnight dayOffset 1
    let late = null;
    let earlyNext = null;
    for (let d = 3; d <= 10; d++) {
      const tryDate = addDaysCairo(d);
      const qs = new URLSearchParams({
        date: tryDate,
        serviceIds: String(fx.serviceId),
        mode: 'specific',
        empId: String(fx.empId),
        source: 'operations',
      });
      const data = await (
        await fetch(`${BASE}/api/public/booking/available-slots?${qs}`)
      ).json();
      const slots = data.slots || data.availableSlots || [];
      const lateCand = slots.find((s) => s.time === '23:30' || s.time === '23:15');
      // Prefer dayOffset=1 early slot on same board date (overnight)
      const earlyCand = slots.find(
        (s) =>
          s.dayOffset === 1 &&
          (s.time === '00:00' || s.time === '00:15' || s.time === '00:30'),
      );
      if (lateCand && earlyCand) {
        late = { date: tryDate, ...lateCand };
        earlyNext = {
          date: earlyCand.dayOffset === 1 ? nextDateStr(tryDate) : tryDate,
          time: earlyCand.time,
          dayOffset: 0, // send calendar date already for create
          boardDate: tryDate,
          boardDayOffset: earlyCand.dayOffset ?? 0,
        };
        break;
      }
    }

    if (!late || !earlyNext) {
      results.push({
        test: 'F_cross_midnight',
        attempts: 0,
        bothSucceeded: 0,
        oneRejected: 0,
        unexpected: 0,
        skipped: true,
        verdict: 'SKIPPED_NO_SLOTS',
        note: 'No late+early overnight slots for chosen barber',
      });
    } else {
      for (let i = 0; i < Math.min(ATTEMPTS, 10); i++) {
        await cleanupFixtures(pool);
        // Seed late booking first via create, then race early next-day create+plan
        const seed = await postJson(
          `${BASE}/api/public/booking/create`,
          createPayload(fx, `F:${i}:seed`, {
            phone: phoneFor(9000 + i),
            date: late.date,
            time: late.time,
            dayOffset: late.dayOffset ?? 0,
            empId: fx.empId,
            serviceIds: [fx.serviceId2], // longer cut for midnight span when possible
          }),
        );
        if (seed.status !== 201) {
          skipped++;
          evidence.push({ test: 'F', attempt: i, seedStatus: seed.status, seedErr: seed.json?.error || seed.json?.message });
          continue;
        }
        // Concurrent create on next calendar morning overlapping seed end
        const r1 = postJson(
          `${BASE}/api/public/booking/create`,
          createPayload(fx, `F:${i}:earlyCreate`, {
            phone: phoneFor(9100 + i),
            date: earlyNext.boardDate,
            time: earlyNext.time,
            dayOffset: earlyNext.boardDayOffset,
          }),
        );
        const r2 = postJson(
          `${BASE}/api/public/booking/plan`,
          planPayload(fx, `F:${i}:earlyPlan`, {
            phone: phoneFor(9200 + i),
            date: earlyNext.boardDate,
            time: earlyNext.time,
            dayOffset: earlyNext.boardDayOffset,
          }),
        );
        const [ra, rb] = await Promise.all([r1, r2]);
        // Count active bookings that cover early interval on early date AND late on late date
        const earlyRows = await countActiveOverlaps(
          pool,
          fx.empId,
          earlyNext.date,
          `${earlyNext.time}:00`,
          `${addMinutes(earlyNext.time, fx.duration)}:00`,
        );
        const lateRows = await countActiveOverlaps(
          pool,
          fx.empId,
          late.dayOffset === 1 ? nextDateStr(late.date) : late.date,
          `${late.time}:00`,
          `${addMinutes(late.time, fx.duration)}:00`,
        );
        // Prefer wall-clock: if seed spans midnight stored same BookingDate with EndTime < StartTime OR next date
        const allActive = await pool.request().query(`
          SELECT BookingID, BookingDate, CONVERT(varchar(8),StartTime,108) ST,
                 CONVERT(varchar(8),EndTime,108) ET, Status, Notes
          FROM dbo.Bookings
          WHERE AssignedEmpID = ${fx.empId}
            AND Notes LIKE N'${MARKER}:F:${i}:%'
            AND LOWER(Status) IN ('confirmed','arrived','queued','in_service','in_progress')
        `);
        evidence.push({
          test: 'F_cross_midnight',
          attempt: i,
          late,
          earlyNext,
          seedId: seed.json?.booking?.id,
          ra: { status: ra.status, id: ra.json?.booking?.id },
          rb: { status: rb.status, id: rb.json?.plan?.[0]?.bookingId },
          activeFixtureRows: allActive.recordset.length,
          rows: allActive.recordset,
          earlyRows: earlyRows.length,
          lateRows: lateRows.length,
        });
        // Double-book if seed + at least one early success both active (overlapping wall clock)
        const earlyOk = ra.status === 201 || rb.status === 201;
        if (earlyOk && allActive.recordset.length > 1) both++;
        else if (!earlyOk && allActive.recordset.length === 1) one++;
        else unexpected++;
      }
      results.push({
        test: 'F_cross_midnight',
        attempts: Math.min(ATTEMPTS, 10) - skipped,
        bothSucceeded: both,
        oneRejected: one,
        unexpected,
        skipped,
        verdict:
          both > 0
            ? 'FAIL_DOUBLE_BOOK'
            : one > 0 && both === 0
              ? 'PASS'
              : 'MIXED_OR_SKIP',
        late,
        earlyNext,
      });
    }
  }

  // ── Test D: create vs reschedule (direct core via dynamic import / HTTP sessionless may 401) ─
  {
    let both = 0;
    let one = 0;
    let unexpected = 0;
    let authBlocked = 0;
    for (let i = 0; i < ATTEMPTS; i++) {
      await cleanupFixtures(pool);
      // Seed occupant at fx.time and mover at later free slot
      const moverTime = addMinutes(fx.time, fx.duration + 15);
      const seedOcc = await postJson(
        `${BASE}/api/public/booking/create`,
        createPayload(fx, `D:${i}:occ`, { phone: phoneFor(10000 + i) }),
      );
      const seedMover = await postJson(
        `${BASE}/api/public/booking/create`,
        createPayload(fx, `D:${i}:mover`, {
          phone: phoneFor(11000 + i),
          time: moverTime,
        }),
      );
      if (seedOcc.status !== 201 || seedMover.status !== 201) {
        unexpected++;
        evidence.push({
          test: 'D',
          attempt: i,
          seedOcc: seedOcc.status,
          seedMover: seedMover.status,
          occErr: seedOcc.json?.message || seedOcc.json?.error,
          moverErr: seedMover.json?.message || seedMover.json?.error,
        });
        continue;
      }
      const moverId = seedMover.json.booking.id;
      // Free the target by cancelling occupant then recreate race: better — cancel occ then concurrent create+reschedule into slot
      await sqlCancel(pool, seedOcc.json.booking.id);
      // Re-setup: only mover exists; race create into fx.time vs reschedule mover into fx.time
      const createP = postJson(
        `${BASE}/api/public/booking/create`,
        createPayload(fx, `D:${i}:create`, { phone: phoneFor(12000 + i) }),
      );
      const reschedP = patchJson(
        `${BASE}/api/operations/bookings/${moverId}/reschedule`,
        {
          newStartAt: new Date(
            Date.parse(`${fx.date}T${fx.time}:00+03:00`),
          ).toISOString(),
          operationalDate: fx.date,
          source: 'phase3_audit',
        },
      );
      const [rc, rr] = await Promise.all([createP, reschedP]);
      if (rr.status === 401) authBlocked++;
      const overlaps = await countActiveOverlaps(
        pool,
        fx.empId,
        fx.date,
        `${fx.time}:00`,
        `${fx.endTime}:00`,
      );
      evidence.push({
        test: 'D_create_vs_reschedule',
        attempt: i,
        create: { status: rc.status, id: rc.json?.booking?.id },
        reschedule: { status: rr.status, err: rr.json?.error || rr.json?.message },
        overlaps: overlaps.length,
        overlapIds: overlaps.map((o) => o.BookingID),
      });
      const createOk = rc.status === 201;
      const reschedOk = rr.status === 200 || (rr.status === 201) || rr.json?.ok === true;
      if (createOk && reschedOk && overlaps.length > 1) both++;
      else if ((createOk ^ reschedOk) && overlaps.length === 1) one++;
      else if (rr.status === 401 && createOk && overlaps.length === 1) {
        // reschedule blocked by auth — not a concurrency result
        unexpected++;
      } else unexpected++;
    }
    results.push({
      test: 'D_create_vs_reschedule',
      attempts: ATTEMPTS,
      bothSucceeded: both,
      oneRejected: one,
      unexpected,
      authBlocked,
      verdict:
        authBlocked === ATTEMPTS
          ? 'BLOCKED_NO_SESSION'
          : both > 0
            ? 'FAIL_DOUBLE_BOOK'
            : one > 0 && both === 0
              ? 'PASS'
              : 'MIXED',
    });
  }

  // ── Idempotency ───────────────────────────────────────────────────────
  const idempotency = { sequential: null, concurrent: null, hasHeaders: false };
  {
    await cleanupFixtures(pool);
    const payload = createPayload(fx, 'IDEM:seq', { phone: phoneFor(13001) });
    const first = await postJson(`${BASE}/api/public/booking/create`, payload);
    const second = await postJson(`${BASE}/api/public/booking/create`, payload);
    const rows = await countByNotes(pool, `${MARKER}:IDEM:seq`);
    idempotency.sequential = {
      first: first.status,
      second: second.status,
      firstId: first.json?.booking?.id,
      secondId: second.json?.booking?.id,
      activeOrAllRows: rows.length,
      distinctIds: [...new Set(rows.map((r) => r.BookingID))],
    };

    await cleanupFixtures(pool);
    const payload2 = createPayload(fx, 'IDEM:conc', { phone: phoneFor(13002) });
    const { ra, rb } = await raceTwo(
      'idem',
      () => postJson(`${BASE}/api/public/booking/create`, payload2),
      () => postJson(`${BASE}/api/public/booking/create`, payload2),
    );
    const rows2 = await countByNotes(pool, `${MARKER}:IDEM:conc`);
    idempotency.concurrent = {
      ra: ra.status,
      rb: rb.status,
      ids: [ra.json?.booking?.id, rb.json?.booking?.id].filter(Boolean),
      rows: rows2.length,
    };

    // Probe header acceptance (should not create idempotent behavior)
    await cleanupFixtures(pool);
    const payload3 = createPayload(fx, 'IDEM:key', { phone: phoneFor(13003) });
    const withKey1 = await postJson(
      `${BASE}/api/public/booking/create`,
      payload3,
      { 'Idempotency-Key': 'phase3-same-key' },
    );
    const withKey2 = await postJson(
      `${BASE}/api/public/booking/create`,
      payload3,
      { 'Idempotency-Key': 'phase3-same-key' },
    );
    idempotency.hasHeaders = false; // code audit confirmed; runtime:
    idempotency.headerProbe = {
      withKey1: withKey1.status,
      withKey2: withKey2.status,
      id1: withKey1.json?.booking?.id,
      id2: withKey2.json?.booking?.id,
      note: 'Idempotency-Key ignored if second still 201 or 409 without returning same id',
    };
  }

  // ── Multi-service plan atomicity ──────────────────────────────────────
  const multi = {};
  {
    await cleanupFixtures(pool);
    // Successful 2-service plan if second service can append
    const okPlan = await postJson(
      `${BASE}/api/public/booking/plan`,
      planPayload(fx, 'MULTI:ok', {
        phone: phoneFor(14001),
        serviceIds: [fx.serviceId, fx.serviceId2],
      }),
    );
    const okRows = await countByNotes(pool, `${MARKER}:MULTI:ok`);
    const svcCount = await pool.request().query(`
      SELECT COUNT(*) AS c FROM dbo.BookingServices bs
      INNER JOIN dbo.Bookings b ON b.BookingID = bs.BookingID
      WHERE b.Notes LIKE N'${MARKER}:MULTI:ok%'
    `);
    multi.success = {
      status: okPlan.status,
      planLen: okPlan.json?.plan?.length,
      bookingRows: okRows.length,
      bookingStatuses: okRows.map((r) => r.Status),
      serviceRows: svcCount.recordset[0]?.c,
      err: okPlan.json?.error || okPlan.json?.message,
    };

    // Segment2 conflict cleanup: seed conflict at second segment time
    await cleanupFixtures(pool);
    const seg2Time = addMinutes(fx.time, fx.duration);
    const seed = await postJson(
      `${BASE}/api/public/booking/create`,
      createPayload(fx, 'MULTI:seed', {
        phone: phoneFor(14002),
        time: seg2Time,
      }),
    );
    const blocked = await postJson(
      `${BASE}/api/public/booking/plan`,
      planPayload(fx, 'MULTI:partial', {
        phone: phoneFor(14003),
        serviceIds: [fx.serviceId, fx.serviceId2],
      }),
    );
    const partialRows = await countByNotes(pool, `${MARKER}:MULTI:partial`);
    const seedRows = await countByNotes(pool, `${MARKER}:MULTI:seed`);
    multi.segment2PreConflict = {
      seedStatus: seed.status,
      planStatus: blocked.status,
      planReason: blocked.json?.reason || blocked.json?.error,
      partialRows: partialRows.map((r) => ({
        id: r.BookingID,
        status: r.Status,
      })),
      seedActive: seedRows.filter((r) =>
        ['confirmed', 'arrived', 'queued'].includes(String(r.Status).toLowerCase()),
      ).length,
    };

    // Concurrent create into seg2 while multi-service plan runs (inter-segment race)
    let interBoth = 0;
    let interPartialCancel = 0;
    let interOther = 0;
    for (let i = 0; i < ATTEMPTS; i++) {
      await cleanupFixtures(pool);
      const planP = postJson(
        `${BASE}/api/public/booking/plan`,
        planPayload(fx, `MULTI:race:${i}`, {
          phone: phoneFor(15000 + i),
          serviceIds: [fx.serviceId, fx.serviceId2],
        }),
      );
      // Slight delay so plan may commit segment1 first
      await new Promise((r) => setTimeout(r, 5 + (i % 20)));
      const createP = postJson(
        `${BASE}/api/public/booking/create`,
        createPayload(fx, `MULTI:raceCreate:${i}`, {
          phone: phoneFor(16000 + i),
          time: seg2Time,
        }),
      );
      const [rp, rc] = await Promise.all([planP, createP]);
      const planRows = await countByNotes(pool, `${MARKER}:MULTI:race:${i}`);
      const createRows = await countByNotes(
        pool,
        `${MARKER}:MULTI:raceCreate:${i}`,
      );
      const planConfirmed = planRows.filter(
        (r) => String(r.Status).toLowerCase() === 'confirmed',
      );
      const planCancelled = planRows.filter(
        (r) => String(r.Status).toLowerCase() === 'cancelled',
      );
      evidence.push({
        test: 'MULTI_inter_segment_race',
        attempt: i,
        planStatus: rp.status,
        createStatus: rc.status,
        planConfirmed: planConfirmed.length,
        planCancelled: planCancelled.length,
        createConfirmed: createRows.filter(
          (r) => String(r.Status).toLowerCase() === 'confirmed',
        ).length,
      });
      if (planConfirmed.length >= 2 && createRows.some((r) => String(r.Status).toLowerCase() === 'confirmed')) {
        // create in middle of plan occupancy — overlap if create lands on seg2
        interBoth++;
      } else if (planCancelled.length > 0 && createRows.length > 0) {
        interPartialCancel++;
      } else interOther++;
    }
    multi.interSegmentRace = {
      attempts: ATTEMPTS,
      planAndCreateBothOwnSeg2: interBoth,
      observedPartialCancel: interPartialCancel,
      other: interOther,
    };
  }

  await cleanupFixtures(pool);
  await pool.close();

  const out = { fx, results, idempotency, multi, evidence };
  const outPath = path.resolve('tmp-phase3-concurrency-results.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ results, idempotency, multi }, null, 2));
  console.log('Wrote', outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
