/**
 * Booking Phase 6B — production-like concurrency verifier.
 * Fails if requests die only at pool acquisition, or if double-book occurs.
 */
import path from 'path';
import fs from 'fs';
import Module from 'module';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), override: true });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = Module as any;
const o = m._load;
m._load = function (r: string, ...rest: unknown[]) {
  if (r === 'server-only') return {};
  return o.call(this, r, ...rest);
};

const MARKER = 'P6B';
type Outcome =
  | { ok: true; code: string; empId: number; ms: number }
  | { ok: false; code: string; ms: number; poolError?: boolean };

function isPoolAcquisitionFailure(code: string): boolean {
  const s = code.toLowerCase();
  return (
    s.includes("can't acquire connection") ||
    s.includes('cannot acquire connection') ||
    s.includes('another request in progress') ||
    s.includes('timeout acquiring a connection')
  );
}

function makeBarrier(n: number) {
  let count = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return {
    wait: async () => {
      count += 1;
      if (count >= n) release();
      await gate;
    },
  };
}

async function main() {
  const { setDbTarget, getPool, sql } = await import('../src/lib/db');
  await setDbTarget('cloud');
  const db = await getPool();

  const { createPublicBooking, PublicBookingCreateError } = await import(
    '../src/lib/booking/publicBookingCreate'
  );
  const { ensureBookingPublicWorkDateColumns } = await import(
    '../src/lib/booking/ensureBookingPublicWorkDateColumns'
  );
  const { ensurePublicBookingCreateIdempotencyTable } = await import(
    '../src/lib/booking/publicBookingCreateIdempotency'
  );
  const { getPublicAvailableSlots, invalidatePublicBookingAvailabilityCache } = await import(
    '../src/lib/booking/publicBookingAvailability'
  );

  await ensurePublicBookingCreateIdempotencyTable();
  await ensureBookingPublicWorkDateColumns();
  invalidatePublicBookingAvailabilityCache();

  const workDate = '2026-08-05';
  const empId = 12;
  const serviceIds = [9];
  const slots = await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: workDate,
    serviceIds,
    empId,
  });
  const slot = slots.slots.find((s) => s.dayOffset === 0) ?? slots.slots[0];
  if (!slot) throw new Error('No free slot for concurrency proof');

  const overnight = slots.slots.find((s) => s.dayOffset === 1);
  const createdCodes: string[] = [];
  const results: Record<string, unknown> = {
    ts: new Date().toISOString(),
    marker: MARKER,
    workDate: slots.date,
    slot,
  };

  async function runCreate(label: string, args: Record<string, unknown>): Promise<Outcome> {
    const t0 = Date.now();
    try {
      const r = await createPublicBooking({
        branchCode: 'GLEEM',
        date: slots.date,
        time: slot!.time,
        dayOffset: slot!.dayOffset,
        serviceIds,
        empId,
        mode: 'specific_barber',
        customer: { name: `${MARKER} ${label}`, phone: '01000000000' },
        suppressNotification: true,
        ...args,
      } as never);
      const code = String(r.body.booking.code);
      createdCodes.push(code);
      return {
        ok: true,
        code,
        empId: (r.body.booking.barber as { empId: number }).empId,
        ms: Date.now() - t0,
      };
    } catch (e) {
      const msg =
        e instanceof PublicBookingCreateError
          ? e.code
          : e instanceof Error
            ? e.message
            : String(e);
      return {
        ok: false,
        code: msg,
        ms: Date.now() - t0,
        poolError: isPoolAcquisitionFailure(msg),
      };
    }
  }

  // ── A. Specific same-slot, different keys, barrier ───────────────────────
  const barrier = makeBarrier(2);
  const keyA = `${MARKER}-A-${crypto.randomUUID()}`;
  const keyB = `${MARKER}-B-${crypto.randomUUID()}`;
  const [a, b] = await Promise.all([
    (async () => {
      await barrier.wait();
      return runCreate('concA', { clientRequestId: keyA });
    })(),
    (async () => {
      await barrier.wait();
      return runCreate('concB', { clientRequestId: keyB });
    })(),
  ]);
  results.specific_same_slot = { a, b };

  if (a.poolError || b.poolError) {
    throw new Error(`POOL_ACQUISITION_FAILURE specific_same_slot: ${JSON.stringify({ a, b })}`);
  }
  const successCount = [a, b].filter((x) => x.ok).length;
  if (successCount !== 1) {
    throw new Error(`Expected exactly 1 success for same-slot, got ${successCount}`);
  }
  const fail = [a, b].find((x) => !x.ok)!;
  if (!['SLOT_UNAVAILABLE', 'BOOKING_LOCK_TIMEOUT'].includes(fail.code)) {
    throw new Error(`Expected SLOT_UNAVAILABLE|BOOKING_LOCK_TIMEOUT, got ${fail.code}`);
  }

  // DB assert: one booking for that absolute interval / emp
  const winner = [a, b].find((x) => x.ok)! as Extract<Outcome, { ok: true }>;
  const overlap = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('code', sql.NVarChar, winner.code)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.Bookings
      WHERE AssignedEmpID=@empId
        AND BookingCode=@code
        AND Status=N'confirmed'
    `);
  if (Number(overlap.recordset[0].cnt) !== 1) {
    throw new Error('Winner booking missing in DB');
  }

  // Persistence columns
  const persist = await db
    .request()
    .input('code', sql.NVarChar, winner.code)
    .query(`
      SELECT PublicWorkDate, PublicDayOffset, AbsoluteStartUtc, AbsoluteEndUtc,
             PlanFingerprint, IdempotencyRequestID, BookingDate
      FROM dbo.Bookings WHERE BookingCode=@code
    `);
  const prow = persist.recordset[0];
  results.persistence = {
    hasWorkDate: prow?.PublicWorkDate != null,
    dayOffset: prow?.PublicDayOffset,
    hasAbsStart: prow?.AbsoluteStartUtc != null,
    hasAbsEnd: prow?.AbsoluteEndUtc != null,
    hasIdempotencyRequestID: prow?.IdempotencyRequestID != null,
  };
  if (!prow?.PublicWorkDate || prow.PublicDayOffset == null || !prow.AbsoluteStartUtc) {
    throw new Error('Canonical WorkDate/dayOffset/absolute columns missing on insert');
  }

  // ── B. Same idempotency key concurrent ───────────────────────────────────
  invalidatePublicBookingAvailabilityCache();
  const slots2 = await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: workDate,
    serviceIds,
    empId,
  });
  const slot2 = slots2.slots.find(
    (s) => !(s.time === slot.time && s.dayOffset === slot.dayOffset) && s.dayOffset === 0,
  );
  if (!slot2) throw new Error('Need second free slot for idempotency concurrency');

  const sameKey = `${MARKER}-SAME-${crypto.randomUUID()}`;
  const barrier2 = makeBarrier(2);
  const [s1, s2] = await Promise.all([
    (async () => {
      await barrier2.wait();
      return runCreate('sameKey1', {
        clientRequestId: sameKey,
        time: slot2.time,
        dayOffset: slot2.dayOffset,
      });
    })(),
    (async () => {
      await barrier2.wait();
      return runCreate('sameKey2', {
        clientRequestId: sameKey,
        time: slot2.time,
        dayOffset: slot2.dayOffset,
      });
    })(),
  ]);
  results.same_idempotency_key = { s1, s2 };
  if (s1.poolError || s2.poolError) {
    throw new Error(`POOL_ACQUISITION_FAILURE same_key: ${JSON.stringify({ s1, s2 })}`);
  }
  // One success; other may be IN_PROGRESS then we replay, or also success with same code
  const sameCodes = [s1, s2].filter((x) => x.ok).map((x) => (x as { code: string }).code);
  if (sameCodes.length === 0) {
    // one may be IN_PROGRESS — finish with sequential replay
    const replay = await runCreate('sameKeyReplay', {
      clientRequestId: sameKey,
      time: slot2.time,
      dayOffset: slot2.dayOffset,
    });
    results.same_idempotency_key_replay = replay;
    if (!replay.ok) throw new Error(`Same-key replay failed: ${replay.code}`);
  } else {
    const unique = new Set(sameCodes);
    if (unique.size !== 1) throw new Error(`Same key produced multiple codes: ${sameCodes.join(',')}`);
  }
  const idemRows = await db
    .request()
    .input('key', sql.NVarChar, sameKey)
    .query(`SELECT COUNT(*) AS cnt FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey=@key`);
  if (Number(idemRows.recordset[0].cnt) !== 1) {
    throw new Error('Expected exactly one idempotency row for same key');
  }

  // ── C. Reused key different payload ──────────────────────────────────────
  let mismatch = '';
  try {
    await createPublicBooking({
      branchCode: 'GLEEM',
      date: slots.date,
      time: '10:00',
      dayOffset: 0,
      serviceIds,
      empId,
      mode: 'specific_barber',
      clientRequestId: sameKey,
      customer: { name: `${MARKER} mismatch`, phone: '01000000000' },
      suppressNotification: true,
    });
  } catch (e) {
    mismatch = e instanceof PublicBookingCreateError ? e.code : String(e);
  }
  results.reused_key_mismatch = mismatch;
  if (mismatch !== 'IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST') {
    throw new Error(`Expected IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST, got ${mismatch}`);
  }

  // ── D. Any-barber capacity (N candidates → N+1 requests) ─────────────────
  invalidatePublicBookingAvailabilityCache();
  const { evaluatePublicBookingSelection } = await import(
    '../src/lib/booking/publicBookingSelectionEvaluator'
  );
  const anySlots = await getPublicAvailableSlots({
    branchCode: 'GLEEM',
    date: workDate,
    serviceIds,
  });
  const anySlot = anySlots.slots.find(
    (s) =>
      (s.barbers?.length ?? 0) >= 2 &&
      !(s.time === slot.time && s.dayOffset === slot.dayOffset) &&
      !(s.time === slot2.time && s.dayOffset === slot2.dayOffset),
  );
  if (anySlot) {
    const pre = await evaluatePublicBookingSelection({
      branchCode: 'GLEEM',
      date: slots.date,
      time: anySlot.time,
      dayOffset: anySlot.dayOffset,
      serviceIds,
      purpose: 'create_precheck',
    });
    const n = pre.candidateBarbers.length;
    results.any_barber_precheck_candidates = n;
    if (n >= 2) {
      const reqCount = n + 1;
      const barrier3 = makeBarrier(reqCount);
      const keys = Array.from({ length: reqCount }, () => `${MARKER}-ANY-${crypto.randomUUID()}`);
      const anyOutcomes = await Promise.all(
        keys.map((k, i) =>
          (async () => {
            await barrier3.wait();
            return runCreate(`any${i}`, {
              mode: 'any_barber',
              empId: undefined,
              clientRequestId: k,
              time: anySlot.time,
              dayOffset: anySlot.dayOffset,
            });
          })(),
        ),
      );
      results.any_barber_capacity = anyOutcomes;
      if (anyOutcomes.some((x) => x.poolError)) {
        throw new Error('POOL_ACQUISITION_FAILURE any_barber_capacity');
      }
      const anyOk = anyOutcomes.filter((x) => x.ok) as Array<Extract<Outcome, { ok: true }>>;
      if (anyOk.length > n) {
        throw new Error(`Any-barber over-capacity: ${anyOk.length} > ${n}`);
      }
      if (anyOk.length < 1) {
        throw new Error('Any-barber capacity: expected at least one success');
      }
      const empSet = new Set(anyOk.map((x) => x.empId));
      if (empSet.size !== anyOk.length) {
        throw new Error('Any-barber assigned overlapping EmpIDs');
      }
      const fails = anyOutcomes.filter((x) => !x.ok);
      if (fails.length < 1) {
        throw new Error('Any-barber capacity: expected at least one failure for N+1 requests');
      }
    } else {
      results.any_barber_capacity = { skipped: true, reason: 'precheck_candidates_lt_2' };
    }
  } else {
    results.any_barber_capacity = { skipped: true, reason: 'no_slot_with_2_barbers' };
  }

  // ── E. Overnight persistence ─────────────────────────────────────────────
  if (overnight) {
    const ov = await runCreate('overnight', {
      clientRequestId: `${MARKER}-OV-${crypto.randomUUID()}`,
      time: overnight.time,
      dayOffset: 1,
    });
    results.overnight = ov;
    if (ov.ok) {
      const row = await db
        .request()
        .input('code', sql.NVarChar, ov.code)
        .query(`SELECT PublicDayOffset, PublicWorkDate FROM dbo.Bookings WHERE BookingCode=@code`);
      if (Number(row.recordset[0]?.PublicDayOffset) !== 1) {
        throw new Error('Overnight PublicDayOffset not persisted as 1');
      }
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  const codes = [...new Set(createdCodes)];
  let cleaned = 0;
  for (const code of codes) {
    const r = await db.request().input('code', sql.NVarChar, code).query(`
      DECLARE @id INT = (SELECT BookingID FROM dbo.Bookings WHERE BookingCode=@code);
      IF @id IS NOT NULL BEGIN
        DELETE FROM dbo.BookingServices WHERE BookingID=@id;
        DELETE FROM dbo.Bookings WHERE BookingID=@id;
      END
      SELECT @id AS id
    `);
    if (r.recordset[0]?.id) cleaned += 1;
  }
  await db.request().query(`
    DELETE FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey LIKE N'${MARKER}-%'
  `);
  // Sweep any marker leftovers (including failed mid-run)
  await db.request().query(`
    DECLARE @ids TABLE (id INT);
    INSERT INTO @ids SELECT BookingID FROM dbo.Bookings WHERE Notes LIKE N'%${MARKER}%';
    DELETE bs FROM dbo.BookingServices bs INNER JOIN @ids i ON i.id = bs.BookingID;
    DELETE b FROM dbo.Bookings b INNER JOIN @ids i ON i.id = b.BookingID;
  `);
  const leftover = await db.request().query(`
    SELECT COUNT(*) AS cnt FROM dbo.Bookings
    WHERE Notes LIKE N'%${MARKER}%' AND Status=N'confirmed'
  `);
  results.cleanup = {
    cleaned,
    leftover: Number(leftover.recordset[0].cnt),
  };
  if (Number(leftover.recordset[0].cnt) !== 0) {
    throw new Error('Cleanup incomplete — leftover smoke bookings');
  }

  results.verdict = {
    specific_same_slot: 'PASS',
    same_idempotency_key: 'PASS',
    reused_key: 'PASS',
    persistence: 'PASS',
    pool_safe: 'PASS',
  };

  const dest = path.join(__dirname, 'branch-smoke', '_booking-phase6b-concurrency.json');
  fs.writeFileSync(dest, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log('PASS wrote', dest);
}

main().catch(async (e) => {
  console.error('FAIL', e);
  try {
    const { setDbTarget, getPool } = await import('../src/lib/db');
    await setDbTarget('cloud');
    const db = await getPool();
    await db.request().query(`
      DECLARE @ids TABLE (id INT);
      INSERT INTO @ids SELECT BookingID FROM dbo.Bookings WHERE Notes LIKE N'%P6B%';
      DELETE bs FROM dbo.BookingServices bs INNER JOIN @ids i ON i.id = bs.BookingID;
      DELETE b FROM dbo.Bookings b INNER JOIN @ids i ON i.id = b.BookingID;
      DELETE FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey LIKE N'P6B-%';
    `);
    console.error('emergency cleanup done');
  } catch (cleanupErr) {
    console.error('emergency cleanup failed', cleanupErr);
  }
  process.exit(1);
});
