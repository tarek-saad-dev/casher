/**
 * SQL Server adapter for slot claims.
 * Assumes TblBookingSlotClaim exists (deploy-time migration).
 * NO ensure/CREATE on the hot path.
 */

import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import {
  SlotClaimConflictError,
  type SlotClaimRow,
} from '@/lib/booking/claims/BookingSlotClaimTypes';
import type {
  SlotClaimInsert,
  SlotClaimStore,
  SlotClaimStoreTx,
} from '@/lib/booking/claims/BookingSlotClaimStore';

function rowFromSql(r: Record<string, unknown>): SlotClaimRow {
  const start =
    r.AbsoluteSlotStartUtc instanceof Date
      ? r.AbsoluteSlotStartUtc.getTime()
      : new Date(String(r.AbsoluteSlotStartUtc)).getTime();
  const exp =
    r.ExpiresAtUtc == null
      ? null
      : r.ExpiresAtUtc instanceof Date
        ? r.ExpiresAtUtc.getTime()
        : new Date(String(r.ExpiresAtUtc)).getTime();
  const created =
    r.CreatedAtUtc instanceof Date
      ? r.CreatedAtUtc.getTime()
      : new Date(String(r.CreatedAtUtc)).getTime();
  return {
    claimId: Number(r.ClaimID),
    empId: Number(r.EmpID),
    branchId: Number(r.BranchID),
    absoluteSlotStartUtcMs: start,
    claimType: String(r.ClaimType) as SlotClaimRow['claimType'],
    holdToken: r.HoldToken != null ? String(r.HoldToken) : null,
    bookingId: r.BookingID != null ? Number(r.BookingID) : null,
    ownerKey: r.OwnerKey != null ? String(r.OwnerKey) : null,
    expiresAtUtcMs: exp,
    createdAtUtcMs: created,
  };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { number?: number; message?: string };
  return (
    e?.number === 2627 ||
    e?.number === 2601 ||
    /UQ_TblBookingSlotClaim_Emp_Slot|UNIQUE|duplicate/i.test(String(e?.message ?? ''))
  );
}

function makeTx(transaction: Transaction): SlotClaimStoreTx {
  const req = () => new sql.Request(transaction);

  return {
    async insert(row: SlotClaimInsert) {
      try {
        const res = await req()
          .input('empId', sql.Int, row.empId)
          .input('branchId', sql.Int, row.branchId)
          .input('slot', sql.DateTime2, new Date(row.absoluteSlotStartUtcMs))
          .input('type', sql.NVarChar(16), row.claimType)
          .input('holdToken', sql.NVarChar(80), row.holdToken ?? null)
          .input('bookingId', sql.Int, row.bookingId ?? null)
          .input('ownerKey', sql.NVarChar(120), row.ownerKey ?? null)
          .input(
            'expires',
            sql.DateTime2,
            row.expiresAtUtcMs != null ? new Date(row.expiresAtUtcMs) : null,
          )
          .query(`
            INSERT INTO dbo.TblBookingSlotClaim
              (EmpID, BranchID, AbsoluteSlotStartUtc, ClaimType,
               HoldToken, BookingID, OwnerKey, ExpiresAtUtc)
            OUTPUT INSERTED.*
            VALUES
              (@empId, @branchId, @slot, @type,
               @holdToken, @bookingId, @ownerKey, @expires)
          `);
        return rowFromSql(res.recordset[0] as Record<string, unknown>);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new SlotClaimConflictError(
            row.claimType === 'HOLD' ? 'HOLD_CONFLICT' : 'SLOT_CLAIM_CONFLICT',
            { empId: row.empId, slotMs: row.absoluteSlotStartUtcMs },
          );
        }
        throw err;
      }
    },

    async deleteByHoldToken(holdToken) {
      const res = await req()
        .input('holdToken', sql.NVarChar(80), holdToken)
        .query(`
          DELETE FROM dbo.TblBookingSlotClaim WHERE HoldToken = @holdToken;
          SELECT @@ROWCOUNT AS n;
        `);
      return Number(res.recordset[0]?.n ?? 0);
    },

    async deleteByBookingId(bookingId) {
      const res = await req()
        .input('bookingId', sql.Int, bookingId)
        .query(`
          DELETE FROM dbo.TblBookingSlotClaim WHERE BookingID = @bookingId;
          SELECT @@ROWCOUNT AS n;
        `);
      return Number(res.recordset[0]?.n ?? 0);
    },

    async deleteByBookingIdAndSlots(bookingId, slotStartsUtcMs) {
      if (!slotStartsUtcMs.length) return 0;
      const r = req().input('bookingId', sql.Int, bookingId);
      slotStartsUtcMs.forEach((ms, i) =>
        r.input(`s${i}`, sql.DateTime2, new Date(ms)),
      );
      const res = await r.query(`
        DELETE FROM dbo.TblBookingSlotClaim
        WHERE BookingID = @bookingId
          AND AbsoluteSlotStartUtc IN (${slotStartsUtcMs.map((_, i) => `@s${i}`).join(',')});
        SELECT @@ROWCOUNT AS n;
      `);
      return Number(res.recordset[0]?.n ?? 0);
    },

    async convertHoldToBooking(args) {
      const res = await req()
        .input('holdToken', sql.NVarChar(80), args.holdToken)
        .input('bookingId', sql.Int, args.bookingId)
        .input('ownerKey', sql.NVarChar(120), args.ownerKey ?? null)
        .query(`
          UPDATE dbo.TblBookingSlotClaim
          SET ClaimType = N'BOOKING',
              BookingID = @bookingId,
              HoldToken = NULL,
              ExpiresAtUtc = NULL,
              OwnerKey = COALESCE(@ownerKey, OwnerKey)
          WHERE HoldToken = @holdToken AND ClaimType = N'HOLD';
          SELECT @@ROWCOUNT AS n;
        `);
      return Number(res.recordset[0]?.n ?? 0);
    },

    async listByHoldToken(holdToken) {
      const res = await req()
        .input('holdToken', sql.NVarChar(80), holdToken)
        .query(`
          SELECT * FROM dbo.TblBookingSlotClaim WHERE HoldToken = @holdToken
        `);
      return res.recordset.map((r: Record<string, unknown>) => rowFromSql(r));
    },

    async listByBookingId(bookingId) {
      const res = await req()
        .input('bookingId', sql.Int, bookingId)
        .query(`
          SELECT * FROM dbo.TblBookingSlotClaim WHERE BookingID = @bookingId
        `);
      return res.recordset.map((r: Record<string, unknown>) => rowFromSql(r));
    },

    async listByEmpSlots(args) {
      if (!args.slotStartsUtcMs.length) return [];
      const r = req().input('empId', sql.Int, args.empId);
      args.slotStartsUtcMs.forEach((ms, i) =>
        r.input(`s${i}`, sql.DateTime2, new Date(ms)),
      );
      const res = await r.query(`
        SELECT * FROM dbo.TblBookingSlotClaim
        WHERE EmpID = @empId
          AND AbsoluteSlotStartUtc IN (${args.slotStartsUtcMs.map((_, i) => `@s${i}`).join(',')})
      `);
      return res.recordset.map((row: Record<string, unknown>) => rowFromSql(row));
    },

    async deleteExpiredHolds(nowMs) {
      const res = await req()
        .input('now', sql.DateTime2, new Date(nowMs))
        .query(`
          DELETE FROM dbo.TblBookingSlotClaim
          WHERE ClaimType = N'HOLD' AND ExpiresAtUtc IS NOT NULL AND ExpiresAtUtc <= @now;
          SELECT @@ROWCOUNT AS n;
        `);
      return Number(res.recordset[0]?.n ?? 0);
    },

    async deleteExpiredHoldsForSlots(args) {
      if (!args.slotStartsUtcMs.length) return 0;
      const r = req()
        .input('empId', sql.Int, args.empId)
        .input('now', sql.DateTime2, new Date(args.nowMs));
      args.slotStartsUtcMs.forEach((ms, i) =>
        r.input(`s${i}`, sql.DateTime2, new Date(ms)),
      );
      const res = await r.query(`
        DELETE FROM dbo.TblBookingSlotClaim
        WHERE EmpID = @empId
          AND ClaimType = N'HOLD'
          AND ExpiresAtUtc IS NOT NULL AND ExpiresAtUtc <= @now
          AND AbsoluteSlotStartUtc IN (${args.slotStartsUtcMs.map((_, i) => `@s${i}`).join(',')});
        SELECT @@ROWCOUNT AS n;
      `);
      return Number(res.recordset[0]?.n ?? 0);
    },
  };
}

/** Bind claim ops onto an existing mssql Transaction (dual-guard inside booking TX). */
export function bindBookingSlotClaimTx(transaction: Transaction): SlotClaimStoreTx {
  return makeTx(transaction);
}

export function createBookingSlotClaimSqlStore(): SlotClaimStore {
  return {
    async withTransaction(fn) {
      const db = await getPool();
      const transaction = new sql.Transaction(db);
      await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
      try {
        const result = await fn(makeTx(transaction));
        await transaction.commit();
        return result;
      } catch (err) {
        try {
          await transaction.rollback();
        } catch {
          /* ignore */
        }
        throw err;
      }
    },
    async deleteExpiredHolds(nowMs) {
      const db = await getPool();
      const res = await db
        .request()
        .input('now', sql.DateTime2, new Date(nowMs))
        .query(`
          DELETE FROM dbo.TblBookingSlotClaim
          WHERE ClaimType = N'HOLD' AND ExpiresAtUtc IS NOT NULL AND ExpiresAtUtc <= @now;
          SELECT @@ROWCOUNT AS n;
        `);
      return Number(res.recordset[0]?.n ?? 0);
    },
    async listByEmpRange(args) {
      const db = await getPool();
      const res = await db
        .request()
        .input('empId', sql.Int, args.empId)
        .input('a', sql.DateTime2, new Date(args.rangeStartMs))
        .input('b', sql.DateTime2, new Date(args.rangeEndMs))
        .query(`
          SELECT * FROM dbo.TblBookingSlotClaim
          WHERE EmpID = @empId
            AND AbsoluteSlotStartUtc >= @a
            AND AbsoluteSlotStartUtc < @b
        `);
      return res.recordset.map((r: Record<string, unknown>) => rowFromSql(r));
    },
  };
}
