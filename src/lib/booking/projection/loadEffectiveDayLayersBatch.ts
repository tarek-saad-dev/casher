/**
 * Booking V2 B7A — batch effective-day layer loader (no per-emp N+1 fan-out).
 * Targets one branch × many emps × one businessDate (extendable).
 */

import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { EffectiveDayLayerInputs } from '@/lib/booking/domain/EffectiveDay';
import { parseBusinessDate } from '@/lib/booking/domain/BusinessDate';

function fmtTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return null;
}

function emptyLayers(): EffectiveDayLayerInputs {
  return { blockRanges: [], dailyAdjustments: [] };
}

/**
 * Batch load date layers for many employees at one branch on one BusinessDate.
 * Query budget ≈ 5–6 (attendance, transfer, overrides, adjustments, exceptional, freelance).
 */
export async function loadEffectiveDayLayerInputsBatch(args: {
  employeeIds: number[];
  branchId: number;
  businessDate: string;
}): Promise<{
  byEmpId: Map<number, EffectiveDayLayerInputs>;
  queryCount: number;
}> {
  const businessDate = String(parseBusinessDate(args.businessDate));
  const empIds = [
    ...new Set(args.employeeIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const byEmpId = new Map<number, EffectiveDayLayerInputs>();
  for (const id of empIds) byEmpId.set(id, emptyLayers());
  if (!empIds.length) return { byEmpId, queryCount: 0 };

  const db = await getPool();
  let queryCount = 0;
  const empList = () => empIds.map((_, i) => `@e${i}`).join(',');
  const bindEmps = (req: ReturnType<typeof db.request>) => {
    empIds.forEach((id, i) => req.input(`e${i}`, sql.Int, id));
    return req;
  };

  // Attendance
  try {
    const req = bindEmps(db.request().input('day', sql.Date, businessDate));
    const res = await req.query(`
      SELECT EmpID, Status,
        ROW_NUMBER() OVER (PARTITION BY EmpID ORDER BY AttendanceID DESC) AS rn
      FROM dbo.TblEmpAttendance
      WHERE EmpID IN (${empList()}) AND WorkDate = @day
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      if (Number(row.rn) !== 1) continue;
      if (String(row.Status).toLowerCase() === 'absent') {
        byEmpId.get(Number(row.EmpID))!.absent = true;
      }
    }
  } catch {
    /* optional */
  }

  // Transfers
  try {
    const req = bindEmps(
      db.request().input('day', sql.Date, businessDate).input('branchId', sql.Int, args.branchId),
    );
    const res = await req.query(`
      SELECT EmpID, FromBranchID, ToBranchID, StartTime, EndTime
      FROM dbo.TblEmpTemporaryBranchTransfer
      WHERE EmpID IN (${empList()}) AND WorkDate = @day AND IsActive = 1
        AND (FromBranchID = @branchId OR ToBranchID = @branchId)
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      const empId = Number(row.EmpID);
      const layers = byEmpId.get(empId)!;
      if (Number(row.FromBranchID) === args.branchId) {
        layers.assignmentDayRule = { kind: 'transferred_away' };
      }
      if (Number(row.ToBranchID) === args.branchId) {
        const start = fmtTime(row.StartTime);
        const end = fmtTime(row.EndTime);
        layers.assignmentDayRule = {
          kind: 'transferred_in',
          windows: start && end ? [{ startHhmm: start, endHhmm: end }] : [],
        };
      }
    }
  } catch {
    /* optional */
  }

  // Overrides
  try {
    const req = bindEmps(db.request().input('day', sql.Date, businessDate));
    const res = await req.query(`
      SELECT EmpID, Type, StartTime, EndTime
      FROM dbo.TblEmpScheduleOverrides
      WHERE EmpID IN (${empList()}) AND OverrideDate = @day AND IsActive = 1
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      const layers = byEmpId.get(Number(row.EmpID))!;
      const type = String(row.Type);
      const start = fmtTime(row.StartTime);
      const end = fmtTime(row.EndTime);
      if (type === 'day_off') layers.closeDay = true;
      if (type === 'late_start' && start) layers.lateStartHhmm = start;
      if (type === 'early_leave' && end) layers.earlyLeaveHhmm = end;
      if (type === 'block_range' && start && end) {
        layers.blockRanges = layers.blockRanges ?? [];
        layers.blockRanges.push({ startHhmm: start, endHhmm: end });
      }
      if (type === 'custom_hours' && start && end) {
        layers.presentOnDayOff = { startHhmm: start, endHhmm: end };
      }
    }
  } catch {
    /* optional */
  }

  // Daily adjustments
  try {
    const req = bindEmps(
      db.request().input('day', sql.Date, businessDate).input('branchId', sql.Int, args.branchId),
    );
    const res = await req.query(`
      SELECT EmpID, AdjustmentType, WindowsJson
      FROM dbo.TblEmpDailyAdjustment
      WHERE EmpID IN (${empList()}) AND BranchID = @branchId AND BusinessDate = @day
        AND IsActive = 1
      ORDER BY CreatedAt ASC, AdjustmentID ASC
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      const layers = byEmpId.get(Number(row.EmpID))!;
      layers.dailyAdjustments = layers.dailyAdjustments ?? [];
      const type = String(row.AdjustmentType);
      let windows: Array<{ startHhmm: string; endHhmm: string; endDayOffset?: 0 | 1 }> = [];
      if (row.WindowsJson) {
        try {
          const parsed = JSON.parse(String(row.WindowsJson)) as Array<{
            start?: string;
            end?: string;
            endDayOffset?: 0 | 1;
          }>;
          windows = parsed
            .filter((w) => w.start && w.end)
            .map((w) => ({
              startHhmm: String(w.start).slice(0, 5),
              endHhmm: String(w.end).slice(0, 5),
              endDayOffset: w.endDayOffset,
            }));
        } catch {
          windows = [];
        }
      }
      if (type === 'CLOSE_DAY') layers.dailyAdjustments.push({ type: 'CLOSE_DAY' });
      else if (type === 'REPLACE_WINDOWS')
        layers.dailyAdjustments.push({ type: 'REPLACE_WINDOWS', windows });
      else if (type === 'ADD_WINDOW')
        layers.dailyAdjustments.push({ type: 'ADD_WINDOW', windows });
      else if (type === 'BLOCK_WINDOW')
        layers.dailyAdjustments.push({ type: 'BLOCK_WINDOW', windows });
    }
  } catch {
    /* optional */
  }

  // Branch exceptional (once)
  try {
    const res = await db
      .request()
      .input('branchId', sql.Int, args.branchId)
      .input('day', sql.Date, businessDate)
      .query(`
        SELECT TOP 1 IsClosed, OpenTime, CloseTime, EndDayOffset
        FROM dbo.TblBranchExceptionalHours
        WHERE BranchID = @branchId AND BusinessDate = @day AND IsActive = 1
        ORDER BY ExceptionID DESC
      `);
    queryCount += 1;
    const row = res.recordset[0] as
      | {
          IsClosed: boolean | number;
          OpenTime: unknown;
          CloseTime: unknown;
          EndDayOffset: number | null;
        }
      | undefined;
    if (row) {
      const ex = {
        isClosed: !!(row.IsClosed === true || row.IsClosed === 1),
        openHhmm: fmtTime(row.OpenTime),
        closeHhmm: fmtTime(row.CloseTime),
        endDayOffset: (row.EndDayOffset === 1 ? 1 : 0) as 0 | 1,
      };
      for (const layers of byEmpId.values()) layers.branchException = { ...ex };
    }
  } catch {
    /* optional */
  }

  return { byEmpId, queryCount };
}

function ymdFromSqlDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

/**
 * Range preload: one branch × many emps × [from,to] with BETWEEN (no per-date N+1).
 * Same layer semantics as the single-date loader.
 */
export async function loadEffectiveDayLayerInputsRangeBatch(args: {
  employeeIds: number[];
  branchId: number;
  from: string;
  to: string;
}): Promise<{
  /** `${empId}:${businessDate}` → layers */
  byEmpDate: Map<string, EffectiveDayLayerInputs>;
  queryCount: number;
}> {
  const from = String(parseBusinessDate(args.from));
  const to = String(parseBusinessDate(args.to));
  const empIds = [
    ...new Set(args.employeeIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const byEmpDate = new Map<string, EffectiveDayLayerInputs>();
  if (!empIds.length || from > to) return { byEmpDate, queryCount: 0 };

  const ensure = (empId: number, date: string) => {
    const k = `${empId}:${date}`;
    let layers = byEmpDate.get(k);
    if (!layers) {
      layers = emptyLayers();
      byEmpDate.set(k, layers);
    }
    return layers;
  };

  const db = await getPool();
  let queryCount = 0;
  const empList = () => empIds.map((_, i) => `@e${i}`).join(',');
  const bindEmps = (req: ReturnType<typeof db.request>) => {
    empIds.forEach((id, i) => req.input(`e${i}`, sql.Int, id));
    return req;
  };

  try {
    const req = bindEmps(
      db.request().input('from', sql.Date, from).input('to', sql.Date, to),
    );
    const res = await req.query(`
      SELECT EmpID, WorkDate, Status,
        ROW_NUMBER() OVER (PARTITION BY EmpID, WorkDate ORDER BY AttendanceID DESC) AS rn
      FROM dbo.TblEmpAttendance
      WHERE EmpID IN (${empList()}) AND WorkDate BETWEEN @from AND @to
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      if (Number(row.rn) !== 1) continue;
      if (String(row.Status).toLowerCase() === 'absent') {
        ensure(Number(row.EmpID), ymdFromSqlDate(row.WorkDate)).absent = true;
      }
    }
  } catch {
    /* optional */
  }

  try {
    const req = bindEmps(
      db
        .request()
        .input('from', sql.Date, from)
        .input('to', sql.Date, to)
        .input('branchId', sql.Int, args.branchId),
    );
    const res = await req.query(`
      SELECT EmpID, WorkDate, FromBranchID, ToBranchID, StartTime, EndTime
      FROM dbo.TblEmpTemporaryBranchTransfer
      WHERE EmpID IN (${empList()}) AND WorkDate BETWEEN @from AND @to AND IsActive = 1
        AND (FromBranchID = @branchId OR ToBranchID = @branchId)
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      const date = ymdFromSqlDate(row.WorkDate);
      const layers = ensure(Number(row.EmpID), date);
      if (Number(row.FromBranchID) === args.branchId) {
        layers.assignmentDayRule = { kind: 'transferred_away' };
      }
      if (Number(row.ToBranchID) === args.branchId) {
        const start = fmtTime(row.StartTime);
        const end = fmtTime(row.EndTime);
        layers.assignmentDayRule = {
          kind: 'transferred_in',
          windows: start && end ? [{ startHhmm: start, endHhmm: end }] : [],
        };
      }
    }
  } catch {
    /* optional */
  }

  try {
    const req = bindEmps(
      db.request().input('from', sql.Date, from).input('to', sql.Date, to),
    );
    const res = await req.query(`
      SELECT EmpID, OverrideDate, Type, StartTime, EndTime
      FROM dbo.TblEmpScheduleOverrides
      WHERE EmpID IN (${empList()}) AND OverrideDate BETWEEN @from AND @to AND IsActive = 1
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      const layers = ensure(Number(row.EmpID), ymdFromSqlDate(row.OverrideDate));
      const type = String(row.Type);
      const start = fmtTime(row.StartTime);
      const end = fmtTime(row.EndTime);
      if (type === 'day_off') layers.closeDay = true;
      if (type === 'late_start' && start) layers.lateStartHhmm = start;
      if (type === 'early_leave' && end) layers.earlyLeaveHhmm = end;
      if (type === 'block_range' && start && end) {
        layers.blockRanges = layers.blockRanges ?? [];
        layers.blockRanges.push({ startHhmm: start, endHhmm: end });
      }
      if (type === 'custom_hours' && start && end) {
        layers.presentOnDayOff = { startHhmm: start, endHhmm: end };
      }
    }
  } catch {
    /* optional */
  }

  try {
    const req = bindEmps(
      db
        .request()
        .input('from', sql.Date, from)
        .input('to', sql.Date, to)
        .input('branchId', sql.Int, args.branchId),
    );
    const res = await req.query(`
      SELECT EmpID, BusinessDate, AdjustmentType, WindowsJson
      FROM dbo.TblEmpDailyAdjustment
      WHERE EmpID IN (${empList()}) AND BranchID = @branchId
        AND BusinessDate BETWEEN @from AND @to AND IsActive = 1
      ORDER BY CreatedAt ASC, AdjustmentID ASC
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      const layers = ensure(Number(row.EmpID), ymdFromSqlDate(row.BusinessDate));
      layers.dailyAdjustments = layers.dailyAdjustments ?? [];
      const type = String(row.AdjustmentType);
      let windows: Array<{ startHhmm: string; endHhmm: string; endDayOffset?: 0 | 1 }> = [];
      if (row.WindowsJson) {
        try {
          const parsed = JSON.parse(String(row.WindowsJson)) as Array<{
            start?: string;
            end?: string;
            endDayOffset?: 0 | 1;
          }>;
          windows = parsed
            .filter((w) => w.start && w.end)
            .map((w) => ({
              startHhmm: String(w.start).slice(0, 5),
              endHhmm: String(w.end).slice(0, 5),
              endDayOffset: w.endDayOffset,
            }));
        } catch {
          windows = [];
        }
      }
      if (type === 'CLOSE_DAY') layers.dailyAdjustments.push({ type: 'CLOSE_DAY' });
      else if (type === 'REPLACE_WINDOWS')
        layers.dailyAdjustments.push({ type: 'REPLACE_WINDOWS', windows });
      else if (type === 'ADD_WINDOW')
        layers.dailyAdjustments.push({ type: 'ADD_WINDOW', windows });
      else if (type === 'BLOCK_WINDOW')
        layers.dailyAdjustments.push({ type: 'BLOCK_WINDOW', windows });
    }
  } catch {
    /* optional */
  }

  try {
    const res = await db
      .request()
      .input('branchId', sql.Int, args.branchId)
      .input('from', sql.Date, from)
      .input('to', sql.Date, to)
      .query(`
        SELECT BusinessDate, IsClosed, OpenTime, CloseTime, EndDayOffset,
          ROW_NUMBER() OVER (
            PARTITION BY BusinessDate ORDER BY ExceptionID DESC
          ) AS rn
        FROM dbo.TblBranchExceptionalHours
        WHERE BranchID = @branchId AND BusinessDate BETWEEN @from AND @to AND IsActive = 1
      `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      if (Number(row.rn) !== 1) continue;
      const date = ymdFromSqlDate(row.BusinessDate);
      const ex = {
        isClosed: !!(row.IsClosed === true || row.IsClosed === 1),
        openHhmm: fmtTime(row.OpenTime),
        closeHhmm: fmtTime(row.CloseTime),
        endDayOffset: (row.EndDayOffset === 1 ? 1 : 0) as 0 | 1,
      };
      for (const empId of empIds) {
        ensure(empId, date).branchException = { ...ex };
      }
    }
  } catch {
    /* optional */
  }

  return { byEmpDate, queryCount };
}
