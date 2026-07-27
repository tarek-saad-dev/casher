/**
 * Phase 6C — cross-branch global EmpID interval race.
 */
import { describe, expect, it, vi, beforeAll } from 'vitest';
import { getPool, sql } from '@/lib/db';
import {
  initPhase6CSmokeContext,
  setupCrossBranchGlobalEmployee,
  runCreate,
  runCreateInSmokeContext,
  cleanupPhase6C,
  makeBarrier,
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

describe('bookingCreateCrossBranchGlobalRace', () => {
  itIfDb(
    'same global EmpID at same absolute interval is rejected by global lock across branches',
    async () => {
      ctx = await initPhase6CSmokeContext();
      const workDate = '2026-12-16';
      const startTime = '08:00';
      const endTime = '22:00';
      const empId = await setupCrossBranchGlobalEmployee(ctx, workDate, startTime, endTime);

      await ctx.db
        .request()
        .input('branchId', sql.Int, ctx.gleemBranchId)
        .query(
          `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
        );

      const serviceIds = ctx.serviceProIds.slice(0, 1);
      const keyPublic = `P6C-CROSS-P-${crypto.randomUUID()}`;
      const keyInternal = `P6C-CROSS-I-${crypto.randomUUID()}`;

      const barrier = makeBarrier(2);
      const [publicReq, internalReq] = await Promise.all([
        (async () => {
          await barrier.wait();
          return runCreateInSmokeContext(ctx, () =>
            runCreate({
              branchCode: 'GLEEM',
              date: workDate,
              time: '14:00',
              dayOffset: 0,
              serviceIds,
              empId,
              mode: 'specific_barber',
              customerName: 'Phase6C Cross Public',
              customerPhone: '01000000003',
              idempotencyKey: keyPublic,
              suppressNotification: true,
            }),
          );
        })(),
        (async () => {
          await barrier.wait();
          return runCreateInSmokeContext(ctx, () =>
            runCreate({
              branchCode: 'CAMP_CAESAR',
              date: workDate,
              time: '14:00',
              dayOffset: 0,
              serviceIds,
              empId,
              mode: 'specific_barber',
              customerName: 'Phase6C Cross Internal',
              customerPhone: '01000000004',
              idempotencyKey: keyInternal,
              suppressNotification: true,
              auth: { userId: ctx.smokeRun.startedByUserId, canOperate: true },
              purpose: 'internal_preview',
            }),
          );
        })(),
      ]);

      const successes = [publicReq, internalReq].filter((o) => o.ok);
      expect(successes.length).toBeLessThanOrEqual(1);

      const failed = [publicReq, internalReq].find((o) => !o.ok);
      if (failed) {
        expect(['SLOT_UNAVAILABLE', 'BOOKING_LOCK_TIMEOUT']).toContain(failed.code);
      }

      for (const o of successes) {
        if (o.ok) ctx.disposable.bookingCodes.push(o.code);
      }
      ctx.disposable.idempotencyKeys.push(keyPublic, keyInternal);

      const db = await getPool();
      const overlap = await db
        .request()
        .input('empId', sql.Int, empId)
        .query(
          `SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE AssignedEmpID=@empId AND Status=N'confirmed'`,
        );
      expect(Number(overlap.recordset[0].cnt)).toBeLessThanOrEqual(1);

      await cleanupPhase6C(ctx);
    },
  );
});
