/**
 * Phase 6C — overnight equivalent representation protection.
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

describe('bookingCreateOvernightEquivalent', () => {
  itIfDb(
    'canonical dayOffset=1 representation is accepted and duplicate dayOffset=0 is rejected',
    async () => {
      ctx = await initPhase6CSmokeContext();
      const workDate = '2026-12-18';
      const startTime = '20:00';
      const endTime = '04:00';
      const { empX } = await setupDisposableBarberPair(ctx, workDate, startTime, endTime);

      await ctx.db
        .request()
        .input('branchId', sql.Int, ctx.gleemBranchId)
        .query(
          `UPDATE dbo.QueueBookingSettings SET BookingEnabled=1, UpdatedAt=GETDATE() WHERE BranchID=@branchId`,
        );

      const serviceIds = ctx.serviceProIds.slice(0, 1);
      const baseKey = `P6C-OVR-${crypto.randomUUID()}`;

      const canonical = await runCreateInSmokeContext(ctx, () =>
        runCreate({
          branchCode: 'GLEEM',
          date: workDate,
          time: '00:15',
          dayOffset: 1,
          serviceIds,
          empId: empX,
          mode: 'specific_barber',
          customerName: 'Phase6C Canonical',
          customerPhone: '01000000008',
          idempotencyKey: `${baseKey}-canonical`,
          suppressNotification: true,
        }),
      );
      expect(canonical.ok).toBe(true);
      if (canonical.ok) ctx.disposable.bookingCodes.push(canonical.code);

      const db = await getPool();
      const row = await db
        .request()
        .input('code', sql.NVarChar, (canonical as { code: string }).code)
        .query(
          `SELECT PublicWorkDate, PublicDayOffset, AbsoluteStartUtc, AbsoluteEndUtc FROM dbo.Bookings WHERE BookingCode=@code`,
        );
      const prow = row.recordset[0];
      expect(Number(prow.PublicDayOffset)).toBe(1);
      expect(prow.PublicWorkDate).toBeTruthy();
      expect(prow.AbsoluteStartUtc).toBeTruthy();
      expect(prow.AbsoluteEndUtc).toBeTruthy();

      const duplicate = await runCreateInSmokeContext(ctx, () =>
        runCreate({
          branchCode: 'GLEEM',
          date: '2026-12-19',
          time: '00:15',
          dayOffset: 0,
          serviceIds,
          empId: empX,
          mode: 'specific_barber',
          customerName: 'Phase6C Duplicate Repr',
          customerPhone: '01000000009',
          idempotencyKey: `${baseKey}-duplicate`,
          suppressNotification: true,
        }),
      );
      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) {
        expect([
          'SLOT_UNAVAILABLE',
          'BOOKING_LOCK_TIMEOUT',
          'SLOT_OUTSIDE_BRANCH_HOURS',
          'BARBER_DAY_OFF',
        ]).toContain(duplicate.code);
      }

      ctx.disposable.idempotencyKeys.push(`${baseKey}-canonical`, `${baseKey}-duplicate`);

      await cleanupPhase6C(ctx);
    },
  );
});
