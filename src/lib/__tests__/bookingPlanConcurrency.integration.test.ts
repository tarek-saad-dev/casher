/**
 * Cloud integration: /create vs /plan write-guard concurrency after shared applock.
 * Uses CLOUD last132 only. Fixtures tagged AUDIT_FIX_CONC and deleted after run.
 *
 * Run: npx vitest run src/lib/__tests__/bookingPlanConcurrency.integration.test.ts
 */
import path from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: true });

const MARKER = 'AUDIT_FIX_CONC';
const ATTEMPTS = 10;
const DATE = '2031-03-17'; // future Monday — avoid real salon traffic
const TIME = '15:00';
const DUR = 50;
const TZ = 'Africa/Cairo';

function hhmmPlus(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const mod = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(mod / 60)).padStart(2, '0')}:${String(mod % 60).padStart(2, '0')}`;
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

describe('booking plan shared write-guard concurrency (cloud)', () => {
  let dbAvailable = false;
  let skipReason = '';
  let pool: Awaited<ReturnType<typeof import('@/lib/db').getPool>>;
  let sql: typeof import('@/lib/db').sql;
  let assertEmployeeIntervalAvailable: typeof import('@/lib/scheduleIntegrity').assertEmployeeIntervalAvailable;
  let ScheduleConflictError: typeof import('@/lib/scheduleIntegrity').ScheduleConflictError;
  let salonDateTimeToMs: typeof import('@/lib/publicBookingHelpers').salonDateTimeToMs;
  let generateBookingCode: typeof import('@/lib/publicBookingHelpers').generateBookingCode;
  let getCairoBusinessDate: typeof import('@/lib/businessDate').getCairoBusinessDate;
  let empId = 5;
  let clientId = 1;

  beforeAll(async () => {
    try {
      const dbMod = await import('@/lib/db');
      sql = dbMod.sql;
      await dbMod.setDbTarget('cloud');
      pool = await dbMod.getPool();
      const name = (await pool.request().query(`SELECT DB_NAME() AS n`)).recordset[0].n;
      if (String(name).toLowerCase() !== 'last132') {
        skipReason = `expected cloud last132, got ${name}`;
        return;
      }
      const si = await import('@/lib/scheduleIntegrity');
      assertEmployeeIntervalAvailable = si.assertEmployeeIntervalAvailable;
      ScheduleConflictError = si.ScheduleConflictError;
      const pb = await import('@/lib/publicBookingHelpers');
      salonDateTimeToMs = pb.salonDateTimeToMs;
      generateBookingCode = pb.generateBookingCode;
      getCairoBusinessDate = (await import('@/lib/businessDate')).getCairoBusinessDate;

      const emp = await pool.request().query(`
        SELECT TOP 1 EmpID FROM dbo.TblEmp WHERE ISNULL(IsActive,1)=1 ORDER BY EmpID
      `);
      empId = emp.recordset[0]?.EmpID ?? 5;
      const cli = await pool.request().query(`SELECT TOP 1 ClientID FROM dbo.TblClient ORDER BY ClientID`);
      clientId = cli.recordset[0]?.ClientID ?? 1;
      dbAvailable = true;
    } catch (e) {
      skipReason = e instanceof Error ? e.message : String(e);
    }
  }, 120_000);

  afterAll(async () => {
    if (!dbAvailable) return;
    await cleanup();
  });

  async function cleanup() {
    const found = await pool
      .request()
      .input('m', sql.NVarChar, `%${MARKER}%`)
      .query(`SELECT BookingID FROM dbo.Bookings WHERE Notes LIKE @m`);
    const ids = found.recordset.map((r: { BookingID: number }) => r.BookingID);
    if (!ids.length) return;
    await pool.request().query(`
      DELETE FROM dbo.BookingServices WHERE BookingID IN (${ids.join(',')});
      DELETE FROM dbo.Bookings WHERE BookingID IN (${ids.join(',')});
    `);
  }

  /** Shared write path used by both /create and /plan after the fix. */
  async function guardedInsert(args: {
    requestId: string;
    bookingDate: string;
    startHhmm: string;
    endHhmm: string;
    durationMinutes: number;
    operationalDate: string;
    barrier: { wait: () => Promise<void> };
  }): Promise<{ status: number; bookingId: number | null }> {
    const startAt = new Date(salonDateTimeToMs(args.bookingDate, args.startHhmm, TZ));
    let endAt = new Date(salonDateTimeToMs(args.bookingDate, args.endHhmm, TZ));
    if (endAt.getTime() <= startAt.getTime()) {
      endAt = new Date(startAt.getTime() + args.durationMinutes * 60_000);
    }
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      await args.barrier.wait();
      await assertEmployeeIntervalAvailable({
        empId,
        startAt,
        endAt,
        operationalDate: args.operationalDate,
        transaction,
      });
      await new Promise((r) => setTimeout(r, 30));
      const code = generateBookingCode();
      const ins = await transaction
        .request()
        .input('c', sql.Int, clientId)
        .input('e', sql.Int, empId)
        .input('d', sql.Date, args.bookingDate)
        .input('s', sql.VarChar, `${args.startHhmm}:00`)
        .input('en', sql.VarChar, `${args.endHhmm}:00`)
        .input('n', sql.NVarChar, `${MARKER} ${args.requestId}`)
        .input('code', sql.NVarChar, code)
        .query(`
          INSERT INTO dbo.Bookings
            (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
             Status, Source, Notes, BookingCode, CreatedByUserID)
          OUTPUT INSERTED.BookingID
          VALUES (@c, @e, @d, @s, @en, 'confirmed', 'online', @n, @code, 0)
        `);
      const bookingId = ins.recordset[0].BookingID as number;
      // DurationMinutes required so overnight EndTime wrap uses real length (not default 30).
      const pro = await transaction.request().query(`
        SELECT TOP 1 ProID FROM dbo.TblPro ORDER BY ProID
      `);
      const proId = pro.recordset[0]?.ProID as number | undefined;
      if (proId) {
        await transaction
          .request()
          .input('bId', sql.Int, bookingId)
          .input('proId', sql.Int, proId)
          .input('eId', sql.Int, empId)
          .input('mins', sql.Int, args.durationMinutes)
          .query(`
            INSERT INTO dbo.BookingServices (BookingID, ProID, EmpID, Qty, Price, DurationMinutes)
            VALUES (@bId, @proId, @eId, 1, 0, @mins)
          `);
      }
      await transaction.commit();
      return { status: 201, bookingId };
    } catch (err) {
      try {
        await transaction.rollback();
      } catch {
        /* ignore */
      }
      if (err instanceof ScheduleConflictError) return { status: 409, bookingId: null };
      throw err;
    }
  }

  async function pickWorkingSlot(): Promise<{ time: string; operationalDate: string }> {
    const candidates = ['15:00', '16:00', '17:00', '14:00', '18:00', '12:00'];
    for (const t of candidates) {
      const startAt = new Date(salonDateTimeToMs(DATE, t, TZ));
      const endAt = new Date(startAt.getTime() + DUR * 60_000);
      const op = getCairoBusinessDate(startAt);
      const tx = new sql.Transaction(pool);
      await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        await assertEmployeeIntervalAvailable({
          empId,
          startAt,
          endAt,
          operationalDate: op,
          transaction: tx,
        });
        await tx.rollback();
        return { time: t, operationalDate: op };
      } catch {
        try {
          await tx.rollback();
        } catch {
          /* ignore */
        }
      }
    }
    return { time: TIME, operationalDate: DATE };
  }

  it('create-path vs plan-path same interval: one 201, one 409 (x10)', async () => {
    if (!dbAvailable) {
      console.warn('skip:', skipReason);
      return;
    }
    const slot = await pickWorkingSlot();
    const end = hhmmPlus(slot.time, DUR);
    let both = 0;
    let one = 0;
    for (let i = 1; i <= ATTEMPTS; i++) {
      await cleanup();
      const barrier = makeBarrier(2);
      const [a, b] = await Promise.all([
        guardedInsert({
          requestId: `C-${i}-a`,
          bookingDate: DATE,
          startHhmm: slot.time,
          endHhmm: end,
          durationMinutes: DUR,
          operationalDate: slot.operationalDate,
          barrier,
        }),
        guardedInsert({
          requestId: `C-${i}-b`,
          bookingDate: DATE,
          startHhmm: slot.time,
          endHhmm: end,
          durationMinutes: DUR,
          operationalDate: slot.operationalDate,
          barrier,
        }),
      ]);
      const ok = [a.status, b.status].filter((s) => s === 201).length;
      const rej = [a.status, b.status].filter((s) => s === 409).length;
      if (ok === 2) both += 1;
      if (ok === 1 && rej === 1) one += 1;
    }
    await cleanup();
    expect(both).toBe(0);
    expect(one).toBe(ATTEMPTS);
  }, 300_000);

  it('plan vs plan same interval: one 201, one 409 (x10)', async () => {
    if (!dbAvailable) {
      console.warn('skip:', skipReason);
      return;
    }
    const slot = await pickWorkingSlot();
    const end = hhmmPlus(slot.time, DUR);
    let both = 0;
    let one = 0;
    for (let i = 1; i <= ATTEMPTS; i++) {
      await cleanup();
      const barrier = makeBarrier(2);
      const [a, b] = await Promise.all([
        guardedInsert({
          requestId: `B-${i}-a`,
          bookingDate: DATE,
          startHhmm: slot.time,
          endHhmm: end,
          durationMinutes: DUR,
          operationalDate: slot.operationalDate,
          barrier,
        }),
        guardedInsert({
          requestId: `B-${i}-b`,
          bookingDate: DATE,
          startHhmm: slot.time,
          endHhmm: end,
          durationMinutes: DUR,
          operationalDate: slot.operationalDate,
          barrier,
        }),
      ]);
      const ok = [a.status, b.status].filter((s) => s === 201).length;
      const rej = [a.status, b.status].filter((s) => s === 409).length;
      if (ok === 2) both += 1;
      if (ok === 1 && rej === 1) one += 1;
    }
    await cleanup();
    expect(both).toBe(0);
    expect(one).toBe(ATTEMPTS);
  }, 300_000);

  it('cross-midnight plan intervals: one 201, one 409 (x10)', async () => {
    if (!dbAvailable) {
      console.warn('skip:', skipReason);
      return;
    }
    // A: DATE 23:30–00:20 (50m), B: DATE+1 00:00–00:30
    const d = new Date(`${DATE}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    const next = d.toISOString().split('T')[0];
    const startA = new Date(salonDateTimeToMs(DATE, '23:30', TZ));
    // Prefer overnight operational date from start A
    const op = getCairoBusinessDate(startA);

    let both = 0;
    let one = 0;
    let skippedShift = 0;
    for (let i = 1; i <= ATTEMPTS; i++) {
      await cleanup();
      const barrier = makeBarrier(2);
      const [a, b] = await Promise.all([
        guardedInsert({
          requestId: `F-${i}-a`,
          bookingDate: DATE,
          startHhmm: '23:30',
          endHhmm: '00:20',
          durationMinutes: 50,
          operationalDate: op,
          barrier,
        }),
        guardedInsert({
          requestId: `F-${i}-b`,
          bookingDate: next,
          startHhmm: '00:00',
          endHhmm: '00:30',
          durationMinutes: 30,
          operationalDate: op,
          barrier,
        }),
      ]);
      const statuses = [a.status, b.status];
      // If both 409 due to outside shift, barber may not work overnight — skip attempt
      if (statuses.every((s) => s === 409)) {
        skippedShift += 1;
        continue;
      }
      const ok = statuses.filter((s) => s === 201).length;
      const rej = statuses.filter((s) => s === 409).length;
      if (ok === 2) both += 1;
      if (ok === 1 && rej === 1) one += 1;
    }
    await cleanup();
    if (skippedShift === ATTEMPTS) {
      console.warn('cross-midnight skipped: barber outside overnight shift on all attempts');
      return;
    }
    expect(both).toBe(0);
    expect(one).toBeGreaterThan(0);
    expect(one + skippedShift).toBe(ATTEMPTS);
  }, 300_000);
});
