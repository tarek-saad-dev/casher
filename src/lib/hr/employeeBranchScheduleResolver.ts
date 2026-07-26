/**
 * Phase 1Q — central employee branch / global schedule resolver (read-only aggregation).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from '@/lib/branch/repository';
import {
  ensureEmpBranchWorkScheduleTable,
  getEffectiveBranchScheduleRow,
  listActiveBranchSchedulesForEmp,
  type EmpBranchWorkScheduleRow,
} from '@/lib/hr/empBranchWorkSchedule';
import { getBarberWorkingWindow } from '@/lib/barberAvailability';

export type ResolvedBranchSchedule = {
  branchId: number;
  branchCode: string;
  branchName: string;
  isWorking: boolean;
  startTime: string | null;
  endTime: string | null;
  startDayOffset: 0 | 1;
  endDayOffset: 0 | 1;
  startDateTime: string | null;
  endDateTime: string | null;
  sourceScheduleId: number | null;
  source: 'branch_table' | 'legacy_fallback' | 'temporary_transfer' | 'none';
  appliedOverrides: string[];
  canReceiveBookings: boolean;
};

export type EmployeeGlobalScheduleResult = {
  empId: number;
  workDate: string;
  branches: ResolvedBranchSchedule[];
  isGloballyWorking: boolean;
  isGlobalDayOff: boolean;
  conflict: {
    code: string;
    message: string;
    branchIds: number[];
  } | null;
};

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function isOvernight(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return eh * 60 + em <= sh * 60 + sm;
}

function toAbs(workDate: string, time: string | null, dayOffset: 0 | 1): string | null {
  if (!time) return null;
  const date = dayOffset === 1 ? nextDate(workDate) : workDate;
  return `${date}T${time.length === 5 ? time + ':00' : time}`;
}

async function loadTemporaryTransfer(
  empId: number,
  workDate: string,
): Promise<{
  fromBranchId: number;
  toBranchId: number;
  startTime: string | null;
  endTime: string | null;
} | null> {
  await ensureEmpBranchWorkScheduleTable();
  const db = await getPool();
  const r = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('day', sql.Date, workDate)
    .query(`
      SELECT TOP 1 FromBranchID, ToBranchID, StartTime, EndTime
      FROM dbo.TblEmpTemporaryBranchTransfer
      WHERE EmpID = @empId AND WorkDate = @day AND IsActive = 1
      ORDER BY TransferID DESC
    `);
  if (!r.recordset[0]) return null;
  const row = r.recordset[0];
  const fmt = (v: unknown) =>
    v == null ? null : typeof v === 'string' ? v.slice(0, 5) : String(v).slice(0, 5);
  return {
    fromBranchId: Number(row.FromBranchID),
    toBranchId: Number(row.ToBranchID),
    startTime: fmt(row.StartTime),
    endTime: fmt(row.EndTime),
  };
}

async function hasGlobalLeave(empId: number, workDate: string): Promise<boolean> {
  const db = await getPool();
  try {
    const r = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('day', sql.Date, workDate)
      .query(`
        SELECT TOP 1 1 AS X
        FROM dbo.TblEmpDayOff
        WHERE EmpID = @empId AND OffDate = @day AND ISNULL(IsDeleted, 0) = 0
      `);
    if (r.recordset[0]) return true;
  } catch {
    /* table may vary */
  }
  try {
    const o = await db
      .request()
      .input('empId', sql.Int, empId)
      .input('day', sql.Date, workDate)
      .query(`
        SELECT TOP 1 1 AS X
        FROM dbo.TblEmpScheduleOverrides
        WHERE EmpID = @empId AND OverrideDate = @day AND IsActive = 1
          AND Type = N'day_off'
      `);
    // Overrides are currently global (no BranchID) — day_off blocks every branch
    if (o.recordset[0]) return true;
  } catch {
    /* ignore */
  }
  return false;
}

async function hasActiveAssignment(
  empId: number,
  branchId: number,
  workDate: string,
): Promise<boolean> {
  const db = await getPool();
  const r = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('day', sql.Date, workDate)
    .query(`
      SELECT TOP 1 1 AS X
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
        AND EffectiveFrom <= @day
        AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
    `);
  return Boolean(r.recordset[0]);
}

async function resolveFromRow(
  row: EmpBranchWorkScheduleRow,
  workDate: string,
  source: ResolvedBranchSchedule['source'],
  overrides: string[] = [],
): Promise<ResolvedBranchSchedule | null> {
  const branch = await getBranchById(row.branchId);
  if (!branch) return null;
  const overnight = isOvernight(row.startTime, row.endTime);
  const endDayOffset: 0 | 1 = overnight ? 1 : 0;
  return {
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    isWorking: row.isWorking,
    startTime: row.startTime,
    endTime: row.endTime,
    startDayOffset: 0,
    endDayOffset,
    startDateTime: toAbs(workDate, row.startTime, 0),
    endDateTime: toAbs(workDate, row.endTime, endDayOffset),
    sourceScheduleId: row.scheduleId,
    source,
    appliedOverrides: overrides,
    canReceiveBookings: row.canReceiveBookings,
  };
}

/**
 * Resolve schedule for one employee at one branch on a WorkDate.
 */
export async function resolveEmployeeBranchSchedule(args: {
  empId: number;
  branchId: number;
  workDate: string;
}): Promise<ResolvedBranchSchedule | null> {
  await ensureEmpBranchWorkScheduleTable();

  if (await hasGlobalLeave(args.empId, args.workDate)) {
    const branch = await getBranchById(args.branchId);
    if (!branch) return null;
    return {
      branchId: branch.branchId,
      branchCode: branch.branchCode,
      branchName: branch.branchName,
      isWorking: false,
      startTime: null,
      endTime: null,
      startDayOffset: 0,
      endDayOffset: 0,
      startDateTime: null,
      endDateTime: null,
      sourceScheduleId: null,
      source: 'none',
      appliedOverrides: ['global_leave'],
      canReceiveBookings: false,
    };
  }

  const transfer = await loadTemporaryTransfer(args.empId, args.workDate);
  if (transfer) {
    if (transfer.fromBranchId === args.branchId) {
      const branch = await getBranchById(args.branchId);
      if (!branch) return null;
      return {
        branchId: branch.branchId,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
        isWorking: false,
        startTime: null,
        endTime: null,
        startDayOffset: 0,
        endDayOffset: 0,
        startDateTime: null,
        endDateTime: null,
        sourceScheduleId: null,
        source: 'temporary_transfer',
        appliedOverrides: ['temporary_branch_transfer_away'],
        canReceiveBookings: false,
      };
    }
    if (transfer.toBranchId === args.branchId) {
      const assigned = await hasActiveAssignment(args.empId, args.branchId, args.workDate);
      if (!assigned) return null;
      const overnight = isOvernight(transfer.startTime, transfer.endTime);
      const branch = await getBranchById(args.branchId);
      if (!branch) return null;
      return {
        branchId: branch.branchId,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
        isWorking: true,
        startTime: transfer.startTime,
        endTime: transfer.endTime,
        startDayOffset: 0,
        endDayOffset: overnight ? 1 : 0,
        startDateTime: toAbs(args.workDate, transfer.startTime, 0),
        endDateTime: toAbs(args.workDate, transfer.endTime, overnight ? 1 : 0),
        sourceScheduleId: null,
        source: 'temporary_transfer',
        appliedOverrides: ['temporary_branch_transfer'],
        canReceiveBookings: true,
      };
    }
  }

  const assigned = await hasActiveAssignment(args.empId, args.branchId, args.workDate);
  if (!assigned) return null;

  const row = await getEffectiveBranchScheduleRow(args);
  if (row) {
    return resolveFromRow(row, args.workDate, 'branch_table');
  }

  // Legacy fallback: only for GLEEM when branch table has no row (pre-backfill safety)
  const branch = await getBranchById(args.branchId);
  if (branch?.branchCode === 'GLEEM') {
    const dateObj = new Date(`${args.workDate}T12:00:00Z`);
    const legacy = await getBarberWorkingWindow(args.empId, dateObj);
    if (legacy.isWorkingDay && legacy.startTime && legacy.endTime) {
      const overnight = isOvernight(legacy.startTime, legacy.endTime);
      return {
        branchId: branch.branchId,
        branchCode: branch.branchCode,
        branchName: branch.branchName,
        isWorking: true,
        startTime: legacy.startTime,
        endTime: legacy.endTime,
        startDayOffset: 0,
        endDayOffset: overnight ? 1 : 0,
        startDateTime: toAbs(args.workDate, legacy.startTime, 0),
        endDateTime: toAbs(args.workDate, legacy.endTime, overnight ? 1 : 0),
        sourceScheduleId: null,
        source: 'legacy_fallback',
        appliedOverrides: [],
        canReceiveBookings: true,
      };
    }
  }

  return {
    branchId: args.branchId,
    branchCode: branch?.branchCode ?? '',
    branchName: branch?.branchName ?? '',
    isWorking: false,
    startTime: null,
    endTime: null,
    startDayOffset: 0,
    endDayOffset: 0,
    startDateTime: null,
    endDateTime: null,
    sourceScheduleId: null,
    source: 'none',
    appliedOverrides: [],
    canReceiveBookings: false,
  };
}

/**
 * Global read-only union of branch schedules for an employee on a WorkDate.
 */
export async function resolveEmployeeGlobalSchedule(args: {
  empId: number;
  workDate: string;
  allowedBranchIds?: number[];
  publicOnly?: boolean;
}): Promise<EmployeeGlobalScheduleResult> {
  await ensureEmpBranchWorkScheduleTable();

  if (await hasGlobalLeave(args.empId, args.workDate)) {
    return {
      empId: args.empId,
      workDate: args.workDate,
      branches: [],
      isGloballyWorking: false,
      isGlobalDayOff: true,
      conflict: null,
    };
  }

  const transfer = await loadTemporaryTransfer(args.empId, args.workDate);
  const workingRows = await listActiveBranchSchedulesForEmp(args.empId, args.workDate);

  const branchIds = new Set<number>();
  for (const r of workingRows) branchIds.add(r.branchId);
  if (transfer) {
    branchIds.delete(transfer.fromBranchId);
    branchIds.add(transfer.toBranchId);
  }

  // Include GLEEM legacy if no branch-table rows and GLEEM allowed
  if (workingRows.length === 0 && !transfer) {
    const db = await getPool();
    const gleem = await db.request().query(`
      SELECT TOP 1 BranchID FROM dbo.TblBranch WHERE BranchCode = N'GLEEM'
    `);
    if (gleem.recordset[0]) branchIds.add(Number(gleem.recordset[0].BranchID));
  }

  let ids = [...branchIds];
  if (args.allowedBranchIds?.length) {
    const allow = new Set(args.allowedBranchIds);
    ids = ids.filter((id) => allow.has(id));
  }

  if (args.publicOnly) {
    const { canBranchAppearInPublicBooking } = await import(
      '@/lib/branch/publicBranchVisibility'
    );
    const filtered: number[] = [];
    for (const id of ids) {
      if (await canBranchAppearInPublicBooking(id)) filtered.push(id);
    }
    ids = filtered;
  }

  const branches: ResolvedBranchSchedule[] = [];
  for (const branchId of ids) {
    const resolved = await resolveEmployeeBranchSchedule({
      empId: args.empId,
      branchId,
      workDate: args.workDate,
    });
    if (resolved?.isWorking) branches.push(resolved);
  }

  let conflict: EmployeeGlobalScheduleResult['conflict'] = null;
  if (branches.length > 1) {
    conflict = {
      code: 'EMPLOYEE_MULTI_BRANCH_SAME_WORKDAY_NOT_ALLOWED',
      message: 'Employee has working schedules in multiple branches on the same WorkDate',
      branchIds: branches.map((b) => b.branchId),
    };
  }

  return {
    empId: args.empId,
    workDate: args.workDate,
    branches,
    isGloballyWorking: branches.length > 0,
    isGlobalDayOff: branches.length === 0,
    conflict,
  };
}
