/**
 * Phase 6C — booking-code collision handling.
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

describe('bookingCreateCodeCollision', () => {
  itIfDb(
    'bounded retry resolves a single code collision',
    async () => {
      ctx = await initPhase6CSmokeContext();
      const workDate = '2026-12-23';
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
      const fixedCode = `P6C-COLL-${Date.now().toString(36).toUpperCase()}`;
      let calls = 0;
      setBookingCreateTestHooks({
        generateBookingCode: () => {
          calls += 1;
          return calls === 1 ? fixedCode : `P6C-OK-${Date.now().toString(36).toUpperCase()}`;
        },
      });

      const db = await getPool();
      await db.request().input('code', sql.NVarChar, fixedCode).query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.Bookings WHERE BookingCode=@code)
          INSERT INTO dbo.Bookings (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime, Status, Source, BookingCode, BranchID)
          VALUES (0, 0, '2026-12-01', '10:00:00', '10:30:00', 'confirmed', 'smoke_seed', @code, (SELECT TOP 1 BranchID FROM dbo.TblBranch WHERE BranchCode=N'GLEEM'))
      `);

      const key = `P6C-COLLISION-${crypto.randomUUID()}`;
      const result = await runCreateInSmokeContext(ctx, () =>
        runCreate({
          branchCode: 'GLEEM',
          date: workDate,
          time: '14:00',
          dayOffset: 0,
          serviceIds: ctx!.serviceProIds.slice(0, 1),
          empId: empX,
          mode: 'specific_barber',
          customerName: 'Phase6C Collision',
          customerPhone: '01000000011',
          idempotencyKey: key,
          suppressNotification: true,
        }),
      );
      clearBookingCreateTestHooks();

      expect(result.ok).toBe(true);
      if (result.ok) {
        ctx.disposable.bookingCodes.push(result.code);
      }
      ctx.disposable.idempotencyKeys.push(key);

      await cleanupPhase6C(ctx);
    },
  );

  itIfDb(
    'every retry colliding returns BOOKING_CODE_GENERATION_FAILED with no partial rows',
    async () => {
      ctx = await initPhase6CSmokeContext();
      const workDate = '2026-12-24';
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
      const fixedCode = `P6C-ALWAYS-${Date.now().toString(36).toUpperCase()}`;
      setBookingCreateTestHooks({
        generateBookingCode: () => fixedCode,
      });

      const db = await getPool();
      await db.request().input('code', sql.NVarChar, fixedCode).query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.Bookings WHERE BookingCode=@code)
          INSERT INTO dbo.Bookings (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime, Status, Source, BookingCode, BranchID)
          VALUES (0, 0, '2026-12-01', '15:00:00', '15:30:00', 'confirmed', 'smoke_seed', @code, (SELECT TOP 1 BranchID FROM dbo.TblBranch WHERE BranchCode=N'GLEEM'))
      `);

      const key = `P6C-ALWAYS-${crypto.randomUUID()}`;
      const result = await runCreateInSmokeContext(ctx, () =>
        runCreate({
          branchCode: 'GLEEM',
          date: workDate,
          time: '15:00',
          dayOffset: 0,
          serviceIds: ctx!.serviceProIds.slice(0, 1),
          empId: empX,
          mode: 'specific_barber',
          customerName: 'Phase6C Always',
          customerPhone: '01000000012',
          idempotencyKey: key,
          suppressNotification: true,
        }),
      );
      clearBookingCreateTestHooks();

      expect(result.ok).toBe(false);
      expect(result.code).toBe('BOOKING_CODE_GENERATION_FAILED');
      ctx.disposable.idempotencyKeys.push(key);

      const idem = await db
        .request()
        .input('key', sql.NVarChar, key)
        .query(
          `SELECT Status FROM dbo.TblPublicBookingCreateRequest WHERE IdempotencyKey=@key`,
        );
      expect(idem.recordset[0]?.Status).toBe('FAILED');

      await cleanupPhase6C(ctx);
    },
  );
});
