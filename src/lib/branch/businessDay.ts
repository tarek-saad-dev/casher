import 'server-only';
import { getPool, sql } from '@/lib/db';
import { resolveBusinessDate } from '@/modules/operations/clock/BusinessClock';
import type { ActiveBranchContext } from './types';
import { BranchDomainError } from './types';
import { openBusinessDaySession } from '@/modules/operations/application/openBusinessDay';
import {
  closeBusinessDaySession,
  forceCloseBranchShiftsSession,
} from '@/modules/operations/application/closeBusinessDay';
import { closeAndOpenBusinessDaySession } from '@/modules/operations/application/closeAndOpenBusinessDay';

/**
 * BusinessDay (TblNewDay) is branch-scoped.
 *
 * Invariants: at most one OPEN day per branch; a shift may open only against
 * an OPEN day; close requires no OPEN shifts for that BranchID+BusinessDayID
 * unless forceCloseShifts is used.
 *
 * See src/modules/operations/domain/invariants.ts
 */
export interface BusinessDayRecord {
  id: number;
  branchId: number;
  newDay: string;
  status: boolean;
}

function mapDay(row: Record<string, unknown>): BusinessDayRecord {
  const rawDate = row.NewDay;
  const newDay =
    rawDate instanceof Date
      ? rawDate.toISOString().slice(0, 10)
      : String(rawDate).slice(0, 10);
  return {
    id: Number(row.ID),
    branchId: Number(row.BranchID),
    newDay,
    status: Boolean(row.Status),
  };
}

/** Business date for a branch using its timezone + cutoff hour (BusinessClock). */
export function getBranchBusinessDate(
  branch: Pick<ActiveBranchContext, 'timeZone' | 'businessDayCutoffTime'>,
  now = new Date(),
): string {
  return resolveBusinessDate(branch, now);
}

export async function getBusinessDayById(
  businessDayId: number,
): Promise<BusinessDayRecord | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('id', sql.Int, businessDayId)
    .query(`
      SELECT ID, BranchID, NewDay, Status
      FROM dbo.TblNewDay
      WHERE ID = @id
    `);
  if (!result.recordset[0]) return null;
  return mapDay(result.recordset[0]);
}

export async function getOpenBusinessDay(
  branchId: number,
): Promise<BusinessDayRecord | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT TOP 1 ID, BranchID, NewDay, Status
      FROM dbo.TblNewDay
      WHERE BranchID = @branchId AND Status = 1
      ORDER BY ID DESC
    `);
  if (!result.recordset[0]) return null;
  return mapDay(result.recordset[0]);
}

export async function getBusinessDayByDate(
  branchId: number,
  date: string,
): Promise<BusinessDayRecord | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('newDay', sql.Date, date)
    .query(`
      SELECT TOP 1 ID, BranchID, NewDay, Status
      FROM dbo.TblNewDay
      WHERE BranchID = @branchId AND NewDay = @newDay
      ORDER BY ID DESC
    `);
  if (!result.recordset[0]) return null;
  return mapDay(result.recordset[0]);
}

export async function validateBusinessDayBelongsToBranch(
  businessDayId: number,
  branchId: number,
): Promise<BusinessDayRecord> {
  const day = await getBusinessDayById(businessDayId);
  if (!day) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'يوم العمل غير موجود', 404);
  }
  if (day.branchId !== branchId) {
    throw new BranchDomainError(
      'BRANCH_ACCESS_MISMATCH',
      'يوم العمل لا ينتمي للفرع النشط',
      403,
    );
  }
  return day;
}

export async function listOpenShiftsForBranchDay(
  branchId: number,
  businessDayId?: number,
) {
  const db = await getPool();
  const req = db.request().input('branchId', sql.Int, branchId);
  if (businessDayId != null) {
    req.input('businessDayId', sql.Int, businessDayId);
  }
  const result = await req.query(`
      SELECT sm.ID, sm.UserID, u.UserName, sm.ShiftID, s.ShiftName, sm.StartTime,
             sm.BusinessDayID, sm.BranchID, sm.NewDay
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON sm.UserID = u.UserID
      LEFT JOIN dbo.TblShift s ON sm.ShiftID = s.ShiftID
      WHERE sm.Status = 1 AND sm.BranchID = @branchId
        ${businessDayId != null ? 'AND sm.BusinessDayID = @businessDayId' : ''}
      ORDER BY sm.ID
    `);
  return result.recordset;
}

export function openBusinessDay(
  branchContext: ActiveBranchContext,
  date?: string,
): Promise<BusinessDayRecord> {
  return openBusinessDaySession(branchContext, date);
}

export function closeBusinessDay(
  branchContext: ActiveBranchContext,
  options?: { forceCloseShifts?: boolean },
): Promise<{ day: BusinessDayRecord; closedShifts: number }> {
  return closeBusinessDaySession(branchContext, options);
}

export function closeAndOpenBusinessDay(
  branchContext: ActiveBranchContext,
  options?: { forceCloseShifts?: boolean; openDate?: string },
): Promise<{ closedDay: BusinessDayRecord; openedDay: BusinessDayRecord; closedShifts: number }> {
  return closeAndOpenBusinessDaySession(branchContext, options);
}

export function forceCloseBranchShifts(
  branchContext: ActiveBranchContext,
  reason: string,
): Promise<number> {
  return forceCloseBranchShiftsSession(branchContext, reason);
}
