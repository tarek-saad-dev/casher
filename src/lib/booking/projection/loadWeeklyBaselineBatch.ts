/**
 * Booking V2 B7A — batch weekly baseline SoT loader (no N+1).
 * One branch hours query + assignment batch + schedule batch (+ optional legacy).
 *
 * CRITICAL: each key.asOfDate is evaluated independently. Do NOT collapse to
 * range.to — a mid-range EffectiveFrom change must not leak into earlier days.
 */

import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  parseDayOfWeek,
  type DayOfWeek,
  type WeeklyBaselineSourceInputs,
} from '@/lib/booking/domain/WeeklyBaseline';
import { pickLatestEffectiveRow } from '@/lib/booking/projection/weeklyBaselineAsOf';

function fmtTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return null;
}

function ymdFromSqlDate(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = String(v.getUTCMonth() + 1).padStart(2, '0');
    const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return null;
}

export type WeeklyBaselineBatchKey = {
  employeeId: number;
  branchId: number;
  dayOfWeek: DayOfWeek | number;
  asOfDate: string;
};

/**
 * Batch-load weekly baseline inputs for many Emp×Branch×DOW×asOfDate cells.
 * Query budget ≈ 3–4 (branch hours, overlapping assignments, overlapping schedules).
 * Per-key effective state is resolved in memory from the overlapping window.
 */
export async function loadWeeklyBaselineSourceInputsBatch(
  keys: WeeklyBaselineBatchKey[],
): Promise<{
  byKey: Map<string, WeeklyBaselineSourceInputs>;
  queryCount: number;
}> {
  const byKey = new Map<string, WeeklyBaselineSourceInputs>();
  if (!keys.length) return { byKey, queryCount: 0 };

  const keyStr = (k: WeeklyBaselineBatchKey) =>
    `${k.employeeId}:${k.branchId}:${parseDayOfWeek(k.dayOfWeek)}:${k.asOfDate}`;

  const empIds = [...new Set(keys.map((k) => k.employeeId))];
  const branchIds = [...new Set(keys.map((k) => k.branchId))];
  const asOfDates = [...new Set(keys.map((k) => k.asOfDate))].sort();
  const rangeFrom = asOfDates[0]!;
  const rangeTo = asOfDates.at(-1)!;

  const db = await getPool();
  let queryCount = 0;

  const branchHours = new Map<
    number,
    { open: string | null; close: string | null; isOpen: boolean }
  >();
  {
    const req = db.request();
    branchIds.forEach((id, i) => req.input(`b${i}`, sql.Int, id));
    const res = await req.query(`
      SELECT BranchID, DefaultOpenTime, DefaultCloseTime, IsActive
      FROM dbo.TblBranch
      WHERE BranchID IN (${branchIds.map((_, i) => `@b${i}`).join(',')})
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      branchHours.set(Number(row.BranchID), {
        open: fmtTime(row.DefaultOpenTime),
        close: fmtTime(row.DefaultCloseTime),
        isOpen: row.IsActive === true || row.IsActive === 1,
      });
    }
  }

  type AssignRow = {
    empId: number;
    branchId: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    id: number;
  };
  const assignments: AssignRow[] = [];
  {
    const req = db
      .request()
      .input('from', sql.Date, rangeFrom)
      .input('to', sql.Date, rangeTo);
    empIds.forEach((id, i) => req.input(`e${i}`, sql.Int, id));
    branchIds.forEach((id, i) => req.input(`b${i}`, sql.Int, id));
    const res = await req.query(`
      SELECT ID, EmpID, BranchID, EffectiveFrom, EffectiveTo
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID IN (${empIds.map((_, i) => `@e${i}`).join(',')})
        AND BranchID IN (${branchIds.map((_, i) => `@b${i}`).join(',')})
        AND IsActive = 1
        AND EffectiveFrom <= @to
        AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      const effectiveFrom = ymdFromSqlDate(row.EffectiveFrom);
      if (!effectiveFrom) continue;
      assignments.push({
        empId: Number(row.EmpID),
        branchId: Number(row.BranchID),
        effectiveFrom,
        effectiveTo: ymdFromSqlDate(row.EffectiveTo),
        id: Number(row.ID) || 0,
      });
    }
  }

  type SchedRow = {
    empId: number;
    branchId: number;
    dayOfWeek: number;
    isWorking: boolean;
    start: string | null;
    end: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    id: number;
  };
  const schedules: SchedRow[] = [];
  {
    const dows = [...new Set(keys.map((k) => parseDayOfWeek(k.dayOfWeek)))];
    const req = db
      .request()
      .input('from', sql.Date, rangeFrom)
      .input('to', sql.Date, rangeTo);
    empIds.forEach((id, i) => req.input(`e${i}`, sql.Int, id));
    branchIds.forEach((id, i) => req.input(`b${i}`, sql.Int, id));
    dows.forEach((d, i) => req.input(`d${i}`, sql.TinyInt, d));
    const res = await req.query(`
      SELECT ScheduleID, EmpID, BranchID, DayOfWeek, IsWorking, StartTime, EndTime,
        EffectiveFrom, EffectiveTo
      FROM dbo.TblEmpBranchWorkSchedule
      WHERE EmpID IN (${empIds.map((_, i) => `@e${i}`).join(',')})
        AND BranchID IN (${branchIds.map((_, i) => `@b${i}`).join(',')})
        AND DayOfWeek IN (${dows.map((_, i) => `@d${i}`).join(',')})
        AND IsActive = 1
        AND EffectiveFrom <= @to
        AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      const effectiveFrom = ymdFromSqlDate(row.EffectiveFrom);
      if (!effectiveFrom) continue;
      schedules.push({
        empId: Number(row.EmpID),
        branchId: Number(row.BranchID),
        dayOfWeek: Number(row.DayOfWeek),
        isWorking: row.IsWorking === true || row.IsWorking === 1,
        start: fmtTime(row.StartTime),
        end: fmtTime(row.EndTime),
        effectiveFrom,
        effectiveTo: ymdFromSqlDate(row.EffectiveTo),
        id: Number(row.ScheduleID) || 0,
      });
    }
  }

  for (const key of keys) {
    const dow = parseDayOfWeek(key.dayOfWeek);
    const br = branchHours.get(key.branchId);
    const assignCandidates = assignments.filter(
      (a) => a.empId === key.employeeId && a.branchId === key.branchId,
    );
    const assigned = !!pickLatestEffectiveRow(assignCandidates, key.asOfDate);
    const schedCandidates = schedules.filter(
      (s) =>
        s.empId === key.employeeId &&
        s.branchId === key.branchId &&
        s.dayOfWeek === dow,
    );
    const sched = pickLatestEffectiveRow(schedCandidates, key.asOfDate);
    const open = br?.open ?? null;
    const close = br?.close ?? null;
    let isWorking = false;
    let employeeWindows: WeeklyBaselineSourceInputs['employeeWindows'] = [];
    if (assigned && sched?.isWorking && sched.start && sched.end) {
      isWorking = true;
      employeeWindows = [{ startHhmm: sched.start, endHhmm: sched.end }];
    }
    byKey.set(keyStr(key), {
      key: {
        employeeId: key.employeeId,
        branchId: key.branchId,
        dayOfWeek: dow,
      },
      employeeWindows,
      isEmployeeWorkingDay: isWorking,
      branchHours: open && close ? { startHhmm: open, endHhmm: close } : null,
      branchIsOpen: !!br?.isOpen,
    });
  }

  return { byKey, queryCount };
}

export function weeklyBaselineBatchKeyString(k: WeeklyBaselineBatchKey): string {
  return `${k.employeeId}:${k.branchId}:${parseDayOfWeek(k.dayOfWeek)}:${k.asOfDate}`;
}
