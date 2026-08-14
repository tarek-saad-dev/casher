import 'server-only';

import { getPool, sql } from '@/lib/db';
import {
  isEmpBranchWorkDayCloseState,
  PAYROLL_DAY_CLOSED_CODE,
  PAYROLL_DAY_CLOSED_MESSAGE,
  planCloseWhenReadinessReady,
  planEmpBranchWorkDayCloseTransition,
  validateWorkDateYmd,
} from '@/lib/hr/empBranchWorkDayClose.transitions';
import {
  EmpBranchWorkDayCloseError,
  type EmpBranchWorkDayCloseRow,
  type EmpBranchWorkDayCloseState,
  type EmpBranchWorkDayCloseTransitionInput,
  type EmpBranchWorkDayCloseView,
} from '@/lib/hr/empBranchWorkDayClose.types';

function formatDateValue(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(value ?? '').slice(0, 10);
}

function formatDateTimeValue(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function mapRow(row: Record<string, unknown>): EmpBranchWorkDayCloseRow {
  const stateRaw = String(row.State ?? 'OPEN');
  if (!isEmpBranchWorkDayCloseState(stateRaw)) {
    throw new EmpBranchWorkDayCloseError(
      'INVALID_STATE',
      `حالة غير معروفة في الداتا: ${stateRaw}`,
    );
  }
  return {
    id: Number(row.ID),
    branchId: Number(row.BranchID),
    workDate: formatDateValue(row.WorkDate),
    state: stateRaw,
    closedAt: formatDateTimeValue(row.ClosedAt),
    closedByUserId: row.ClosedByUserID == null ? null : Number(row.ClosedByUserID),
    reopenedAt: formatDateTimeValue(row.ReopenedAt),
    reopenedByUserId:
      row.ReopenedByUserID == null ? null : Number(row.ReopenedByUserID),
    reopenReason: (row.ReopenReason as string | null) ?? null,
    createdAt: formatDateTimeValue(row.CreatedAt) ?? '',
    updatedAt: formatDateTimeValue(row.UpdatedAt) ?? '',
    createdByUserId:
      row.CreatedByUserID == null ? null : Number(row.CreatedByUserID),
    updatedByUserId:
      row.UpdatedByUserID == null ? null : Number(row.UpdatedByUserID),
  };
}

function virtualOpenView(branchId: number, workDate: string): EmpBranchWorkDayCloseView {
  return {
    branchId,
    workDate,
    state: 'OPEN',
    isVirtualOpen: true,
    row: null,
  };
}

function viewFromRow(row: EmpBranchWorkDayCloseRow): EmpBranchWorkDayCloseView {
  return {
    branchId: row.branchId,
    workDate: row.workDate,
    state: row.state,
    isVirtualOpen: false,
    row,
  };
}

function assertBranchId(branchId: number): void {
  if (!Number.isFinite(branchId) || branchId <= 0) {
    throw new EmpBranchWorkDayCloseError('INVALID_BRANCH', 'معرف الفرع غير صالح');
  }
}

function assertWorkDate(workDate: string): void {
  const err = validateWorkDateYmd(workDate);
  if (err) throw new EmpBranchWorkDayCloseError('INVALID_WORK_DATE', err);
}

/**
 * Read closing state for BranchID + WorkDate.
 * Missing row ⇒ OPEN (isVirtualOpen=true).
 */
export async function getEmpBranchWorkDayCloseState(
  branchId: number,
  workDate: string,
): Promise<EmpBranchWorkDayCloseView> {
  assertBranchId(branchId);
  assertWorkDate(workDate);

  const db = await getPool();
  const result = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT TOP 1
        ID, BranchID, WorkDate, State,
        ClosedAt, ClosedByUserID,
        ReopenedAt, ReopenedByUserID, ReopenReason,
        CreatedAt, UpdatedAt, CreatedByUserID, UpdatedByUserID
      FROM dbo.TblEmpBranchWorkDayClose
      WHERE BranchID = @branchId AND WorkDate = @workDate
    `);

  const raw = result.recordset[0] as Record<string, unknown> | undefined;
  if (!raw) return virtualOpenView(branchId, workDate);
  return viewFromRow(mapRow(raw));
}

/**
 * Apply a validated state transition. Creates the row on first transition from virtual OPEN.
 * Does not auto-close, does not touch payroll/ledger.
 */
export async function transitionEmpBranchWorkDayClose(
  input: EmpBranchWorkDayCloseTransitionInput,
): Promise<EmpBranchWorkDayCloseView> {
  assertBranchId(input.branchId);
  assertWorkDate(input.workDate);

  const current = await getEmpBranchWorkDayCloseState(input.branchId, input.workDate);
  const patch = planEmpBranchWorkDayCloseTransition({
    from: current.state,
    to: input.toState,
    actorUserId: input.actorUserId,
    reopenReason: input.reopenReason,
  });

  const db = await getPool();
  const now = new Date();

  const nextClosedAt =
    patch.closedAt === 'now'
      ? now
      : patch.closedAt === 'clear'
        ? null
        : current.row?.closedAt
          ? new Date(current.row.closedAt)
          : null;
  const nextClosedBy =
    patch.closedByUserId === 'keep'
      ? current.row?.closedByUserId ?? null
      : patch.closedByUserId === null
        ? null
        : patch.closedByUserId;

  const nextReopenedAt =
    patch.reopenedAt === 'now'
      ? now
      : patch.reopenedAt === 'clear'
        ? null
        : current.row?.reopenedAt
          ? new Date(current.row.reopenedAt)
          : null;
  const nextReopenedBy =
    patch.reopenedByUserId === 'keep'
      ? current.row?.reopenedByUserId ?? null
      : patch.reopenedByUserId === null
        ? null
        : patch.reopenedByUserId;
  const nextReopenReason =
    patch.reopenReason === 'keep'
      ? current.row?.reopenReason ?? null
      : patch.reopenReason ?? null;

  if (current.isVirtualOpen || !current.row) {
    const insert = await db
      .request()
      .input('branchId', sql.Int, input.branchId)
      .input('workDate', sql.Date, input.workDate)
      .input('state', sql.NVarChar(20), patch.state)
      .input('closedAt', sql.DateTime2, nextClosedAt)
      .input('closedByUserId', sql.Int, nextClosedBy)
      .input('reopenedAt', sql.DateTime2, nextReopenedAt)
      .input('reopenedByUserId', sql.Int, nextReopenedBy)
      .input('reopenReason', sql.NVarChar(500), nextReopenReason)
      .input('actorUserId', sql.Int, input.actorUserId)
      .query(`
        INSERT INTO dbo.TblEmpBranchWorkDayClose (
          BranchID, WorkDate, State,
          ClosedAt, ClosedByUserID,
          ReopenedAt, ReopenedByUserID, ReopenReason,
          CreatedByUserID, UpdatedByUserID, CreatedAt, UpdatedAt
        )
        OUTPUT
          INSERTED.ID, INSERTED.BranchID, INSERTED.WorkDate, INSERTED.State,
          INSERTED.ClosedAt, INSERTED.ClosedByUserID,
          INSERTED.ReopenedAt, INSERTED.ReopenedByUserID, INSERTED.ReopenReason,
          INSERTED.CreatedAt, INSERTED.UpdatedAt,
          INSERTED.CreatedByUserID, INSERTED.UpdatedByUserID
        VALUES (
          @branchId, @workDate, @state,
          @closedAt, @closedByUserId,
          @reopenedAt, @reopenedByUserId, @reopenReason,
          @actorUserId, @actorUserId, SYSUTCDATETIME(), SYSUTCDATETIME()
        )
      `);
    return viewFromRow(mapRow(insert.recordset[0] as Record<string, unknown>));
  }

  // Optimistic concurrency: update only if State still matches expected from.
  const update = await db
    .request()
    .input('id', sql.Int, current.row.id)
    .input('expectedState', sql.NVarChar(20), current.state)
    .input('state', sql.NVarChar(20), patch.state)
    .input('closedAt', sql.DateTime2, nextClosedAt)
    .input('closedByUserId', sql.Int, nextClosedBy)
    .input('reopenedAt', sql.DateTime2, nextReopenedAt)
    .input('reopenedByUserId', sql.Int, nextReopenedBy)
    .input('reopenReason', sql.NVarChar(500), nextReopenReason)
    .input('actorUserId', sql.Int, input.actorUserId)
    .query(`
      UPDATE dbo.TblEmpBranchWorkDayClose
      SET
        State = @state,
        ClosedAt = @closedAt,
        ClosedByUserID = @closedByUserId,
        ReopenedAt = @reopenedAt,
        ReopenedByUserID = @reopenedByUserId,
        ReopenReason = @reopenReason,
        UpdatedByUserID = @actorUserId,
        UpdatedAt = SYSUTCDATETIME()
      OUTPUT
        INSERTED.ID, INSERTED.BranchID, INSERTED.WorkDate, INSERTED.State,
        INSERTED.ClosedAt, INSERTED.ClosedByUserID,
        INSERTED.ReopenedAt, INSERTED.ReopenedByUserID, INSERTED.ReopenReason,
        INSERTED.CreatedAt, INSERTED.UpdatedAt,
        INSERTED.CreatedByUserID, INSERTED.UpdatedByUserID
      WHERE ID = @id AND State = @expectedState
    `);

  if (!update.recordset[0]) {
    throw new EmpBranchWorkDayCloseError(
      'CONCURRENT_MODIFICATION',
      'تم تغيير حالة اليوم من عملية أخرى — أعد المحاولة',
    );
  }

  return viewFromRow(mapRow(update.recordset[0] as Record<string, unknown>));
}

/** Convenience: set state when caller already validated readiness externally (Phase 2+). */
export async function setEmpBranchWorkDayCloseState(
  input: EmpBranchWorkDayCloseTransitionInput,
): Promise<EmpBranchWorkDayCloseView> {
  return transitionEmpBranchWorkDayClose(input);
}

/**
 * Block mutations that change earned payroll/target results for a CLOSED branch/day.
 * Does not block later payout/advance ledger cash operations.
 */
export async function assertEmpBranchWorkDayMutable(
  branchId: number,
  workDate: string,
): Promise<void> {
  const view = await getEmpBranchWorkDayCloseState(branchId, workDate);
  if (view.state === 'CLOSED') {
    throw new EmpBranchWorkDayCloseError(
      PAYROLL_DAY_CLOSED_CODE,
      PAYROLL_DAY_CLOSED_MESSAGE,
    );
  }
}

/**
 * Atomic persist of CLOSED after caller verified readiness.
 * Concurrent duplicate close → PAYROLL_DAY_CLOSED.
 */
export async function persistEmpBranchWorkDayClosed(args: {
  branchId: number;
  workDate: string;
  actorUserId: number;
}): Promise<EmpBranchWorkDayCloseView> {
  assertBranchId(args.branchId);
  assertWorkDate(args.workDate);

  const current = await getEmpBranchWorkDayCloseState(args.branchId, args.workDate);
  planCloseWhenReadinessReady({
    from: current.state,
    actorUserId: args.actorUserId,
    readinessVerified: true,
  });

  const db = await getPool();
  const now = new Date();
  const nextReopenedAt = current.row?.reopenedAt
    ? new Date(current.row.reopenedAt)
    : null;
  const nextReopenedBy = current.row?.reopenedByUserId ?? null;
  const nextReopenReason = current.row?.reopenReason ?? null;

  if (current.isVirtualOpen || !current.row) {
    try {
      const insert = await db
        .request()
        .input('branchId', sql.Int, args.branchId)
        .input('workDate', sql.Date, args.workDate)
        .input('state', sql.NVarChar(20), 'CLOSED')
        .input('closedAt', sql.DateTime2, now)
        .input('closedByUserId', sql.Int, args.actorUserId)
        .input('reopenedAt', sql.DateTime2, nextReopenedAt)
        .input('reopenedByUserId', sql.Int, nextReopenedBy)
        .input('reopenReason', sql.NVarChar(500), nextReopenReason)
        .input('actorUserId', sql.Int, args.actorUserId)
        .query(`
          INSERT INTO dbo.TblEmpBranchWorkDayClose (
            BranchID, WorkDate, State,
            ClosedAt, ClosedByUserID,
            ReopenedAt, ReopenedByUserID, ReopenReason,
            CreatedByUserID, UpdatedByUserID, CreatedAt, UpdatedAt
          )
          OUTPUT
            INSERTED.ID, INSERTED.BranchID, INSERTED.WorkDate, INSERTED.State,
            INSERTED.ClosedAt, INSERTED.ClosedByUserID,
            INSERTED.ReopenedAt, INSERTED.ReopenedByUserID, INSERTED.ReopenReason,
            INSERTED.CreatedAt, INSERTED.UpdatedAt,
            INSERTED.CreatedByUserID, INSERTED.UpdatedByUserID
          VALUES (
            @branchId, @workDate, @state,
            @closedAt, @closedByUserId,
            @reopenedAt, @reopenedByUserId, @reopenReason,
            @actorUserId, @actorUserId, SYSUTCDATETIME(), SYSUTCDATETIME()
          )
        `);
      return viewFromRow(mapRow(insert.recordset[0] as Record<string, unknown>));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/unique|duplicate|2627|2601/i.test(msg)) {
        throw new EmpBranchWorkDayCloseError(
          PAYROLL_DAY_CLOSED_CODE,
          'يوم الموظفين مقفل بالفعل لهذا الفرع والتاريخ',
        );
      }
      throw err;
    }
  }

  const update = await db
    .request()
    .input('id', sql.Int, current.row.id)
    .input('closedAt', sql.DateTime2, now)
    .input('closedByUserId', sql.Int, args.actorUserId)
    .input('actorUserId', sql.Int, args.actorUserId)
    .query(`
      UPDATE dbo.TblEmpBranchWorkDayClose
      SET
        State = N'CLOSED',
        ClosedAt = @closedAt,
        ClosedByUserID = @closedByUserId,
        UpdatedByUserID = @actorUserId,
        UpdatedAt = SYSUTCDATETIME()
      OUTPUT
        INSERTED.ID, INSERTED.BranchID, INSERTED.WorkDate, INSERTED.State,
        INSERTED.ClosedAt, INSERTED.ClosedByUserID,
        INSERTED.ReopenedAt, INSERTED.ReopenedByUserID, INSERTED.ReopenReason,
        INSERTED.CreatedAt, INSERTED.UpdatedAt,
        INSERTED.CreatedByUserID, INSERTED.UpdatedByUserID
      WHERE ID = @id AND State <> N'CLOSED'
    `);

  if (!update.recordset[0]) {
    throw new EmpBranchWorkDayCloseError(
      PAYROLL_DAY_CLOSED_CODE,
      'يوم الموظفين مقفل بالفعل لهذا الفرع والتاريخ',
    );
  }

  return viewFromRow(mapRow(update.recordset[0] as Record<string, unknown>));
}

/**
 * Reopen a CLOSED branch/day. Requires non-empty reason. Does not auto-close again.
 */
export async function reopenEmpBranchWorkDay(args: {
  branchId: number;
  workDate: string;
  actorUserId: number;
  reopenReason: string;
}): Promise<EmpBranchWorkDayCloseView> {
  return transitionEmpBranchWorkDayClose({
    branchId: args.branchId,
    workDate: args.workDate,
    toState: 'REOPENED',
    actorUserId: args.actorUserId,
    reopenReason: args.reopenReason,
  });
}

export type { EmpBranchWorkDayCloseState };
