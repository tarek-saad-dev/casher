/**
 * Shared weekly working-window batch loader (branch-first, legacy fallback).
 * Used by bookingAvailabilityEngine and resolveEmployeeDayPlan.
 *
 * When branchId+workDate are provided: branch-scoped schedules + temporary transfers.
 * When branchId is omitted: branch schedules via active assignment (same as getBarberWorkingWindow),
 * then legacy TblEmpWorkSchedule for anyone still missing.
 */

import { getPool, sql } from '@/lib/db';

function fmtScheduleTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return null;
}

export type WorkingWindowRow = {
  startTime: string | null;
  endTime: string | null;
  isWorkingDay: boolean;
  source?: 'BRANCH_WEEKLY' | 'LEGACY_WEEKLY' | 'TEMPORARY_TRANSFER';
};

export type WorkingElsewhereRow = {
  branchId: number;
  branchCode: string;
  branchName: string;
  startTime: string | null;
  endTime: string | null;
};

/**
 * For employees not working on the active branch today, find where they *are*
 * scheduled (same calendar day-of-week). Used by workforce UI only.
 */
export async function loadWorkingElsewhereBatch(
  db: Awaited<ReturnType<typeof getPool>>,
  empIds: number[],
  dayOfWeek: number,
  activeBranchId: number,
  workDate: string,
): Promise<Map<number, WorkingElsewhereRow>> {
  const map = new Map<number, WorkingElsewhereRow>();
  if (!empIds.length) return map;

  try {
    const { ensureEmpBranchWorkScheduleTable } = await import(
      '@/lib/hr/empBranchWorkSchedule'
    );
    await ensureEmpBranchWorkScheduleTable();
    const res = await db
      .request()
      .input('dow', sql.TinyInt, dayOfWeek)
      .input('branchId', sql.Int, activeBranchId)
      .input('day', sql.Date, workDate)
      .query(`
        SELECT s.EmpID, s.BranchID, b.BranchCode, b.BranchName, s.StartTime, s.EndTime,
          ROW_NUMBER() OVER (
            PARTITION BY s.EmpID ORDER BY s.EffectiveFrom DESC, s.ScheduleID DESC
          ) AS rn
        FROM dbo.TblEmpBranchWorkSchedule s
        INNER JOIN dbo.TblBranch b ON b.BranchID = s.BranchID
        WHERE s.DayOfWeek = @dow
          AND s.BranchID <> @branchId
          AND s.IsActive = 1
          AND s.IsWorking = 1
          AND s.EffectiveFrom <= @day
          AND (s.EffectiveTo IS NULL OR s.EffectiveTo >= @day)
          AND s.EmpID IN (${empIds.join(',')})
      `);
    for (const row of res.recordset) {
      if (Number(row.rn) !== 1) continue;
      map.set(row.EmpID as number, {
        branchId: Number(row.BranchID),
        branchCode: String(row.BranchCode),
        branchName: String(row.BranchName),
        startTime: fmtScheduleTime(row.StartTime),
        endTime: fmtScheduleTime(row.EndTime),
      });
    }
  } catch {
    /* optional */
  }
  return map;
}

/** Batch weekly schedule for many barbers — prefer branch-owned table, fallback legacy. */
export async function loadWorkingWindowsBatch(
  db: Awaited<ReturnType<typeof getPool>>,
  empIds: number[],
  dayOfWeek: number,
  opts?: { branchId?: number; workDate?: string },
): Promise<Map<number, WorkingWindowRow>> {
  const map = new Map<number, WorkingWindowRow>();
  if (!empIds.length) return map;

  const workDate = opts?.workDate;

  if (opts?.branchId != null && workDate) {
    try {
      const { ensureEmpBranchWorkScheduleTable } = await import('@/lib/hr/empBranchWorkSchedule');
      await ensureEmpBranchWorkScheduleTable();
      const res = await db
        .request()
        .input('dow', sql.TinyInt, dayOfWeek)
        .input('branchId', sql.Int, opts.branchId)
        .input('day', sql.Date, workDate)
        .query(`
          SELECT EmpID, IsWorking, StartTime, EndTime,
            ROW_NUMBER() OVER (
              PARTITION BY EmpID ORDER BY EffectiveFrom DESC, ScheduleID DESC
            ) AS rn
          FROM dbo.TblEmpBranchWorkSchedule
          WHERE DayOfWeek = @dow AND BranchID = @branchId AND IsActive = 1
            AND EffectiveFrom <= @day
            AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
            AND EmpID IN (${empIds.join(',')})
        `);
      for (const row of res.recordset) {
        if (Number(row.rn) !== 1) continue;
        map.set(row.EmpID as number, {
          isWorkingDay: !!row.IsWorking,
          startTime: fmtScheduleTime(row.StartTime),
          endTime: fmtScheduleTime(row.EndTime),
          source: 'BRANCH_WEEKLY',
        });
      }
      const xfer = await db
        .request()
        .input('branchId', sql.Int, opts.branchId)
        .input('day', sql.Date, workDate)
        .query(`
          SELECT EmpID, StartTime, EndTime
          FROM dbo.TblEmpTemporaryBranchTransfer
          WHERE ToBranchID = @branchId AND WorkDate = @day AND IsActive = 1
            AND EmpID IN (${empIds.join(',')})
        `);
      for (const row of xfer.recordset) {
        map.set(row.EmpID as number, {
          isWorkingDay: true,
          startTime: fmtScheduleTime(row.StartTime),
          endTime: fmtScheduleTime(row.EndTime),
          source: 'TEMPORARY_TRANSFER',
        });
      }
      const away = await db
        .request()
        .input('branchId', sql.Int, opts.branchId)
        .input('day', sql.Date, workDate)
        .query(`
          SELECT EmpID FROM dbo.TblEmpTemporaryBranchTransfer
          WHERE FromBranchID = @branchId AND WorkDate = @day AND IsActive = 1
            AND EmpID IN (${empIds.join(',')})
        `);
      for (const row of away.recordset) {
        map.set(row.EmpID as number, {
          isWorkingDay: false,
          startTime: null,
          endTime: null,
          source: 'TEMPORARY_TRANSFER',
        });
      }
    } catch {
      /* fall through */
    }
  } else if (workDate) {
    // No explicit branch — resolve via active assignment (parity with getBarberWorkingWindow).
    try {
      const { ensureEmpBranchWorkScheduleTable } = await import('@/lib/hr/empBranchWorkSchedule');
      await ensureEmpBranchWorkScheduleTable();
      const res = await db
        .request()
        .input('dow', sql.TinyInt, dayOfWeek)
        .input('day', sql.Date, workDate)
        .query(`
          SELECT s.EmpID, s.IsWorking, s.StartTime, s.EndTime,
            ROW_NUMBER() OVER (
              PARTITION BY s.EmpID ORDER BY s.EffectiveFrom DESC, s.ScheduleID DESC
            ) AS rn
          FROM dbo.TblEmpBranchWorkSchedule s
          INNER JOIN dbo.TblEmpBranchAssignment a
            ON a.EmpID = s.EmpID AND a.BranchID = s.BranchID
          WHERE s.DayOfWeek = @dow AND s.IsActive = 1
            AND s.EffectiveFrom <= @day
            AND (s.EffectiveTo IS NULL OR s.EffectiveTo >= @day)
            AND a.IsActive = 1
            AND a.EffectiveFrom <= @day
            AND (a.EffectiveTo IS NULL OR a.EffectiveTo >= @day)
            AND s.EmpID IN (${empIds.join(',')})
        `);
      for (const row of res.recordset) {
        if (Number(row.rn) !== 1) continue;
        map.set(row.EmpID as number, {
          isWorkingDay: !!row.IsWorking,
          startTime: fmtScheduleTime(row.StartTime),
          endTime: fmtScheduleTime(row.EndTime),
          source: 'BRANCH_WEEKLY',
        });
      }
    } catch {
      /* fall through to legacy */
    }
  }

  const missing = empIds.filter((id) => !map.has(id));
  if (missing.length) {
    try {
      const res = await db
        .request()
        .input('dow', sql.TinyInt, dayOfWeek)
        .query(`
          SELECT EmpID, IsWorkingDay, StartTime, EndTime
          FROM dbo.TblEmpWorkSchedule
          WHERE DayOfWeek = @dow AND EmpID IN (${missing.join(',')})
        `);
      for (const row of res.recordset) {
        map.set(row.EmpID as number, {
          isWorkingDay: !!row.IsWorkingDay,
          startTime: fmtScheduleTime(row.StartTime),
          endTime: fmtScheduleTime(row.EndTime),
          source: 'LEGACY_WEEKLY',
        });
      }
    } catch {
      /* empty */
    }
  }
  return map;
}
