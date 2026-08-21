/**
 * Optional SQL Server adapter for weekly baseline projections.
 * Correctness still requires rebuild-from-SoT on miss/stale — this is not SoT.
 *
 * Server-only: do not import from client bundles.
 */

import 'server-only';
import { getPool, sql } from '@/lib/db';
import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import {
  parseWeeklyBaselineKey,
  type NormalizedWeeklyBaselinePlan,
  type WeeklyBaselineKey,
  type WeeklyBaselineProjectionRecord,
} from '@/lib/booking/domain/WeeklyBaseline';
import type { WeeklyBaselineStore } from '@/lib/booking/projection/WeeklyBaselineStore';
import { ensureWeeklyBaselineProjectionTables } from '@/lib/booking/projection/ensureWeeklyBaselineProjectionTables';

function serializeRecord(record: WeeklyBaselineProjectionRecord) {
  return {
    empId: record.key.employeeId,
    branchId: record.key.branchId,
    dayOfWeek: record.key.dayOfWeek,
    revision: record.revision,
    sourceFingerprint: record.sourceFingerprint,
    bitmapBase64: record.bitmap.toBase64(),
    freeRangesJson: JSON.stringify(record.freeRanges),
    planJson: JSON.stringify(record.plan),
    builtAtUtc: new Date(record.builtAtMs),
  };
}

function deserializeRow(row: Record<string, unknown>): WeeklyBaselineProjectionRecord {
  const key = parseWeeklyBaselineKey({
    employeeId: Number(row.EmpID),
    branchId: Number(row.BranchID),
    dayOfWeek: Number(row.DayOfWeek) as 0 | 1 | 2 | 3 | 4 | 5 | 6,
  });
  const bitmap = AvailabilityBitmap.fromBase64(String(row.BitmapBase64));
  const freeRanges = JSON.parse(String(row.FreeRangesJson)) as WeeklyBaselineProjectionRecord['freeRanges'];
  const plan = JSON.parse(String(row.PlanJson)) as NormalizedWeeklyBaselinePlan;
  const builtAt =
    row.BuiltAtUtc instanceof Date
      ? row.BuiltAtUtc.getTime()
      : new Date(String(row.BuiltAtUtc)).getTime();
  return {
    key,
    revision: Number(row.Revision),
    sourceFingerprint: String(row.SourceFingerprint),
    bitmap,
    freeRanges,
    plan,
    builtAtMs: builtAt,
  };
}

export function createWeeklyBaselineDbStore(): WeeklyBaselineStore {
  return {
    async get(key) {
      await ensureWeeklyBaselineProjectionTables();
      const db = await getPool();
      const k = parseWeeklyBaselineKey(key);
      const res = await db
        .request()
        .input('empId', sql.Int, k.employeeId)
        .input('branchId', sql.Int, k.branchId)
        .input('dow', sql.TinyInt, k.dayOfWeek)
        .query(`
          SELECT EmpID, BranchID, DayOfWeek, Revision, SourceFingerprint,
                 BitmapBase64, FreeRangesJson, PlanJson, BuiltAtUtc
          FROM dbo.TblBookingWeeklyBaselineProjection
          WHERE EmpID = @empId AND BranchID = @branchId AND DayOfWeek = @dow
        `);
      const row = res.recordset[0];
      if (!row) return null;
      return deserializeRow(row);
    },

    async put(record) {
      await ensureWeeklyBaselineProjectionTables();
      const db = await getPool();
      const s = serializeRecord(record);
      await db
        .request()
        .input('empId', sql.Int, s.empId)
        .input('branchId', sql.Int, s.branchId)
        .input('dow', sql.TinyInt, s.dayOfWeek)
        .input('revision', sql.BigInt, s.revision)
        .input('fp', sql.VarChar(64), s.sourceFingerprint)
        .input('bitmap', sql.VarChar(256), s.bitmapBase64)
        .input('ranges', sql.NVarChar(sql.MAX), s.freeRangesJson)
        .input('plan', sql.NVarChar(sql.MAX), s.planJson)
        .input('builtAt', sql.DateTime2, s.builtAtUtc)
        .query(`
          MERGE dbo.TblBookingWeeklyBaselineProjection AS t
          USING (SELECT @empId AS EmpID, @branchId AS BranchID, @dow AS DayOfWeek) AS s
          ON t.EmpID = s.EmpID AND t.BranchID = s.BranchID AND t.DayOfWeek = s.DayOfWeek
          WHEN MATCHED THEN UPDATE SET
            Revision = @revision,
            SourceFingerprint = @fp,
            BitmapBase64 = @bitmap,
            FreeRangesJson = @ranges,
            PlanJson = @plan,
            BuiltAtUtc = @builtAt
          WHEN NOT MATCHED THEN INSERT
            (EmpID, BranchID, DayOfWeek, Revision, SourceFingerprint,
             BitmapBase64, FreeRangesJson, PlanJson, BuiltAtUtc)
          VALUES
            (@empId, @branchId, @dow, @revision, @fp,
             @bitmap, @ranges, @plan, @builtAt);
        `);
    },

    async delete(key) {
      await ensureWeeklyBaselineProjectionTables();
      const db = await getPool();
      const k = parseWeeklyBaselineKey(key);
      await db
        .request()
        .input('empId', sql.Int, k.employeeId)
        .input('branchId', sql.Int, k.branchId)
        .input('dow', sql.TinyInt, k.dayOfWeek)
        .query(`
          DELETE FROM dbo.TblBookingWeeklyBaselineProjection
          WHERE EmpID = @empId AND BranchID = @branchId AND DayOfWeek = @dow
        `);
    },

    async deleteMatching(filter) {
      await ensureWeeklyBaselineProjectionTables();
      const db = await getPool();
      const req = db.request();
      const where: string[] = [];
      if (filter.employeeId != null) {
        req.input('empId', sql.Int, filter.employeeId);
        where.push('EmpID = @empId');
      }
      if (filter.branchId != null) {
        req.input('branchId', sql.Int, filter.branchId);
        where.push('BranchID = @branchId');
      }
      if (filter.dayOfWeek != null) {
        req.input('dow', sql.TinyInt, filter.dayOfWeek);
        where.push('DayOfWeek = @dow');
      }
      if (!where.length) {
        const res = await req.query(`
          DELETE FROM dbo.TblBookingWeeklyBaselineProjection;
          SELECT @@ROWCOUNT AS n;
        `);
        return Number(res.recordset[0]?.n ?? 0);
      }
      const res = await req.query(`
        DELETE FROM dbo.TblBookingWeeklyBaselineProjection
        WHERE ${where.join(' AND ')};
        SELECT @@ROWCOUNT AS n;
      `);
      return Number(res.recordset[0]?.n ?? 0);
    },
  };
}
