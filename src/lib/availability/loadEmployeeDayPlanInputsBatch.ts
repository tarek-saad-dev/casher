/**
 * Phase 2 / 2.5 / 3A — Shared batch inputs for resolveEmployeeDayPlan.
 *
 * Phase 3A adds dailyAdjustmentsMap (active TblEmpDailyAdjustment rows).
 *
 * Transaction path: Sequential reads on the TX connection (mssql one-request rule).
 * DDL exception: ensureEmpBranchWorkScheduleTable (inside loadWorkingWindowsBatch)
 * and ensureDailyAdjustmentTables stay on the pool — never inside SERIALIZABLE booking TX.
 */

import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import type { ScheduleOverride } from '@/lib/scheduleOverrides';
import { loadBookingOverridesForDate } from '@/lib/hr/attendance-shift-schedule-sync';
import {
  loadFreelanceBookingUnlocks,
  type FreelanceUnlockWindow,
} from '@/lib/hr/freelanceBookingUnlock';
import {
  loadWorkingWindowsBatch,
  type WorkingWindowRow,
} from '@/lib/availability/loadWorkingWindowsBatch';
import { getGlobalTimingDefaults } from '@/lib/publicBookingHelpers';
import { SALON_TZ } from '@/lib/businessDate';
import { loadDailyAdjustmentsBatch } from '@/lib/availability/loadDailyAdjustmentsBatch';
import type { EmployeeDailyAdjustment } from '@/lib/availability/dailyAdjustments';

export type DayPlanAttendanceState = {
  status: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
};

export type EmployeeDayPlanBatchInputs = {
  windowsMap: Map<number, WorkingWindowRow>;
  overridesMap: Map<number, ScheduleOverride[]>;
  freelanceUnlocks: Map<number, FreelanceUnlockWindow>;
  attendanceMap: Map<number, DayPlanAttendanceState>;
  dayOffEmpIds: Set<number>;
  absentEmpIds: Set<number>;
  timezone: string;
  /** Phase 3A — active daily adjustments by empId. */
  dailyAdjustmentsMap: Map<number, EmployeeDailyAdjustment[]>;
};

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

type DbLike = Awaited<ReturnType<typeof getPool>> | Transaction;

function asDb(db: DbLike): Awaited<ReturnType<typeof getPool>> {
  return db as Awaited<ReturnType<typeof getPool>>;
}

async function loadAttendanceAndAbsentBatch(
  db: Awaited<ReturnType<typeof getPool>>,
  empIds: number[],
  businessDate: string,
): Promise<{
  attendanceMap: Map<number, DayPlanAttendanceState>;
  absentEmpIds: Set<number>;
}> {
  const attendanceMap = new Map<number, DayPlanAttendanceState>();
  const absentEmpIds = new Set<number>();
  if (!empIds.length) return { attendanceMap, absentEmpIds };

  try {
    const res = await db
      .request()
      .input('workDate', sql.Date, businessDate)
      .query(`
        SELECT EmpID, Status,
          CASE WHEN CheckInTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), CheckInTime, 108), 5) ELSE NULL END AS CheckInTime,
          CASE WHEN CheckOutTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), CheckOutTime, 108), 5) ELSE NULL END AS CheckOutTime
        FROM dbo.TblEmpAttendance
        WHERE WorkDate = @workDate AND EmpID IN (${empIds.join(',')})
      `);
    for (const row of res.recordset) {
      const empId = Number(row.EmpID);
      attendanceMap.set(empId, {
        status: row.Status ?? null,
        checkInTime: row.CheckInTime ?? null,
        checkOutTime: row.CheckOutTime ?? null,
      });
      if (String(row.Status ?? '') === 'Absent') {
        absentEmpIds.add(empId);
      }
    }
  } catch {
    /* optional table */
  }
  return { attendanceMap, absentEmpIds };
}

async function loadDayOffEmpIdsBatch(
  db: Awaited<ReturnType<typeof getPool>>,
  empIds: number[],
  businessDate: string,
): Promise<Set<number>> {
  const dayOffEmpIds = new Set<number>();
  if (!empIds.length) return dayOffEmpIds;
  try {
    const res = await db
      .request()
      .input('offDate', sql.Date, businessDate)
      .query(`
        SELECT EmpID FROM dbo.TblEmpDayOff
        WHERE OffDate = @offDate AND IsDeleted = 0 AND EmpID IN (${empIds.join(',')})
      `);
    for (const row of res.recordset) {
      dayOffEmpIds.add(Number(row.EmpID));
    }
  } catch {
    /* optional table */
  }
  return dayOffEmpIds;
}

export async function loadEmployeeDayPlanInputsBatch(args: {
  branchId?: number | null;
  empIds: number[];
  businessDate: string;
  transaction?: Transaction;
}): Promise<EmployeeDayPlanBatchInputs> {
  const empIds = normalizeEmpIds(args.empIds);
  const branchId = args.branchId ?? null;
  const businessDate = args.businessDate;
  const dayOfWeek = new Date(`${businessDate}T12:00:00Z`).getDay();
  const transaction = args.transaction;
  const onTx = !!transaction;
  const db = asDb(transaction ?? (await getPool()));

  const emptyWindows = new Map<number, WorkingWindowRow>();
  const emptyOverrides = new Map<number, ScheduleOverride[]>();
  const emptyAdj = new Map<number, EmployeeDailyAdjustment[]>();

  if (onTx) {
    const windowsMap = empIds.length
      ? await loadWorkingWindowsBatch(db, empIds, dayOfWeek, {
          branchId: branchId ?? undefined,
          workDate: businessDate,
        })
      : emptyWindows;
    const overridesMap = empIds.length
      ? await loadBookingOverridesForDate(db, empIds, businessDate)
      : emptyOverrides;
    const freelanceUnlocks = await loadFreelanceBookingUnlocks(empIds, businessDate, {
      transaction,
    });
    const attendanceBundle = await loadAttendanceAndAbsentBatch(db, empIds, businessDate);
    const dayOffEmpIds = await loadDayOffEmpIdsBatch(db, empIds, businessDate);
    const settings = await getGlobalTimingDefaults({ transaction });
    const timezone = settings.timezone || SALON_TZ;
    const dailyAdjustmentsMap = await loadDailyAdjustmentsBatch({
      branchId,
      empIds,
      businessDate,
      transaction,
      timezone,
    });

    return {
      windowsMap,
      overridesMap,
      freelanceUnlocks,
      attendanceMap: attendanceBundle.attendanceMap,
      dayOffEmpIds,
      absentEmpIds: attendanceBundle.absentEmpIds,
      timezone,
      dailyAdjustmentsMap,
    };
  }

  const [
    windowsMap,
    overridesMap,
    freelanceUnlocks,
    attendanceBundle,
    dayOffEmpIds,
    settings,
  ] = await Promise.all([
    empIds.length
      ? loadWorkingWindowsBatch(db, empIds, dayOfWeek, {
          branchId: branchId ?? undefined,
          workDate: businessDate,
        })
      : Promise.resolve(emptyWindows),
    empIds.length
      ? loadBookingOverridesForDate(db, empIds, businessDate)
      : Promise.resolve(emptyOverrides),
    loadFreelanceBookingUnlocks(empIds, businessDate),
    loadAttendanceAndAbsentBatch(db, empIds, businessDate),
    loadDayOffEmpIdsBatch(db, empIds, businessDate),
    getGlobalTimingDefaults(),
  ]);

  const timezone = settings.timezone || SALON_TZ;
  const dailyAdjustmentsMap = await loadDailyAdjustmentsBatch({
    branchId,
    empIds,
    businessDate,
    timezone,
  });

  return {
    windowsMap,
    overridesMap,
    freelanceUnlocks,
    attendanceMap: attendanceBundle.attendanceMap,
    dayOffEmpIds,
    absentEmpIds: attendanceBundle.absentEmpIds,
    timezone,
    dailyAdjustmentsMap: dailyAdjustmentsMap.size ? dailyAdjustmentsMap : emptyAdj,
  };
}
