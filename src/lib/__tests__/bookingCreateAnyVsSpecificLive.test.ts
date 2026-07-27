/**
 * Phase 6C — any-barber vs specific-barber live race.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { getPool, sql } from '@/lib/db';
import {
  initPhase6CSmokeContext,
  setupDisposableBarberPair,
  runCreate,
  runCreateInSmokeContext,
  cleanupPhase6C,
  makeBarrier,
  P6C_MARKER,
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

describe('bookingCreateAnyVsSpecificLive', () => {
  itIfDb(
    'specific and any-barber requests never double-book the same barber',
    async () => {
      ctx = await initPhase6CSmokeContext();
      const workDate = '2026-12-15';
      const startTime = '08:00';
      const endTime = '22:00';
      const { empX, empY } = await setupDisposableBarberPair(ctx, workDate, startTime, endTime);
      await ctx.db
        .request()
        .input('branchId', sql.Int, ctx.gleemBranchId)
        .query(
          `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
        );
      const serviceIds = ctx.serviceProIds.slice(0, 1);
      const keyA = `P6C-ANYVSPEC-A-${crypto.randomUUID()}`;
      const keyB = `P6C-ANYVSPEC-B-${crypto.randomUUID()}`;

      const barrier = makeBarrier(2);
      // eslint-disable-next-line no-console
      console.log('any-vs-specific race setup complete', { empX, empY, serviceIds });

      const [a, b] = await Promise.all([
        (async () => {
          await barrier.wait();
          return runCreateInSmokeContext(ctx, () =>
            runCreate({
              branchCode: 'GLEEM',
              date: workDate,
              time: '14:00',
              dayOffset: 0,
              serviceIds,
              empId: empX,
              mode: 'specific_barber',
              customerName: `${P6C_MARKER} Specific`,
              customerPhone: '01000000001',
              idempotencyKey: keyA,
              suppressNotification: true,
            }),
          );
        })(),
        (async () => {
          await barrier.wait();
          return runCreateInSmokeContext(ctx, () =>
            runCreate({
              branchCode: 'GLEEM',
              date: workDate,
              time: '14:00',
              dayOffset: 0,
              serviceIds,
              mode: 'any_barber',
              customerName: `${P6C_MARKER} Any`,
              customerPhone: '01000000002',
              idempotencyKey: keyB,
              suppressNotification: true,
            }),
          );
        })(),
      ]);

      // eslint-disable-next-line no-console
      console.log('any-vs-specific race outcomes', { a, b });

      const okA = a.ok ? a : undefined;
      const okB = b.ok ? b : undefined;
      const successCount = (okA ? 1 : 0) + (okB ? 1 : 0);
      expect(successCount).toBe(2);

      const empIds = [okA?.empId, okB?.empId];
      expect(new Set(empIds).size).toBe(2);
      expect(okA?.empId).toBe(empX);
      expect(okB?.empId).not.toBe(empX);

      if (okA) ctx.disposable.bookingCodes.push(okA.code);
      if (okB) ctx.disposable.bookingCodes.push(okB.code);
      ctx.disposable.idempotencyKeys.push(keyA, keyB);

      await cleanupPhase6C(ctx);
    },
  );
});
