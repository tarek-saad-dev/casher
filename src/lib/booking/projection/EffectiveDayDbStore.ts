/**
 * Optional SQL adapter for Effective Day projections.
 * Assumes TblBookingEffectiveDayProjection exists (deploy-time migration).
 * NO ensure/create-table on the hot path.
 */

import 'server-only';
import { getPool, sql } from '@/lib/db';
import { AvailabilityBitmap } from '@/lib/booking/domain/AvailabilityBitmap';
import {
  parseEffectiveDayKey,
  type EffectiveDayChangeFlag,
  type EffectiveDayKey,
  type EffectiveDayProjectionRecord,
} from '@/lib/booking/domain/EffectiveDay';
import type { EffectiveDayStore } from '@/lib/booking/projection/EffectiveDayStore';

function serialize(record: EffectiveDayProjectionRecord) {
  return {
    empId: record.key.employeeId,
    branchId: record.key.branchId,
    businessDate: String(record.key.businessDate),
    sourceRevision: record.sourceRevision,
    projectionRevision: record.projectionRevision,
    changeMaskJson: JSON.stringify(record.changeMask),
    reusedBaseline: record.reusedBaseline ? 1 : 0,
    bitmapBase64: record.bitmap ? record.bitmap.toBase64() : null,
    freeRangesJson: JSON.stringify(record.freeRanges),
    isWorking: record.isWorking ? 1 : 0,
    sourceFingerprint: record.sourceFingerprint,
    baselineFingerprint: record.baselineFingerprint,
    builtAtUtc: new Date(record.builtAtMs),
  };
}

function deserialize(row: Record<string, unknown>): EffectiveDayProjectionRecord {
  const key = parseEffectiveDayKey({
    employeeId: Number(row.EmpID),
    branchId: Number(row.BranchID),
    businessDate: String(row.BusinessDate).slice(0, 10),
  });
  const reusedBaseline = !!(row.ReusedBaseline === true || row.ReusedBaseline === 1);
  const bitmap =
    !reusedBaseline && row.BitmapBase64
      ? AvailabilityBitmap.fromBase64(String(row.BitmapBase64))
      : null;
  return {
    key,
    sourceRevision: Number(row.SourceRevision),
    projectionRevision: Number(row.ProjectionRevision),
    changeMask: JSON.parse(String(row.ChangeMaskJson)) as EffectiveDayChangeFlag[],
    reusedBaseline,
    bitmap,
    freeRanges: JSON.parse(String(row.FreeRangesJson)) as EffectiveDayProjectionRecord['freeRanges'],
    isWorking: !!(row.IsWorking === true || row.IsWorking === 1),
    sourceFingerprint: String(row.SourceFingerprint),
    baselineFingerprint: String(row.BaselineFingerprint),
    builtAtMs:
      row.BuiltAtUtc instanceof Date
        ? row.BuiltAtUtc.getTime()
        : new Date(String(row.BuiltAtUtc)).getTime(),
  };
}

export function createEffectiveDayDbStore(): EffectiveDayStore {
  return {
    async get(key) {
      const db = await getPool();
      const k = parseEffectiveDayKey(key);
      const res = await db
        .request()
        .input('empId', sql.Int, k.employeeId)
        .input('branchId', sql.Int, k.branchId)
        .input('day', sql.Date, String(k.businessDate))
        .query(`
          SELECT EmpID, BranchID, BusinessDate, SourceRevision, ProjectionRevision,
                 ChangeMaskJson, ReusedBaseline, BitmapBase64, FreeRangesJson,
                 IsWorking, SourceFingerprint, BaselineFingerprint, BuiltAtUtc
          FROM dbo.TblBookingEffectiveDayProjection
          WHERE EmpID = @empId AND BranchID = @branchId AND BusinessDate = @day
        `);
      const row = res.recordset[0];
      if (!row) return null;
      return deserialize(row);
    },

    async put(record) {
      if (record.reusedBaseline) {
        await this.delete(record.key);
        return;
      }
      const db = await getPool();
      const s = serialize(record);
      await db
        .request()
        .input('empId', sql.Int, s.empId)
        .input('branchId', sql.Int, s.branchId)
        .input('day', sql.Date, s.businessDate)
        .input('srcRev', sql.BigInt, s.sourceRevision)
        .input('projRev', sql.BigInt, s.projectionRevision)
        .input('changeMask', sql.NVarChar(sql.MAX), s.changeMaskJson)
        .input('reused', sql.Bit, s.reusedBaseline)
        .input('bitmap', sql.VarChar(256), s.bitmapBase64)
        .input('ranges', sql.NVarChar(sql.MAX), s.freeRangesJson)
        .input('working', sql.Bit, s.isWorking)
        .input('fp', sql.VarChar(64), s.sourceFingerprint)
        .input('bfp', sql.VarChar(64), s.baselineFingerprint)
        .input('builtAt', sql.DateTime2, s.builtAtUtc)
        .query(`
          MERGE dbo.TblBookingEffectiveDayProjection AS t
          USING (SELECT @empId AS EmpID, @branchId AS BranchID, @day AS BusinessDate) AS s
          ON t.EmpID = s.EmpID AND t.BranchID = s.BranchID AND t.BusinessDate = s.BusinessDate
          WHEN MATCHED THEN UPDATE SET
            SourceRevision = @srcRev,
            ProjectionRevision = @projRev,
            ChangeMaskJson = @changeMask,
            ReusedBaseline = @reused,
            BitmapBase64 = @bitmap,
            FreeRangesJson = @ranges,
            IsWorking = @working,
            SourceFingerprint = @fp,
            BaselineFingerprint = @bfp,
            BuiltAtUtc = @builtAt
          WHEN NOT MATCHED THEN INSERT
            (EmpID, BranchID, BusinessDate, SourceRevision, ProjectionRevision,
             ChangeMaskJson, ReusedBaseline, BitmapBase64, FreeRangesJson,
             IsWorking, SourceFingerprint, BaselineFingerprint, BuiltAtUtc)
          VALUES
            (@empId, @branchId, @day, @srcRev, @projRev,
             @changeMask, @reused, @bitmap, @ranges,
             @working, @fp, @bfp, @builtAt);
        `);
    },

    async delete(key) {
      const db = await getPool();
      const k = parseEffectiveDayKey(key);
      await db
        .request()
        .input('empId', sql.Int, k.employeeId)
        .input('branchId', sql.Int, k.branchId)
        .input('day', sql.Date, String(k.businessDate))
        .query(`
          DELETE FROM dbo.TblBookingEffectiveDayProjection
          WHERE EmpID = @empId AND BranchID = @branchId AND BusinessDate = @day
        `);
    },

    async deleteMatching(filter) {
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
      if (filter.businessDate != null) {
        req.input('day', sql.Date, filter.businessDate);
        where.push('BusinessDate = @day');
      }
      if (!where.length) {
        const res = await req.query(`
          DELETE FROM dbo.TblBookingEffectiveDayProjection;
          SELECT @@ROWCOUNT AS n;
        `);
        return Number(res.recordset[0]?.n ?? 0);
      }
      const res = await req.query(`
        DELETE FROM dbo.TblBookingEffectiveDayProjection
        WHERE ${where.join(' AND ')};
        SELECT @@ROWCOUNT AS n;
      `);
      return Number(res.recordset[0]?.n ?? 0);
    },
  };
}
