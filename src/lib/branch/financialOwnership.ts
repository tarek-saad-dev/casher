import 'server-only';
import { NextResponse } from 'next/server';
import { sql, getPool } from '@/lib/db';
import type { ActiveBranchContext } from './types';
import { BranchDomainError } from './types';
import { getBusinessDayByDate } from './businessDay';
import type { BusinessDayRecord } from './businessDay';
import type { ShiftMoveRecord } from './shiftSession';
import { validateUserBranchAccess } from './access';
import {
  assertTransactionOwnershipConsistency,
  inferMutationScope,
  ownershipErrorResponse,
  rejectConflictingClientOwnership,
  type FinancialCommand,
  type FinancialOwnershipRecord,
  type HistoricalFinancialContext,
} from './financialOwnershipPolicy';

export type FinancialOwnership = {
  branchId: number;
  businessDayId: number;
  shiftMoveId?: number | null;
};

export type LoadedFinancialOwnership = FinancialOwnershipRecord & {
  shiftBranchId: number | null;
  shiftBusinessDayId: number | null;
};

export {
  currentFinancialOwnership,
  finalizeCurrentFinancialWrite,
  finalizeHistoricalFinancialWrite,
  historicalFinancialContext,
  ownershipErrorResponse,
  rejectClientOwnershipFields,
  rejectConflictingClientOwnership,
  assertTransactionOwnershipConsistency,
} from './financialOwnershipPolicy';
export type { FinancialCommand, FinancialOwnershipRecord, HistoricalFinancialContext };

/** Non-disclosing response for records outside the active branch. */
export function financialNotFoundResponse(): NextResponse {
  return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
}

export function assertShiftMatchesOwnership(
  shift: ShiftMoveRecord,
  ownership: FinancialOwnership,
): void {
  if (shift.branchId !== ownership.branchId) {
    throw new BranchDomainError(
      'SHIFT_BRANCH_MISMATCH',
      'الوردية لا تنتمي للفرع النشط',
      400,
    );
  }
  if (shift.businessDayId !== ownership.businessDayId) {
    throw new BranchDomainError(
      'SHIFT_DAY_MISMATCH',
      'الوردية لا تنتمي ليوم العمل النشط',
      400,
    );
  }
}

export function ownershipFromBranchDay(
  branch: ActiveBranchContext,
  day: BusinessDayRecord,
): FinancialOwnership {
  return { branchId: branch.branchId, businessDayId: day.id };
}

/**
 * Resolve business day for an allowed past-date write on the active branch.
 * Does not silently attach to the open day or create a day.
 */
export async function resolvePastDateBusinessDayForBranch(
  branchId: number,
  dateYmd: string,
): Promise<BusinessDayRecord | null> {
  return getBusinessDayByDate(branchId, dateYmd);
}

function mapLoadedRow(row: {
  BranchID: number;
  BusinessDayID: number | null;
  ShiftMoveID: number | null;
  invDate?: string | Date | null;
  ShiftBranchID?: number | null;
  ShiftBusinessDayID?: number | null;
}): LoadedFinancialOwnership {
  const shiftMoveId = row.ShiftMoveID == null ? null : Number(row.ShiftMoveID);
  const businessDate =
    row.invDate == null
      ? null
      : typeof row.invDate === 'string'
        ? row.invDate.slice(0, 10)
        : row.invDate.toISOString().slice(0, 10);
  return {
    scope: inferMutationScope(shiftMoveId),
    branchId: Number(row.BranchID),
    businessDayId: row.BusinessDayID == null ? null : Number(row.BusinessDayID),
    businessDate,
    shiftMoveId,
    shiftBranchId: row.ShiftBranchID == null ? null : Number(row.ShiftBranchID),
    shiftBusinessDayId: row.ShiftBusinessDayID == null ? null : Number(row.ShiftBusinessDayID),
  };
}

export async function loadInvoiceOwnership(
  invId: number,
  invType: string = 'مبيعات',
  transaction?: sql.Transaction,
): Promise<LoadedFinancialOwnership | null> {
  const req = transaction ? new sql.Request(transaction) : (await getPool()).request();
  const result = await req
    .input('invID', sql.Int, invId)
    .input('invType', sql.NVarChar(20), invType)
    .query(`
      SELECT
        h.BranchID,
        h.BusinessDayID,
        h.ShiftMoveID,
        h.invDate,
        sm.BranchID AS ShiftBranchID,
        sm.BusinessDayID AS ShiftBusinessDayID
      FROM dbo.TblinvServHead h
      LEFT JOIN dbo.TblShiftMove sm ON sm.ID = h.ShiftMoveID
      WHERE h.invID = @invID AND h.invType = @invType
    `);
  const row = result.recordset[0];
  if (!row) return null;
  return mapLoadedRow(row);
}

export async function loadCashMoveOwnership(
  cashMoveId: number,
  transaction?: sql.Transaction,
): Promise<LoadedFinancialOwnership | null> {
  const req = transaction ? new sql.Request(transaction) : (await getPool()).request();
  const result = await req
    .input('id', sql.Int, cashMoveId)
    .query(`
      SELECT
        cm.BranchID,
        cm.BusinessDayID,
        cm.ShiftMoveID,
        cm.invDate,
        sm.BranchID AS ShiftBranchID,
        sm.BusinessDayID AS ShiftBusinessDayID
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblShiftMove sm ON sm.ID = cm.ShiftMoveID
      WHERE cm.ID = @id
    `);
  const row = result.recordset[0];
  if (!row) return null;
  return mapLoadedRow(row);
}

export async function loadCashMoveOwnershipBatch(
  cashMoveIds: number[],
  transaction?: sql.Transaction,
): Promise<Map<number, LoadedFinancialOwnership>> {
  const out = new Map<number, LoadedFinancialOwnership>();
  const idList = cashMoveIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  if (idList.length === 0) return out;
  const req = transaction ? new sql.Request(transaction) : (await getPool()).request();
  const result = await req.query(`
      SELECT
        cm.ID,
        cm.BranchID,
        cm.BusinessDayID,
        cm.ShiftMoveID,
        cm.invDate,
        sm.BranchID AS ShiftBranchID,
        sm.BusinessDayID AS ShiftBusinessDayID
      FROM dbo.TblCashMove cm
      LEFT JOIN dbo.TblShiftMove sm ON sm.ID = cm.ShiftMoveID
      WHERE cm.ID IN (${idList.join(',')})
    `);
  for (const row of result.recordset) {
    out.set(Number(row.ID), mapLoadedRow(row));
  }
  return out;
}

export async function loadPurchaseOwnership(
  invId: number,
  transaction?: sql.Transaction,
): Promise<LoadedFinancialOwnership | null> {
  const req = transaction ? new sql.Request(transaction) : (await getPool()).request();
  const result = await req
    .input('invID', sql.Int, invId)
    .query(`
      SELECT
        h.BranchID,
        h.BusinessDayID,
        h.ShiftMoveID,
        h.invDate,
        sm.BranchID AS ShiftBranchID,
        sm.BusinessDayID AS ShiftBusinessDayID
      FROM dbo.TblinvPurchaseHead h
      LEFT JOIN dbo.TblShiftMove sm ON sm.ID = h.ShiftMoveID
      WHERE h.invID = @invID
    `);
  const row = result.recordset[0];
  if (!row) return null;
  return mapLoadedRow(row);
}

export type FinancialEntityKind = 'invoice' | 'cash_move' | 'purchase';

export async function loadFinancialEntityOwnership(
  entity: { kind: FinancialEntityKind; id: number; invType?: string },
  transaction?: sql.Transaction,
): Promise<LoadedFinancialOwnership | null> {
  if (entity.kind === 'invoice') {
    return loadInvoiceOwnership(entity.id, entity.invType ?? 'مبيعات', transaction);
  }
  if (entity.kind === 'purchase') {
    return loadPurchaseOwnership(entity.id, transaction);
  }
  return loadCashMoveOwnership(entity.id, transaction);
}

/**
 * Mutation gate: load stored BranchID + BusinessDayID + ShiftMoveID (one query),
 * assert shift/day consistency, then require operate access on the *record*
 * branch — never ViewBranch.
 *
 * Does not enforce closed-day immutability (Phase 6).
 */
export async function authorizeFinancialMutation(
  userId: number,
  ownership: LoadedFinancialOwnership,
  body?: unknown,
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const conflict = rejectConflictingClientOwnership(body, ownership);
  if (conflict) return { ok: false, response: ownershipErrorResponse(conflict) };

  const shiftRef =
    ownership.shiftMoveId != null && ownership.shiftBranchId != null
      ? { branchId: ownership.shiftBranchId, businessDayId: ownership.shiftBusinessDayId }
      : null;
  const mismatch = assertTransactionOwnershipConsistency(ownership, shiftRef);
  if (mismatch) return { ok: false, response: ownershipErrorResponse(mismatch) };

  try {
    const access = await validateUserBranchAccess(userId, ownership.branchId);
    if (!access.canOperate) return { ok: false, response: financialNotFoundResponse() };
  } catch (err) {
    if (err instanceof BranchDomainError) {
      return { ok: false, response: financialNotFoundResponse() };
    }
    throw err;
  }
  return { ok: true };
}

export async function loadAndAuthorizeFinancialMutation(
  userId: number,
  entity: { kind: FinancialEntityKind; id: number; invType?: string },
  body?: unknown,
): Promise<
  | { ok: true; ownership: LoadedFinancialOwnership }
  | { ok: false; response: NextResponse }
> {
  const ownership = await loadFinancialEntityOwnership(entity);
  if (!ownership) return { ok: false, response: financialNotFoundResponse() };
  const authz = await authorizeFinancialMutation(userId, ownership, body);
  if (!authz.ok) return authz;
  return { ok: true, ownership };
}

export function assertActiveBranchOwns(
  activeBranchId: number,
  ownedBranchId: number | null | undefined,
): boolean {
  return ownedBranchId != null && Number(ownedBranchId) === Number(activeBranchId);
}
