/**
 * Booking V2 B7A — batch weekly baseline SoT loader (no N+1).
 * One branch hours query + assignment batch + schedule batch (+ optional legacy).
 */

import 'server-only';
import { getPool, sql } from '@/lib/db';
import {
  parseDayOfWeek,
  type DayOfWeek,
  type WeeklyBaselineSourceInputs,
} from '@/lib/booking/domain/WeeklyBaseline';

function fmtTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
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
 * Batch-load weekly baseline inputs for many Emp×Branch×DOW cells.
 * Query budget ≈ 3–4 (branch hours by branch, assignments, schedules, optional legacy).
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
  const asOfDates = [...new Set(keys.map((k) => k.asOfDate))];
  // Use max asOf for effective window (conservative for same-week ranges).
  const asOfDate = asOfDates.sort().at(-1)!;

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

  const assigned = new Set<string>(); // emp:branch
  {
    const req = db.request().input('day', sql.Date, asOfDate);
    empIds.forEach((id, i) => req.input(`e${i}`, sql.Int, id));
    branchIds.forEach((id, i) => req.input(`b${i}`, sql.Int, id));
    const res = await req.query(`
      SELECT EmpID, BranchID
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID IN (${empIds.map((_, i) => `@e${i}`).join(',')})
        AND BranchID IN (${branchIds.map((_, i) => `@b${i}`).join(',')})
        AND IsActive = 1
        AND EffectiveFrom <= @day
        AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      assigned.add(`${Number(row.EmpID)}:${Number(row.BranchID)}`);
    }
  }

  type SchedCell = {
    isWorking: boolean;
    start: string | null;
    end: string | null;
  };
  const schedules = new Map<string, SchedCell>(); // emp:branch:dow
  {
    const dows = [...new Set(keys.map((k) => parseDayOfWeek(k.dayOfWeek)))];
    const req = db.request().input('day', sql.Date, asOfDate);
    empIds.forEach((id, i) => req.input(`e${i}`, sql.Int, id));
    branchIds.forEach((id, i) => req.input(`b${i}`, sql.Int, id));
    dows.forEach((d, i) => req.input(`d${i}`, sql.TinyInt, d));
    const res = await req.query(`
      SELECT EmpID, BranchID, DayOfWeek, IsWorking, StartTime, EndTime,
        ROW_NUMBER() OVER (
          PARTITION BY EmpID, BranchID, DayOfWeek
          ORDER BY EffectiveFrom DESC, ScheduleID DESC
        ) AS rn
      FROM dbo.TblEmpBranchWorkSchedule
      WHERE EmpID IN (${empIds.map((_, i) => `@e${i}`).join(',')})
        AND BranchID IN (${branchIds.map((_, i) => `@b${i}`).join(',')})
        AND DayOfWeek IN (${dows.map((_, i) => `@d${i}`).join(',')})
        AND IsActive = 1
        AND EffectiveFrom <= @day
        AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
    `);
    queryCount += 1;
    for (const row of res.recordset as Array<Record<string, unknown>>) {
      if (Number(row.rn) !== 1) continue;
      const k = `${Number(row.EmpID)}:${Number(row.BranchID)}:${Number(row.DayOfWeek)}`;
      schedules.set(k, {
        isWorking: row.IsWorking === true || row.IsWorking === 1,
        start: fmtTime(row.StartTime),
        end: fmtTime(row.EndTime),
      });
    }
  }

  for (const key of keys) {
    const dow = parseDayOfWeek(key.dayOfWeek);
    const br = branchHours.get(key.branchId);
    const isAssigned = assigned.has(`${key.employeeId}:${key.branchId}`);
    const sched = schedules.get(`${key.employeeId}:${key.branchId}:${dow}`);
    const open = br?.open ?? null;
    const close = br?.close ?? null;
    let isWorking = false;
    let employeeWindows: WeeklyBaselineSourceInputs['employeeWindows'] = [];
    if (isAssigned && sched?.isWorking && sched.start && sched.end) {
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
