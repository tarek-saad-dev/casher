import 'server-only';
import { NextResponse } from 'next/server';
import { sql, getPool } from '@/lib/db';
import type { ActiveBranchContext } from './types';
import { BranchDomainError } from './types';
import { getBusinessDayByDate } from './businessDay';
import type { BusinessDayRecord } from './businessDay';
import type { ShiftMoveRecord } from './shiftSession';

export type FinancialOwnership = {
  branchId: number;
  businessDayId: number;
};

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

export async function loadInvoiceOwnership(
  invId: number,
  invType: string = 'مبيعات',
  transaction?: sql.Transaction,
): Promise<{ branchId: number; businessDayId: number | null } | null> {
  const req = transaction ? new sql.Request(transaction) : (await getPool()).request();
  const result = await req
    .input('invID', sql.Int, invId)
    .input('invType', sql.NVarChar(20), invType)
    .query(`
      SELECT BranchID, BusinessDayID
      FROM dbo.TblinvServHead
      WHERE invID = @invID AND invType = @invType
    `);
  const row = result.recordset[0];
  if (!row) return null;
  return {
    branchId: Number(row.BranchID),
    businessDayId: row.BusinessDayID == null ? null : Number(row.BusinessDayID),
  };
}

export async function loadCashMoveOwnership(
  cashMoveId: number,
  transaction?: sql.Transaction,
): Promise<{ branchId: number; businessDayId: number | null } | null> {
  const req = transaction ? new sql.Request(transaction) : (await getPool()).request();
  const result = await req
    .input('id', sql.Int, cashMoveId)
    .query(`
      SELECT BranchID, BusinessDayID
      FROM dbo.TblCashMove
      WHERE ID = @id
    `);
  const row = result.recordset[0];
  if (!row) return null;
  return {
    branchId: Number(row.BranchID),
    businessDayId: row.BusinessDayID == null ? null : Number(row.BusinessDayID),
  };
}

export function assertActiveBranchOwns(
  activeBranchId: number,
  ownedBranchId: number | null | undefined,
): boolean {
  return ownedBranchId != null && Number(ownedBranchId) === Number(activeBranchId);
}
