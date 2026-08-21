/**
 * Booking V2 B8.5 — SQL-backed Emp×BusinessDate revision counters (cross-instance).
 * One lightweight batch SELECT for 14-day ranges. Not a SoT for occupancy.
 */

import { getPool, sql } from '@/lib/db';
import {
  deriveAvailabilityRevision,
  type AvailabilityRevisionParts,
} from '@/lib/booking/projection/AvailabilityRevision';

export type RevisionLayer =
  | 'effectiveWork'
  | 'booking'
  | 'hold'
  | 'queue';

export function revisionMapKey(employeeId: number, businessDate: string): string {
  return `${employeeId}:${businessDate}`;
}

const EMPTY: AvailabilityRevisionParts = {
  effectiveWorkRevision: 0,
  bookingOccupancyRevision: 0,
  holdOccupancyRevision: 0,
  queueOccupancyRevision: 0,
};

export function normalizeSqlBusinessDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = String(value ?? '');
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return raw.slice(0, 10);
}

export type AvailabilityRevisionSqlStore = {
  /** 1 query for all EmpIDs × [from,to]. Missing rows → zeros. */
  loadBatch(args: {
    employeeIds: number[];
    fromBusinessDate: string;
    toBusinessDate: string;
  }): Promise<{
    byKey: Map<string, AvailabilityRevisionParts>;
    queryCount: number;
    dbMs: number;
  }>;
  bump(args: {
    employeeId: number;
    businessDate: string;
    layer: RevisionLayer;
  }): Promise<AvailabilityRevisionParts>;
  bumpMany(args: {
    employeeId: number;
    businessDates: string[];
    layer: RevisionLayer;
  }): Promise<void>;
};

function colFor(layer: RevisionLayer): string {
  switch (layer) {
    case 'effectiveWork':
      return 'EffectiveWorkRevision';
    case 'booking':
      return 'BookingOccupancyRevision';
    case 'hold':
      return 'HoldOccupancyRevision';
    case 'queue':
      return 'QueueOccupancyRevision';
  }
}

function rowToParts(r: Record<string, unknown>): AvailabilityRevisionParts {
  return {
    effectiveWorkRevision: Number(r.EffectiveWorkRevision ?? 0),
    bookingOccupancyRevision: Number(r.BookingOccupancyRevision ?? 0),
    holdOccupancyRevision: Number(r.HoldOccupancyRevision ?? 0),
    queueOccupancyRevision: Number(r.QueueOccupancyRevision ?? 0),
  };
}

let tableMissing = false;

export function createAvailabilityRevisionSqlStore(): AvailabilityRevisionSqlStore {
  return {
    async loadBatch(args) {
      const empIds = [
        ...new Set(
          args.employeeIds.filter((id) => Number.isInteger(id) && id > 0),
        ),
      ];
      const byKey = new Map<string, AvailabilityRevisionParts>();
      if (!empIds.length || tableMissing) {
        return { byKey, queryCount: 0, dbMs: 0 };
      }
      const t0 = performance.now();
      try {
        const db = await getPool();
        const req = db
          .request()
          .input('from', sql.Date, args.fromBusinessDate)
          .input('to', sql.Date, args.toBusinessDate);
        empIds.forEach((id, i) => req.input(`e${i}`, sql.Int, id));
        const res = await req.query(`
          SELECT EmpID, BusinessDate,
                 EffectiveWorkRevision, BookingOccupancyRevision,
                 HoldOccupancyRevision, QueueOccupancyRevision
          FROM dbo.TblBookingAvailabilityRevision
          WHERE EmpID IN (${empIds.map((_, i) => `@e${i}`).join(',')})
            AND BusinessDate >= @from AND BusinessDate <= @to
        `);
        for (const row of res.recordset as Record<string, unknown>[]) {
          const empId = Number(row.EmpID);
          const date = normalizeSqlBusinessDate(row.BusinessDate);
          byKey.set(revisionMapKey(empId, date), rowToParts(row));
        }
        return {
          byKey,
          queryCount: 1,
          dbMs: performance.now() - t0,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/TblBookingAvailabilityRevision|Invalid object name/i.test(msg)) {
          tableMissing = true;
        }
        return { byKey, queryCount: 0, dbMs: performance.now() - t0 };
      }
    },

    async bump(args) {
      if (tableMissing) return { ...EMPTY };
      const col = colFor(args.layer);
      try {
        const db = await getPool();
        const res = await db
          .request()
          .input('empId', sql.Int, args.employeeId)
          .input('date', sql.Date, args.businessDate)
          .query(`
            MERGE dbo.TblBookingAvailabilityRevision AS t
            USING (SELECT @empId AS EmpID, @date AS BusinessDate) AS s
            ON t.EmpID = s.EmpID AND t.BusinessDate = s.BusinessDate
            WHEN MATCHED THEN
              UPDATE SET ${col} = t.${col} + 1, UpdatedAtUtc = SYSUTCDATETIME()
            WHEN NOT MATCHED THEN
              INSERT (EmpID, BusinessDate, ${col})
              VALUES (s.EmpID, s.BusinessDate, 1)
            OUTPUT
              INSERTED.EffectiveWorkRevision,
              INSERTED.BookingOccupancyRevision,
              INSERTED.HoldOccupancyRevision,
              INSERTED.QueueOccupancyRevision;
          `);
        const row = res.recordset[0] as Record<string, unknown> | undefined;
        return row ? rowToParts(row) : { ...EMPTY };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/TblBookingAvailabilityRevision|Invalid object name/i.test(msg)) {
          tableMissing = true;
        }
        return { ...EMPTY };
      }
    },

    async bumpMany(args) {
      for (const d of args.businessDates) {
        await this.bump({
          employeeId: args.employeeId,
          businessDate: d,
          layer: args.layer,
        });
      }
    },
  };
}

let singleton: AvailabilityRevisionSqlStore | null = null;

export function getAvailabilityRevisionSqlStore(): AvailabilityRevisionSqlStore {
  if (!singleton) singleton = createAvailabilityRevisionSqlStore();
  return singleton;
}

export function __resetAvailabilityRevisionSqlStoreForTests(): void {
  singleton = null;
  tableMissing = false;
}

export function partsToRevisionToken(parts: AvailabilityRevisionParts): string {
  return deriveAvailabilityRevision(parts);
}

export function getPartsOrEmpty(
  map: Map<string, AvailabilityRevisionParts>,
  employeeId: number,
  businessDate: string,
): AvailabilityRevisionParts {
  return map.get(revisionMapKey(employeeId, businessDate)) ?? { ...EMPTY };
}
