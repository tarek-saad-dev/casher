/**
 * Phase 6C — mid-transaction rollback and retry.
 * Verifier-only hook after booking head insert, before service details.
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
import {
  setBookingCreateTestHooks,
  clearBookingCreateTestHooks,
} from '@/lib/booking/publicBookingCreate';

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
});

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

describe('bookingCreateRollbackRetry', () => {
  itIfDb(
    'injected failure after head insert rolls back and idempotency becomes retryable',
    async () => {
      ctx = await initPhase6CSmokeContext();
      const workDate = '2026-12-22';
      const { empX } = await setupDisposableBarberPair(ctx, workDate, '08:00', '22:00');
      await ctx.db
        .request()
        .input('branchId', sql.Int, ctx.gleemBranchId)
        .query(
          `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
        );

      if (process.env.BOOKING_PHASE_6C_VERIFIER !== 'enabled') {
        process.env.BOOKING_PHASE_6C_VERIFIER = 'enabled';
      }
      let injected = false;
      setBookingCreateTestHooks({
        postBookingHeadInsert: async () => {
          if (!injected) {
            injected = true;
            throw new Error('INJECTED_POST_HEAD_FAILURE');
          }
        },
      });

      const key = `P6C-ROLLBACK-${crypto.randomUUID()}`;
      const failResult = await runCreateInSmokeContext(ctx, () =>
        runCreate({
          branchCode: 'GLEEM',
          date: workDate,
          time: '14:00',
          dayOffset: 0,
          serviceIds: ctx!.serviceProIds.slice(0, 1),
          empId: empX,
          mode: 'specific_barber',
          customerName: 'Phase6C Rollback',
          customerPhone: '01000000010',
          idempotencyKey: key,
          suppressNotification: true,
        }),
      );

      if (failResult.ok) throw new Error('expected rollback failure');
      expect(failResult.deadlock).toBe(false);
      expect(failResult.poolError).toBe(false);

      const db = await getPool();
      const idem = await db
        .request()
        .input('key', sql.NVarChar, key)
        .query(
          `SELECT Status, LastErrorCode FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey=@key`,
        );
      expect(idem.recordset[0]?.Status).toBe('FAILED');

      const bookings = await db
        .request()
        .input('key', sql.NVarChar, key)
        .query(
          `SELECT COUNT(*) AS cnt FROM dbo.Bookings WHERE IdempotencyRequestID=(SELECT RequestID FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey=@key)`,
        );
      expect(Number(bookings.recordset[0].cnt)).toBe(0);

      clearBookingCreateTestHooks();

      const retry = await runCreateInSmokeContext(ctx, () =>
        runCreate({
          branchCode: 'GLEEM',
          date: workDate,
          time: '14:00',
          dayOffset: 0,
          serviceIds: ctx!.serviceProIds.slice(0, 1),
          empId: empX,
          mode: 'specific_barber',
          customerName: 'Phase6C Retry',
          customerPhone: '01000000010',
          idempotencyKey: key,
          suppressNotification: true,
        }),
      );

      if (!retry.ok) throw new Error(`retry failed: ${retry.code}`);
      ctx.disposable.bookingCodes.push(retry.code);
      ctx.disposable.idempotencyKeys.push(key);

      const details = await db
        .request()
        .input('code', sql.NVarChar, retry.code)
        .query(
          `SELECT COUNT(*) AS cnt FROM dbo.BookingServices WHERE BookingID=(SELECT BookingID FROM dbo.Bookings WHERE BookingCode=@code)`,
        );
      expect(Number(details.recordset[0].cnt)).toBeGreaterThan(0);

      await cleanupPhase6C(ctx);
    },
  );

  it(
    'verifier-only hooks require BOOKING_PHASE_6C_VERIFIER=enabled',
    () => {
      const original = process.env.BOOKING_PHASE_6C_VERIFIER;
      process.env.BOOKING_PHASE_6C_VERIFIER = 'disabled';
      try {
        expect(() =>
          setBookingCreateTestHooks({ generateBookingCode: () => 'BK-TEST' }),
        ).toThrow('BOOKING_PHASE_6C_VERIFIER is required');
      } finally {
        process.env.BOOKING_PHASE_6C_VERIFIER = original ?? undefined;
      }
    },
  );
});
