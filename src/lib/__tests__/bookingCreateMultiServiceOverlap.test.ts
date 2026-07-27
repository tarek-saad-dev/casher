/**
 * Phase 6C — multi-service overlap boundaries.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { getPool, sql } from '@/lib/db';
import {
  initPhase6CSmokeContext,
  setupDisposableBarberPair,
  runCreate,
  runCreateInSmokeContext,
  cleanupPhase6C,
  type P6CContext,
} from './helpers/phase6cSmokeHarness';

vi.mock('server-only', () => ({}));

let dbAvailable = false;
let ctx: P6CContext | null = null;

beforeAll(async () => {
  try {
    const pool = await getPool();
    await pool.request().query('SELECT 1 AS ok');
    dbAvailable = true;
  } catch {
    dbAvailable = false;
  }
}, 30_000);

const itIfDb = (name: string, fn: () => Promise<void>, timeout = 120_000) => {
  it(
    name,
    async () => {
      if (!dbAvailable) throw new Error('DB not available');
      await fn();
    },
    timeout,
  );
};

describe('bookingCreateMultiServiceOverlap', () => {
  itIfDb(
    'enforces half-open interval overlaps for 90-minute multi-service booking',
    async () => {
      ctx = await initPhase6CSmokeContext();
      const workDate = '2026-12-17';
      const startTime = '08:00';
      const endTime = '22:00';
      const { empX } = await setupDisposableBarberPair(ctx, workDate, startTime, endTime);

      await ctx.db
        .request()
        .input('branchId', sql.Int, ctx.gleemBranchId)
        .query(
          `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
        );

      const baseServiceIds = ctx.serviceProIds.slice(0, 3);
      if (baseServiceIds.length < 2) {
        throw new Error('Need at least 2 distinct public services for multi-service overlap');
      }
      const serviceIds = baseServiceIds;
      const baseKey = `P6C-OVERLAP-${crypto.randomUUID()}`;

      const base = await runCreateInSmokeContext(ctx, () =>
        runCreate({
          branchCode: 'GLEEM',
          date: workDate,
          time: '14:00',
          dayOffset: 0,
          serviceIds,
          empId: empX,
          mode: 'specific_barber',
          customerName: 'Phase6C Base',
          customerPhone: '01000000005',
          idempotencyKey: `${baseKey}-base`,
          suppressNotification: true,
        }),
      );
      expect(base.ok).toBe(true);
      if (base.ok) ctx.disposable.bookingCodes.push(base.code);

      const db = await getPool();
      const baseRow = await db
        .request()
        .input('code', sql.NVarChar, (base as { code: string }).code)
        .query(
          `SELECT AbsoluteStartUtc, AbsoluteEndUtc FROM dbo.Bookings WHERE BookingCode=@code`,
        );
      const startMs = new Date(String(baseRow.recordset[0].AbsoluteStartUtc)).getTime();
      const endMs = new Date(String(baseRow.recordset[0].AbsoluteEndUtc)).getTime();
      const durationMs = endMs - startMs;
      const durationMinutes = Math.round(durationMs / 60_000);
      expect(durationMinutes).toBeGreaterThanOrEqual(30);

      function addMins(time: string, minutes: number): string {
        let total = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
        total = ((total % 1440) + 1440) % 1440;
        return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
      }

      const cases: Array<{ label: string; time: string; expectedOk: boolean }> = [
        { label: 'same_start', time: '14:00', expectedOk: false },
        {
          label: 'inside_mid',
          time: addMins('14:00', Math.max(1, Math.floor(durationMinutes / 2))),
          expectedOk: false,
        },
        { label: 'inside_end_minus_1', time: addMins('14:00', durationMinutes - 1), expectedOk: false },
        { label: 'exact_end', time: addMins('14:00', durationMinutes), expectedOk: true },
      ];

      for (const c of cases) {
        const outcome = await runCreateInSmokeContext(ctx, () =>
          runCreate({
            branchCode: 'GLEEM',
            date: workDate,
            time: c.time,
            dayOffset: 0,
            serviceIds,
            empId: empX,
            mode: 'specific_barber',
            customerName: `Phase6C ${c.label}`,
            customerPhone: '01000000006',
            idempotencyKey: `${baseKey}-${c.label}`,
            suppressNotification: true,
          }),
        );
        expect(outcome.ok).toBe(c.expectedOk);
        if (outcome.ok) ctx.disposable.bookingCodes.push(outcome.code);
      }

      const endsAtStart = await runCreateInSmokeContext(ctx, () =>
        runCreate({
          branchCode: 'GLEEM',
          date: workDate,
          time: addMins('14:00', -durationMinutes),
          dayOffset: 0,
          serviceIds,
          empId: empX,
          mode: 'specific_barber',
          customerName: 'Phase6C ends_at_start',
          customerPhone: '01000000007',
          idempotencyKey: `${baseKey}-ends`,
          suppressNotification: true,
        }),
      );
      expect(endsAtStart.ok).toBe(true);
      if (endsAtStart.ok) ctx.disposable.bookingCodes.push(endsAtStart.code);

      ctx.disposable.idempotencyKeys.push(
        `${baseKey}-base`,
        `${baseKey}-same_start`,
        `${baseKey}-inside_mid`,
        `${baseKey}-inside_end_minus_1`,
        `${baseKey}-exact_end`,
        `${baseKey}-ends`,
      );

      await cleanupPhase6C(ctx);
    },
  );
});
