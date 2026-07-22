import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { ActiveBranchContext } from './types';
import { BranchDomainError } from './types';
import { getOpenBusinessDay, validateBusinessDayBelongsToBranch } from './businessDay';

export interface ShiftMoveRecord {
  id: number;
  branchId: number;
  businessDayId: number;
  newDay: string;
  userId: number;
  shiftId: number;
  startDate: string | null;
  startTime: string | null;
  endDate: string | null;
  endTime: string | null;
  status: boolean;
  userName?: string | null;
  shiftName?: string | null;
}

function mapShift(row: Record<string, unknown>): ShiftMoveRecord {
  const asDate = (v: unknown) => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  };
  return {
    id: Number(row.ID),
    branchId: Number(row.BranchID),
    businessDayId: Number(row.BusinessDayID),
    newDay: asDate(row.NewDay) || '',
    userId: Number(row.UserID),
    shiftId: Number(row.ShiftID),
    startDate: asDate(row.StartDate),
    startTime: row.StartTime == null ? null : String(row.StartTime).trim(),
    endDate: asDate(row.EndDate),
    endTime: row.EndTime == null ? null : String(row.EndTime).trim(),
    status: Boolean(row.Status),
    userName: row.UserName == null ? null : String(row.UserName),
    shiftName: row.ShiftName == null ? null : String(row.ShiftName),
  };
}

export async function getUserOpenShift(userId: number): Promise<ShiftMoveRecord | null> {
  const db = await getPool();
  const result = await db
    .request()
    .input('userId', sql.Int, userId)
    .query(`
      SELECT TOP 1
        sm.ID, sm.BranchID, sm.BusinessDayID, sm.NewDay, sm.UserID, sm.ShiftID,
        sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime, sm.Status,
        u.UserName, s.ShiftName
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.Status = 1 AND sm.UserID = @userId
      ORDER BY sm.ID DESC
    `);
  if (!result.recordset[0]) return null;
  return mapShift(result.recordset[0]);
}

export async function getUserOpenShiftForBranch(
  userId: number,
  branchId: number,
): Promise<ShiftMoveRecord | null> {
  const open = await getUserOpenShift(userId);
  if (!open) return null;
  if (open.branchId !== branchId) return null;
  return open;
}

export async function listOpenShiftsForBranch(branchId: number): Promise<ShiftMoveRecord[]> {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT
        sm.ID, sm.BranchID, sm.BusinessDayID, sm.NewDay, sm.UserID, sm.ShiftID,
        sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime, sm.Status,
        u.UserName, s.ShiftName
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.Status = 1 AND sm.BranchID = @branchId
      ORDER BY sm.ID
    `);
  return result.recordset.map(mapShift);
}

export async function validateShiftBelongsToBranch(
  shiftMoveId: number,
  branchId: number,
): Promise<ShiftMoveRecord> {
  const db = await getPool();
  const result = await db
    .request()
    .input('id', sql.Int, shiftMoveId)
    .query(`
      SELECT
        sm.ID, sm.BranchID, sm.BusinessDayID, sm.NewDay, sm.UserID, sm.ShiftID,
        sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime, sm.Status,
        u.UserName, s.ShiftName
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.ID = @id
    `);
  if (!result.recordset[0]) {
    throw new BranchDomainError('BRANCH_NOT_FOUND', 'الوردية غير موجودة', 404);
  }
  const shift = mapShift(result.recordset[0]);
  if (shift.branchId !== branchId) {
    throw new BranchDomainError(
      'BRANCH_ACCESS_MISMATCH',
      'الوردية لا تنتمي للفرع النشط',
      403,
    );
  }
  return shift;
}

function formatLegacyStartTime(now = new Date()): string {
  const hours = now.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${ampm}`;
}

function formatLegacyEndTime(now = new Date()): string {
  const hours = now.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${ampm}`;
}

export async function openShift(
  branchContext: ActiveBranchContext,
  userId: number,
  shiftId: number,
): Promise<ShiftMoveRecord> {
  if (!branchContext.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }

  const day = await getOpenBusinessDay(branchContext.branchId);
  if (!day || !day.status) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'لا يوجد يوم عمل مفتوح لهذا الفرع — يجب فتح يوم أولاً',
      400,
    );
  }

  const existing = await getUserOpenShift(userId);
  if (existing) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      existing.branchId === branchContext.branchId
        ? 'لديك وردية مفتوحة بالفعل — يجب إغلاقها أولاً'
        : 'لديك وردية مفتوحة في فرع آخر — يجب إغلاقها أولاً',
      400,
    );
  }

  const db = await getPool();
  const startTime = formatLegacyStartTime();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchContext.branchId)
    .input('businessDayId', sql.Int, day.id)
    .input('newDay', sql.Date, day.newDay)
    .input('userID', sql.Int, userId)
    .input('shiftID', sql.Int, shiftId)
    .input('startDate', sql.Date, day.newDay)
    .input('startTime', sql.NChar(10), startTime)
    .query(`
      INSERT INTO dbo.TblShiftMove (
        BranchID, BusinessDayID, NewDay, UserID, ShiftID, StartDate, StartTime, Status
      )
      OUTPUT INSERTED.ID, INSERTED.BranchID, INSERTED.BusinessDayID, INSERTED.NewDay,
             INSERTED.UserID, INSERTED.ShiftID, INSERTED.StartDate, INSERTED.StartTime,
             INSERTED.EndDate, INSERTED.EndTime, INSERTED.Status
      VALUES (
        @branchId, @businessDayId, @newDay, @userID, @shiftID, @startDate, @startTime, 1
      )
    `);

  return mapShift(result.recordset[0]);
}

export async function closeShift(
  branchContext: ActiveBranchContext,
  shiftMoveId: number,
): Promise<ShiftMoveRecord> {
  if (!branchContext.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }

  const shift = await validateShiftBelongsToBranch(shiftMoveId, branchContext.branchId);
  if (!shift.status) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'هذه الوردية مغلقة بالفعل', 400);
  }

  await validateBusinessDayBelongsToBranch(shift.businessDayId, branchContext.branchId);

  const db = await getPool();
  const now = new Date();
  const result = await db
    .request()
    .input('id', sql.Int, shiftMoveId)
    .input('branchId', sql.Int, branchContext.branchId)
    .input('endDate', sql.Date, now)
    .input('endTime', sql.NVarChar(50), formatLegacyEndTime(now))
    .query(`
      UPDATE dbo.TblShiftMove
      SET Status = 0, EndDate = @endDate, EndTime = @endTime
      WHERE ID = @id AND BranchID = @branchId AND Status = 1;

      SELECT
        sm.ID, sm.BranchID, sm.BusinessDayID, sm.NewDay, sm.UserID, sm.ShiftID,
        sm.StartDate, sm.StartTime, sm.EndDate, sm.EndTime, sm.Status,
        u.UserName, s.ShiftName
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.ID = @id
    `);

  if (!result.recordset[0]) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'تعذر إغلاق الوردية', 400);
  }
  return mapShift(result.recordset[0]);
}

export { forceCloseBranchShifts } from './businessDay';
