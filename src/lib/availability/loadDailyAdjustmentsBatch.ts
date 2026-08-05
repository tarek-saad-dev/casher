/**
 * Phase 3A — Batch loader for active daily adjustments.
 */

import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import {
  type DailyAdjustmentSource,
  type DailyAdjustmentType,
  type EmployeeDailyAdjustment,
  materializeAdjustmentWindow,
} from '@/lib/availability/dailyAdjustments';
import { ensureDailyAdjustmentTables } from '@/lib/availability/ensureDailyAdjustmentTables';
import { SALON_TZ } from '@/lib/businessDate';

type DbLike = Awaited<ReturnType<typeof getPool>> | Transaction;

function asDb(db: DbLike): Awaited<ReturnType<typeof getPool>> {
  return db as Awaited<ReturnType<typeof getPool>>;
}

function normalizeEmpIds(empIds: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of empIds) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function sqlTimeToHhmm(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    const h = String(val.getUTCHours()).padStart(2, '0');
    const m = String(val.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  if (typeof val === 'string') {
    const m = val.trim().match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  return null;
}

/**
 * Load active (IsActive=1, CancelledAt IS NULL) adjustments for empIds on a branch/date.
 * Two queries (headers + windows). Sequential when transaction is supplied.
 */
export async function loadDailyAdjustmentsBatch(args: {
  branchId: number | null;
  empIds: number[];
  businessDate: string;
  transaction?: Transaction;
  timezone?: string;
}): Promise<Map<number, EmployeeDailyAdjustment[]>> {
  const out = new Map<number, EmployeeDailyAdjustment[]>();
  const empIds = normalizeEmpIds(args.empIds);
  if (!empIds.length || args.branchId == null || !(args.branchId > 0)) {
    return out;
  }

  const timezone = args.timezone || SALON_TZ;
  const onTx = !!args.transaction;

  // DDL ensure never on TX — skip if TX supplied; caller should ensure outside write TX.
  if (!onTx) {
    const ok = await ensureDailyAdjustmentTables();
    if (!ok) return out;
  }

  const db = asDb(args.transaction ?? (await getPool()));
  const idList = empIds.join(',');

  try {
    const headerSql = `
      SELECT
        AdjustmentID, BranchID, EmpID,
        CONVERT(VARCHAR(10), BusinessDate, 120) AS BusinessDate,
        AdjustmentType, ReasonCode, ReasonText, Source,
        CreatedBy,
        CONVERT(VARCHAR(33), CreatedAt, 127) AS CreatedAt,
        Version
      FROM dbo.TblEmpDailyAdjustment
      WHERE BranchID = @branchId
        AND BusinessDate = @businessDate
        AND IsActive = 1
        AND CancelledAt IS NULL
        AND EmpID IN (${idList})
      ORDER BY EmpID, CreatedAt ASC, AdjustmentID ASC
    `;

    const headerRes = await db
      .request()
      .input('branchId', sql.Int, args.branchId)
      .input('businessDate', sql.Date, args.businessDate)
      .query(headerSql);

    const headers = headerRes.recordset as Array<Record<string, unknown>>;
    if (!headers.length) return out;

    const adjIds = headers.map((h) => Number(h.AdjustmentID)).filter((id) => id > 0);
    if (!adjIds.length) return out;

    const winSql = `
      SELECT
        AdjustmentWindowID, AdjustmentID,
        StartTime, EndTime, EndDayOffset, SortOrder
      FROM dbo.TblEmpDailyAdjustmentWindow
      WHERE AdjustmentID IN (${adjIds.join(',')})
      ORDER BY AdjustmentID, SortOrder ASC, AdjustmentWindowID ASC
    `;

    const winRes = onTx
      ? await db.request().query(winSql)
      : await db.request().query(winSql);

    const windowsByAdj = new Map<number, EmployeeDailyAdjustment['windows']>();
    for (const row of winRes.recordset as Array<Record<string, unknown>>) {
      const adjId = Number(row.AdjustmentID);
      const start = sqlTimeToHhmm(row.StartTime);
      const end = sqlTimeToHhmm(row.EndTime);
      if (!start || !end) continue;
      const endDayOffset = Number(row.EndDayOffset) === 1 ? 1 : 0;
      const mat = materializeAdjustmentWindow(
        args.businessDate,
        { start, end, endDayOffset: endDayOffset as 0 | 1 },
        timezone,
      );
      if (!mat) continue;
      const list = windowsByAdj.get(adjId) ?? [];
      list.push(mat);
      windowsByAdj.set(adjId, list);
    }

    for (const h of headers) {
      const empId = Number(h.EmpID);
      const adjustmentId = Number(h.AdjustmentID);
      const adj: EmployeeDailyAdjustment = {
        adjustmentId,
        branchId: Number(h.BranchID),
        employeeId: empId,
        businessDate: String(h.BusinessDate).slice(0, 10),
        adjustmentType: String(h.AdjustmentType) as DailyAdjustmentType,
        reasonCode: (h.ReasonCode as string) ?? null,
        reasonText: (h.ReasonText as string) ?? null,
        source: String(h.Source) as DailyAdjustmentSource,
        windows: windowsByAdj.get(adjustmentId) ?? [],
        createdBy: h.CreatedBy != null ? Number(h.CreatedBy) : null,
        createdAt: String(h.CreatedAt),
        version: Number(h.Version) || 1,
      };
      const list = out.get(empId) ?? [];
      list.push(adj);
      out.set(empId, list);
    }
  } catch {
    /* optional tables during rollout */
  }

  return out;
}
