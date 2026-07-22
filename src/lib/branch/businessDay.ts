import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { ActiveBranchContext } from './types';
import { BranchDomainError } from './types';

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

function formatDateInTimeZone(timeZone: string, now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone });
}

function parseCutoffHour(cutoff: string): number {
  const hour = Number(String(cutoff).slice(0, 2));
  return Number.isFinite(hour) ? hour : 4;
}

/** Business date for a branch using its timezone + cutoff hour. */
export function getBranchBusinessDate(
  branch: Pick<ActiveBranchContext, 'timeZone' | 'businessDayCutoffTime'>,
  now = new Date(),
): string {
  const timeZone = branch.timeZone || 'Africa/Cairo';
  const cutoff = parseCutoffHour(branch.businessDayCutoffTime || '04:00:00');
  const hourStr = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  const hour = parseInt(hourStr, 10);
  const calendar = formatDateInTimeZone(timeZone, now);
  if (hour < cutoff) {
    const [y, m, d] = calendar.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 1);
    return dt.toISOString().slice(0, 10);
  }
  return calendar;
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

export async function openBusinessDay(
  branchContext: ActiveBranchContext,
  date?: string,
): Promise<BusinessDayRecord> {
  if (!branchContext.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }

  const newDayDate = date || getBranchBusinessDate(branchContext);
  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    const lock = await new sql.Request(tx)
      .input('branchId', sql.Int, branchContext.branchId)
      .query(`
        SELECT TOP 1 ID, BranchID, NewDay, Status
        FROM dbo.TblNewDay WITH (UPDLOCK, HOLDLOCK)
        WHERE BranchID = @branchId AND Status = 1
        ORDER BY ID DESC
      `);
    if (lock.recordset[0]) {
      const open = mapDay(lock.recordset[0]);
      const err = new BranchDomainError(
        'OPERATION_NOT_ALLOWED',
        `يوجد يوم عمل مفتوح بالفعل لهذا الفرع (${open.newDay})`,
        400,
      );
      throw err;
    }

    const dup = await new sql.Request(tx)
      .input('branchId', sql.Int, branchContext.branchId)
      .input('newDay', sql.Date, newDayDate)
      .query(`
        SELECT TOP 1 ID
        FROM dbo.TblNewDay WITH (UPDLOCK, HOLDLOCK)
        WHERE BranchID = @branchId AND NewDay = @newDay
      `);
    if (dup.recordset[0]) {
      throw new BranchDomainError(
        'OPERATION_NOT_ALLOWED',
        'يوجد يوم عمل بنفس التاريخ لهذا الفرع بالفعل',
        400,
      );
    }

    const inserted = await new sql.Request(tx)
      .input('branchId', sql.Int, branchContext.branchId)
      .input('newDay', sql.Date, newDayDate)
      .query(`
        INSERT INTO dbo.TblNewDay (BranchID, NewDay, Status)
        OUTPUT INSERTED.ID, INSERTED.BranchID, INSERTED.NewDay, INSERTED.Status
        VALUES (@branchId, @newDay, 1)
      `);
    await tx.commit();
    return mapDay(inserted.recordset[0]);
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    throw err;
  }
}

export async function listOpenShiftsForBranchDay(branchId: number) {
  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT sm.ID, sm.UserID, u.UserName, sm.ShiftID, s.ShiftName, sm.StartTime,
             sm.BusinessDayID, sm.BranchID, sm.NewDay
      FROM dbo.TblShiftMove sm
      LEFT JOIN dbo.TblUser u ON sm.UserID = u.UserID
      LEFT JOIN dbo.TblShift s ON sm.ShiftID = s.ShiftID
      WHERE sm.Status = 1 AND sm.BranchID = @branchId
      ORDER BY sm.ID
    `);
  return result.recordset;
}

function formatLegacyEndTime(now = new Date()): string {
  const hours = now.getHours();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const h12 = hours % 12 || 12;
  return `${String(h12).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} ${ampm}`;
}

export async function forceCloseBranchShifts(
  branchContext: ActiveBranchContext,
  reason: string,
): Promise<number> {
  if (!branchContext.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }
  const db = await getPool();
  const now = new Date();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchContext.branchId)
    .input('endDate', sql.Date, now)
    .input('endTime', sql.NVarChar(50), formatLegacyEndTime(now))
    .query(`
      UPDATE dbo.TblShiftMove
      SET Status = 0, EndDate = @endDate, EndTime = @endTime
      WHERE Status = 1 AND BranchID = @branchId;
      SELECT @@ROWCOUNT AS ClosedCount;
    `);
  console.warn(
    JSON.stringify({
      type: 'BRANCH_FORCE_CLOSE_SHIFTS',
      branchId: branchContext.branchId,
      reason,
      closed: result.recordset[0]?.ClosedCount ?? 0,
    }),
  );
  return Number(result.recordset[0]?.ClosedCount ?? 0);
}

export async function closeBusinessDay(
  branchContext: ActiveBranchContext,
  options?: { forceCloseShifts?: boolean },
): Promise<{ day: BusinessDayRecord; closedShifts: number }> {
  if (!branchContext.canOperate) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'غير مصرح — لا تملك صلاحية تشغيل هذا الفرع',
      403,
    );
  }

  const open = await getOpenBusinessDay(branchContext.branchId);
  if (!open) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'لا يوجد يوم عمل مفتوح لإغلاقه', 400);
  }

  const openShifts = await listOpenShiftsForBranchDay(branchContext.branchId);
  if (openShifts.length > 0 && !options?.forceCloseShifts) {
    const err = new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      `يوجد ${openShifts.length} وردية مفتوحة في هذا الفرع`,
      400,
    ) as BranchDomainError & { openShifts: unknown[] };
    err.openShifts = openShifts;
    throw err;
  }

  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    let closedShifts = 0;
    if (openShifts.length > 0 && options?.forceCloseShifts) {
      const now = new Date();
      const upd = await new sql.Request(tx)
        .input('branchId', sql.Int, branchContext.branchId)
        .input('endDate', sql.Date, now)
        .input('endTime', sql.NVarChar(50), formatLegacyEndTime(now))
        .query(`
          UPDATE dbo.TblShiftMove
          SET Status = 0, EndDate = @endDate, EndTime = @endTime
          WHERE Status = 1 AND BranchID = @branchId;
          SELECT @@ROWCOUNT AS ClosedCount;
        `);
      closedShifts = Number(upd.recordset[0]?.ClosedCount ?? 0);
    }

    await new sql.Request(tx)
      .input('dayID', sql.Int, open.id)
      .input('branchId', sql.Int, branchContext.branchId)
      .query(`
        UPDATE dbo.TblNewDay
        SET Status = 0
        WHERE ID = @dayID AND BranchID = @branchId
      `);

    await tx.commit();
    return { day: { ...open, status: false }, closedShifts };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    throw err;
  }
}

export async function closeAndOpenBusinessDay(
  branchContext: ActiveBranchContext,
  options?: { forceCloseShifts?: boolean; openDate?: string },
): Promise<{ closedDay: BusinessDayRecord; openedDay: BusinessDayRecord; closedShifts: number }> {
  const closed = await closeBusinessDay(branchContext, {
    forceCloseShifts: options?.forceCloseShifts,
  });
  const opened = await openBusinessDay(branchContext, options?.openDate);
  return { closedDay: closed.day, openedDay: opened, closedShifts: closed.closedShifts };
}
