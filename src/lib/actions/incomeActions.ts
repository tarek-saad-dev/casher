/**
 * Income / revenue domain actions — single execution path.
 */

import { sql } from '@/lib/db';
import {
  deleteCashMoveWithLinkedLedgerEntries,
  type DeleteCashMoveWithLedgerResult,
} from '@/lib/services/cashMoveHardDeleteService';
import { reverseTreasuryOwnedMovement } from '@/apps/treasury/application/reverseTreasuryMovement';
import { buildStaffActorContext } from '@/lib/bookingSchedulingComposition';
import {
  assertLegacyBranchInTenant,
  isTenantContextError,
  requireActorTenantId,
} from '@/platform/tenant/tenantContext';
import { buildTreasuryWritePorts } from '@/lib/treasuryComposition';
import { syncEmployeeFundingFromCashMove } from '@/lib/services/employeeLedgerFundingSyncService';
import { liveCashMovePredicate } from '@/lib/treasury/liveCashMoveSql';
import { resolveLegacyBranchTenantId } from '@/platform/masterData/tenantScope';
import type { EmployeeFundingSyncResult } from '@/lib/services/employeeLedgerFundingSyncService';

export interface IncomeSnapshot {
  ID: number;
  invID: number | null;
  invDate: string | Date;
  invType: string;
  ExpINID: number;
  GrandTolal: number;
  PaymentMethodID: number;
  Notes: string | null;
  ShiftMoveID: number | null;
  BranchID: number;
  BusinessDayID: number | null;
  IsEmployeePayrollIncome?: boolean | number;
}

export interface UpdateIncomeInput {
  invDate: string;
  amount: number;
  expInId: number;
  paymentMethodId: number;
  notes?: string | null;
  shiftMoveId?: number | null;
  createdByUserId?: number | null;
}

export async function getIncomeSnapshot(
  transaction: sql.Transaction,
  id: number,
): Promise<IncomeSnapshot | null> {
  const result = await new sql.Request(transaction)
    .input('id', sql.Int, id)
    .query(`
      SELECT TOP 1
        ID, invID, invDate, invType, ExpINID, GrandTolal, PaymentMethodID,
        Notes, ShiftMoveID, BranchID, BusinessDayID,
        ISNULL(IsEmployeePayrollIncome, 0) AS IsEmployeePayrollIncome
      FROM dbo.TblCashMove
      WHERE ID = @id AND invType = N'ايرادات'
        AND ${liveCashMovePredicate()}
    `);
  return result.recordset[0] || null;
}

export interface UpdateIncomeResult {
  snapshot: IncomeSnapshot;
  fundingSync: EmployeeFundingSyncResult;
}

export async function updateIncome(
  transaction: sql.Transaction,
  id: number,
  input: UpdateIncomeInput,
  activeBranchId?: number,
): Promise<UpdateIncomeResult> {
  const exists = await getIncomeSnapshot(transaction, id);
  if (!exists) throw new Error('الإيراد غير موجود');
  if (
    activeBranchId != null &&
    Number(exists.BranchID) !== Number(activeBranchId)
  ) {
    throw new Error('غير موجود');
  }

  const parsedDate = new Date(input.invDate);
  if (isNaN(parsedDate.getTime())) throw new Error(`تاريخ غير صالح: ${input.invDate}`);

  const rowTenantId = await resolveLegacyBranchTenantId(Number(exists.BranchID), transaction);

  // Validate category
  const catRes = await new sql.Request(transaction)
    .input('expInId', sql.Int, input.expInId)
    .input('tenantId', sql.UniqueIdentifier, rowTenantId)
    .query(`SELECT 1 FROM dbo.TblExpINCat WHERE ExpINID = @expInId AND TenantId = @tenantId`);
  if (catRes.recordset.length === 0) throw new Error('تصنيف الإيراد غير موجود');

  // Validate payment method
  const pmRes = await new sql.Request(transaction)
    .input('pmId', sql.Int, input.paymentMethodId)
    .input('tenantId', sql.UniqueIdentifier, rowTenantId)
    .query(`SELECT 1 FROM dbo.TblPaymentMethods WHERE PaymentID = @pmId AND TenantId = @tenantId`);
  if (pmRes.recordset.length === 0) throw new Error('طريقة الدفع غير موجودة');

  await new sql.Request(transaction)
    .input('id', sql.Int, id)
    .input('invDate', sql.Date, parsedDate)
    .input('expInId', sql.Int, input.expInId)
    .input('amount', sql.Decimal(10, 2), input.amount)
    .input('notes', sql.NVarChar(sql.MAX), input.notes?.trim() || null)
    .input('paymentMethodId', sql.Int, input.paymentMethodId)
    .input('shiftMoveId', sql.Int, input.shiftMoveId ?? null)
    .query(`
      UPDATE dbo.TblCashMove
      SET
        invDate = @invDate,
        ExpINID = @expInId,
        GrandTolal = @amount,
        Notes = @notes,
        PaymentMethodID = @paymentMethodId,
        ShiftMoveID = COALESCE(@shiftMoveId, ShiftMoveID)
      WHERE ID = @id AND invType = N'ايرادات'
        AND ${liveCashMovePredicate()}
    `);

  const updated = await getIncomeSnapshot(transaction, id);
  if (!updated) throw new Error('فشل تحديث الإيراد');

  // Same sync as create — upsert/delete employee_funding so ledger stays in sync on edit
  const fundingSync = await syncEmployeeFundingFromCashMove(transaction, id, {
    createdByUserId: input.createdByUserId ?? null,
  });

  return { snapshot: updated, fundingSync };
}

export async function deleteIncome(
  transaction: sql.Transaction,
  id: number,
  activeBranchId: number | undefined,
  options: { tenantId: string; userId: number; idempotencyKey?: string },
): Promise<Extract<DeleteCashMoveWithLedgerResult, { deleted: true }>> {
  const existing = await getIncomeSnapshot(transaction, id);
  if (!existing) {
    throw new Error('الإيراد غير موجود أو تم حذفه');
  }
  if (
    activeBranchId != null &&
    Number(existing.BranchID) !== Number(activeBranchId)
  ) {
    throw new Error('غير موجود');
  }

  const actor = await buildStaffActorContext(options.userId, options.tenantId);
  const tenantId = requireActorTenantId(actor, 'deleteIncome');
  try {
    await assertLegacyBranchInTenant(tenantId, Number(existing.BranchID), { executor: transaction });
  } catch (err) {
    if (isTenantContextError(err)) throw new Error('غير موجود');
    throw err;
  }
  const owned = await new sql.Request(transaction)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('cashMoveId', sql.Int, id)
    .query(`
      SELECT TOP 1 IdempotencyKey FROM dbo.TreasuryMovementRegistry
      WHERE TenantId = @tenantId AND CashMoveId = @cashMoveId AND Kind <> 'reverse'
    `);

  if (owned.recordset.length > 0) {
    const ports = await buildTreasuryWritePorts(actor);
    const reversed = await reverseTreasuryOwnedMovement(transaction, ports, {
      cashMoveId: id,
      idempotencyKey: options.idempotencyKey ?? `income.reverse:${id}`,
      reason: 'delete',
    });
    return { deleted: true, ledgerDeletedCount: reversed.ledgerVoidedCount };
  }

  const result = await deleteCashMoveWithLinkedLedgerEntries(transaction, id);
  if (!result.deleted) {
    throw new Error('الإيراد غير موجود أو تم حذفه');
  }

  return result;
}
