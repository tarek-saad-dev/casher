import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { ActiveBranchContext } from '@/lib/branch/types';
import { BranchDomainError } from '@/lib/branch/types';
import type { BusinessDayRecord } from '@/lib/branch/businessDay';
import { formatLegacyEndTime, mapDayRow, SHIFT_MOVE_SELECT } from './shiftMoveRecord';
import {
  lockBranchForDayMutation,
  lockCurrentOpenBusinessDay,
  tryLockCurrentOpenBusinessDay,
} from './businessDayLock';
import { AUTO_BUSINESS_DAY_ROLLOVER, BUSINESS_DAY_FORCE_CLOSE } from '../domain/invariants';
import { planBusinessDayReconciliation } from '../domain/businessDayReconciliation';
import {
  isPastRolloverWindow,
  resolveBusinessDate,
  now as businessClockNow,
} from '../clock/BusinessClock';

export type CloseBusinessDayResult = {
  day: BusinessDayRecord;
  closedShifts: number;
};

export type CloseAndOpenBusinessDayResult = {
  closedDay: BusinessDayRecord;
  openedDay: BusinessDayRecord;
  closedShifts: number;
};

export type ReconcileTrigger =
  | 'SCHEDULED'
  | 'STRICT_CATCH_UP'
  | 'BEST_EFFORT_CATCH_UP'
  | 'MANUAL_INTERNAL';

export type ReconcileBusinessDayResult = {
  branchId: number;
  action: 'NO_OP' | 'ROLLED_OVER' | 'OPENED_MISSING_DAY' | 'FAILED';
  previousBusinessDayId?: number;
  previousBusinessDate?: string;
  currentBusinessDayId?: number;
  currentBusinessDate?: string;
  closedShiftCount?: number;
  stale?: boolean;
  expectedBusinessDate?: string;
  openBusinessDayId?: number;
  openBusinessDate?: string;
  errorCode?: string;
  error?: string;
};

function mapDayUniqueIndexError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (
    /UX_TblNewDay_OneOpenPerBranch/i.test(message) ||
    /Cannot insert duplicate key/i.test(message)
  ) {
    throw new BranchDomainError(
      'ALREADY_OPEN_BUSINESS_DAY',
      'يوجد يوم عمل مفتوح بالفعل لهذا الفرع',
      400,
    );
  }
  throw err;
}

async function withDayMutationTx<T>(fn: (tx: sql.Transaction) => Promise<T>): Promise<T> {
  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    const result = await fn(tx);
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // ignore
    }
    mapDayUniqueIndexError(err);
  }
}

async function reopenOrInsertDay(
  tx: sql.Transaction,
  branchId: number,
  newDayDate: string,
): Promise<BusinessDayRecord> {
  const dup = await new sql.Request(tx)
    .input('branchId', sql.Int, branchId)
    .input('newDay', sql.Date, newDayDate)
    .query(`
      SELECT TOP 1 ID, BranchID, NewDay, Status
      FROM dbo.TblNewDay WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      WHERE BranchID = @branchId AND NewDay = @newDay
      ORDER BY ID DESC
    `);
  if (dup.recordset[0]) {
    const existing = mapDayRow(dup.recordset[0]);
    if (existing.status) {
      throw new BranchDomainError(
        'ALREADY_OPEN_BUSINESS_DAY',
        'يوجد يوم عمل بنفس التاريخ لهذا الفرع بالفعل',
        400,
      );
    }
    const reopened = await new sql.Request(tx)
      .input('id', sql.Int, existing.id)
      .input('branchId', sql.Int, branchId)
      .query(`
        UPDATE dbo.TblNewDay
        SET Status = 1
        OUTPUT INSERTED.ID, INSERTED.BranchID, INSERTED.NewDay, INSERTED.Status
        WHERE ID = @id AND BranchID = @branchId AND Status = 0
      `);
    if (!reopened.recordset[0]) {
      throw new BranchDomainError(
        'ALREADY_OPEN_BUSINESS_DAY',
        'يوجد يوم عمل مفتوح بالفعل لهذا الفرع',
        400,
      );
    }
    return mapDayRow(reopened.recordset[0]);
  }

  const inserted = await new sql.Request(tx)
    .input('branchId', sql.Int, branchId)
    .input('newDay', sql.Date, newDayDate)
    .query(`
      INSERT INTO dbo.TblNewDay (BranchID, NewDay, Status)
      OUTPUT INSERTED.ID, INSERTED.BranchID, INSERTED.NewDay, INSERTED.Status
      VALUES (@branchId, @newDay, 1)
    `);
  if (!inserted.recordset[0]) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'تعذر فتح يوم العمل', 400);
  }
  return mapDayRow(inserted.recordset[0]);
}

export async function openBusinessDayInTransaction(
  tx: sql.Transaction,
  args: { branchId: number; businessDate: string },
): Promise<BusinessDayRecord> {
  const open = await new sql.Request(tx)
    .input('branchId', sql.Int, args.branchId)
    .query(`
      SELECT TOP 1 ID, BranchID, NewDay, Status
      FROM dbo.TblNewDay WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      WHERE BranchID = @branchId AND Status = 1
      ORDER BY ID DESC
    `);
  if (open.recordset[0]) {
    const current = mapDayRow(open.recordset[0]);
    throw new BranchDomainError(
      'ALREADY_OPEN_BUSINESS_DAY',
      `يوجد يوم عمل مفتوح بالفعل لهذا الفرع (${current.newDay})`,
      400,
    );
  }
  return reopenOrInsertDay(tx, args.branchId, args.businessDate);
}

async function lockOpenShiftsForDay(
  tx: sql.Transaction,
  branchId: number,
  businessDayId: number,
): Promise<Record<string, unknown>[]> {
  const res = await new sql.Request(tx)
    .input('branchId', sql.Int, branchId)
    .input('businessDayId', sql.Int, businessDayId)
    .query(`
      SELECT
        ${SHIFT_MOVE_SELECT}
      FROM dbo.TblShiftMove sm WITH (UPDLOCK, HOLDLOCK, ROWLOCK)
      LEFT JOIN dbo.TblUser u ON u.UserID = sm.UserID
      LEFT JOIN dbo.TblShift s ON s.ShiftID = sm.ShiftID
      WHERE sm.Status = 1 AND sm.BranchID = @branchId AND sm.BusinessDayID = @businessDayId
      ORDER BY sm.ID
    `);
  return res.recordset;
}

async function forceCloseShiftsForDay(
  tx: sql.Transaction,
  branchId: number,
  businessDayId: number,
  reason: string,
  at?: Date,
): Promise<number> {
  const closedAt = at ?? businessClockNow();
  const upd = await new sql.Request(tx)
    .input('branchId', sql.Int, branchId)
    .input('businessDayId', sql.Int, businessDayId)
    .input('endDate', sql.Date, closedAt)
    .input('endTime', sql.NVarChar(50), formatLegacyEndTime(closedAt))
    .query(`
      UPDATE dbo.TblShiftMove
      SET Status = 0, EndDate = @endDate, EndTime = @endTime
      WHERE Status = 1 AND BranchID = @branchId AND BusinessDayID = @businessDayId;
      SELECT @@ROWCOUNT AS ClosedCount;
    `);
  const closed = Number(upd.recordset[0]?.ClosedCount ?? 0);
  console.warn(
    JSON.stringify({
      type: 'BRANCH_FORCE_CLOSE_SHIFTS',
      reason,
      branchId,
      businessDayId,
      closed,
      persistedCloseReason: false,
    }),
  );
  return closed;
}

export async function closeBusinessDayInTransaction(
  tx: sql.Transaction,
  args: {
    branchId: number;
    forceCloseShifts?: boolean;
    closeReason?: string;
    at?: Date;
  },
): Promise<CloseBusinessDayResult> {
  let day: BusinessDayRecord;
  try {
    day = await lockCurrentOpenBusinessDay(tx, { branchId: args.branchId });
  } catch (err) {
    if (err instanceof BranchDomainError && (err.code === 'NO_OPEN_DAY' || err.code === 'BUSINESS_DAY_CLOSED')) {
      throw new BranchDomainError(
        'BUSINESS_DAY_ALREADY_CLOSED',
        'لا يوجد يوم عمل مفتوح لإغلاقه',
        400,
      );
    }
    throw err;
  }

  return closeLockedOpenBusinessDay(tx, {
    branchId: args.branchId,
    day,
    forceCloseShifts: args.forceCloseShifts,
    closeReason: args.closeReason,
    at: args.at,
  });
}

async function closeLockedOpenBusinessDay(
  tx: sql.Transaction,
  args: {
    branchId: number;
    day: BusinessDayRecord;
    forceCloseShifts?: boolean;
    closeReason?: string;
    at?: Date;
  },
): Promise<CloseBusinessDayResult> {
  const openShifts = await lockOpenShiftsForDay(tx, args.branchId, args.day.id);
  if (openShifts.length > 0 && !args.forceCloseShifts) {
    const err = new BranchDomainError(
      'OPEN_SHIFTS',
      `يوجد ${openShifts.length} وردية مفتوحة في هذا الفرع`,
      400,
    ) as BranchDomainError & { openShifts: unknown[] };
    err.openShifts = openShifts;
    throw err;
  }

  let closedShifts = 0;
  if (openShifts.length > 0 && args.forceCloseShifts) {
    closedShifts = await forceCloseShiftsForDay(
      tx,
      args.branchId,
      args.day.id,
      args.closeReason || BUSINESS_DAY_FORCE_CLOSE,
      args.at,
    );
  }

  const closed = await new sql.Request(tx)
    .input('dayID', sql.Int, args.day.id)
    .input('branchId', sql.Int, args.branchId)
    .query(`
      UPDATE dbo.TblNewDay
      SET Status = 0
      OUTPUT INSERTED.ID, INSERTED.BranchID, INSERTED.NewDay, INSERTED.Status
      WHERE ID = @dayID AND BranchID = @branchId AND Status = 1
    `);
  if (!closed.recordset[0]) {
    throw new BranchDomainError(
      'BUSINESS_DAY_ALREADY_CLOSED',
      'لا يوجد يوم عمل مفتوح لإغلاقه',
      400,
    );
  }
  return { day: mapDayRow(closed.recordset[0]), closedShifts };
}

export async function executeOpenBusinessDay(
  branchContext: ActiveBranchContext,
  date?: string,
): Promise<BusinessDayRecord> {
  return withDayMutationTx(async (tx) => {
    await lockBranchForDayMutation(tx, branchContext.branchId);
    const businessDate = date || resolveBusinessDate(branchContext);
    return openBusinessDayInTransaction(tx, {
      branchId: branchContext.branchId,
      businessDate,
    });
  });
}

export async function executeCloseBusinessDay(
  branchContext: ActiveBranchContext,
  options?: { forceCloseShifts?: boolean },
): Promise<CloseBusinessDayResult> {
  return withDayMutationTx(async (tx) => {
    await lockBranchForDayMutation(tx, branchContext.branchId);
    return closeBusinessDayInTransaction(tx, {
      branchId: branchContext.branchId,
      forceCloseShifts: options?.forceCloseShifts,
    });
  });
}

export async function executeCloseAndOpenBusinessDay(
  branchContext: ActiveBranchContext,
  options?: { forceCloseShifts?: boolean; openDate?: string },
): Promise<CloseAndOpenBusinessDayResult> {
  return withDayMutationTx(async (tx) => {
    await lockBranchForDayMutation(tx, branchContext.branchId);
    const closed = await closeBusinessDayInTransaction(tx, {
      branchId: branchContext.branchId,
      forceCloseShifts: options?.forceCloseShifts,
    });
    const businessDate = options?.openDate || resolveBusinessDate(branchContext);
    const opened = await openBusinessDayInTransaction(tx, {
      branchId: branchContext.branchId,
      businessDate,
    });
    return { closedDay: closed.day, openedDay: opened, closedShifts: closed.closedShifts };
  });
}

export async function executeForceCloseBranchShifts(
  branchContext: ActiveBranchContext,
  reason: string,
): Promise<number> {
  return withDayMutationTx(async (tx) => {
    await lockBranchForDayMutation(tx, branchContext.branchId);
    let day: BusinessDayRecord;
    try {
      day = await lockCurrentOpenBusinessDay(tx, { branchId: branchContext.branchId });
    } catch (err) {
      if (err instanceof BranchDomainError && (err.code === 'NO_OPEN_DAY' || err.code === 'BUSINESS_DAY_CLOSED')) {
        return 0;
      }
      throw err;
    }
    await lockOpenShiftsForDay(tx, branchContext.branchId, day.id);
    return forceCloseShiftsForDay(
      tx,
      branchContext.branchId,
      day.id,
      reason || BUSINESS_DAY_FORCE_CLOSE,
    );
  });
}

export async function executeReconcileBusinessDay(args: {
  branchId: number;
  timeZone: string;
  businessDayCutoffTime: string;
  now?: Date;
  trigger: ReconcileTrigger;
}): Promise<ReconcileBusinessDayResult> {
  const at = args.now ?? businessClockNow();
  const clockBranch = {
    timeZone: args.timeZone,
    businessDayCutoffTime: args.businessDayCutoffTime,
  };
  const expectedDate = resolveBusinessDate(clockBranch, at);
  const pastRolloverWindow = isPastRolloverWindow(clockBranch, at);

  return withDayMutationTx(async (tx) => {
    await lockBranchForDayMutation(tx, args.branchId);
    const openDay = await tryLockCurrentOpenBusinessDay(tx, { branchId: args.branchId });
    const plan = planBusinessDayReconciliation({
      openDayDate: openDay?.newDay ?? null,
      expectedDate,
      pastRolloverWindow,
    });

    if (plan === 'NO_OP') {
      return {
        branchId: args.branchId,
        action: 'NO_OP' as const,
        previousBusinessDayId: openDay?.id,
        previousBusinessDate: openDay?.newDay,
        currentBusinessDayId: openDay?.id,
        currentBusinessDate: openDay?.newDay,
        closedShiftCount: 0,
      };
    }

    if (plan === 'OPENED_MISSING_DAY') {
      const opened = await openBusinessDayInTransaction(tx, {
        branchId: args.branchId,
        businessDate: expectedDate,
      });
      return {
        branchId: args.branchId,
        action: 'OPENED_MISSING_DAY' as const,
        currentBusinessDayId: opened.id,
        currentBusinessDate: opened.newDay,
        closedShiftCount: 0,
      };
    }

    if (!openDay) {
      throw new BranchDomainError(
        'NO_OPEN_DAY',
        'لا يوجد يوم عمل مفتوح لهذا الفرع — يجب فتح يوم أولاً',
        400,
      );
    }

    const closed = await closeLockedOpenBusinessDay(tx, {
      branchId: args.branchId,
      day: openDay,
      forceCloseShifts: true,
      closeReason: AUTO_BUSINESS_DAY_ROLLOVER,
      at,
    });
    const opened = await openBusinessDayInTransaction(tx, {
      branchId: args.branchId,
      businessDate: expectedDate,
    });
    return {
      branchId: args.branchId,
      action: 'ROLLED_OVER' as const,
      previousBusinessDayId: closed.day.id,
      previousBusinessDate: closed.day.newDay,
      currentBusinessDayId: opened.id,
      currentBusinessDate: opened.newDay,
      closedShiftCount: closed.closedShifts,
    };
  });
}
