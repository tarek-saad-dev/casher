import 'server-only';
import { sql, allocateInvID } from '@/lib/db';
import type { Transaction } from 'mssql';
import type { PostCommand } from '../public/moneyMovement';
import {
  allocateInvTypeSeed,
  resolveLegacyInOut,
  resolveLegacyInvType,
  type LegacyInvType,
} from './movementMapping';

export type CashMoveInsertInput = PostCommand & {
  reversalOfCashMoveId?: number | null;
};

/**
 * Sole Treasury-internal TblCashMove INSERT path for non-sale movements.
 */
export async function insertCashMoveRow(
  tx: Transaction,
  command: CashMoveInsertInput,
): Promise<number> {
  const invType: LegacyInvType = resolveLegacyInvType(command);
  const inOut = resolveLegacyInOut(command.direction);
  const invTime = command.invTime ?? new Date().toTimeString().slice(0, 8);
  const nextInvID = await allocateInvID(tx, 'TblCashMove', allocateInvTypeSeed(invType), 5000);

  let invDate = command.businessDate ?? null;
  if (!invDate) {
    const dayRes = await new sql.Request(tx)
      .input('businessDayId', sql.Int, command.businessDayId)
      .query(`SELECT TOP 1 NewDay FROM dbo.TblNewDay WHERE ID = @businessDayId`);
    invDate = dayRes.recordset[0]?.NewDay
      ? String(dayRes.recordset[0].NewDay).slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  }

  const result = await new sql.Request(tx)
    .input('invID', sql.Int, nextInvID)
    .input('invType', sql.NVarChar(20), invType)
    .input('invDate', sql.Date, invDate)
    .input('invTime', sql.NVarChar(50), invTime)
    .input('clientId', sql.Int, command.clientId ?? null)
    .input('expInId', sql.Int, command.categoryId ?? null)
    .input('amount', sql.Decimal(10, 2), command.amount)
    .input('inOut', sql.NVarChar(5), inOut)
    .input('notes', sql.NVarChar(sql.MAX), command.notes?.trim() || null)
    .input('shiftMoveId', sql.Int, command.shiftInstanceId)
    .input('paymentMethodId', sql.Int, command.paymentMethodId)
    .input('branchId', sql.Int, command.locationId)
    .input('businessDayId', sql.Int, command.businessDayId)
    .input('reversalOf', sql.Int, command.reversalOfCashMoveId ?? null)
    .query(`
      INSERT INTO dbo.TblCashMove (
        invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut,
        Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID,
        ReversalOfCashMoveId, IsReversed
      )
      OUTPUT INSERTED.ID
      VALUES (
        @invID, @invType, @invDate, @invTime, @clientId, @expInId, @amount, @inOut,
        @notes, @shiftMoveId, @paymentMethodId, @branchId, @businessDayId,
        @reversalOf, 0
      )
    `);

  return Number(result.recordset[0].ID);
}
