import 'server-only';
import { sql } from '@/lib/db';
import type { Transaction } from 'mssql';
import type { PostSaleCommand } from '../public/saleCashMove';

/** Inserts a sale CashMove row only — no registry write. Used by replace after reversal. */
export async function insertSaleCashMoveRow(
  tx: Transaction,
  command: PostSaleCommand,
): Promise<number> {
  const invDate =
    command.invDate instanceof Date
      ? command.invDate.toISOString().slice(0, 10)
      : String(command.invDate).slice(0, 10);

  const result = await new sql.Request(tx)
    .input('invID', sql.Int, command.saleInvId)
    .input('invType', sql.NVarChar(20), command.invType)
    .input('invDate', sql.Date, invDate)
    .input('invTime', sql.NVarChar(50), command.invTime)
    .input('clientId', sql.Int, command.clientId)
    .input('amount', sql.Decimal(10, 2), command.amount)
    .input('inOut', sql.NVarChar(5), command.inOut)
    .input('notes', sql.NVarChar(sql.MAX), command.notes?.trim() || null)
    .input('shiftMoveId', sql.Int, command.shiftMoveId)
    .input('paymentMethodId', sql.Int, command.paymentMethodId)
    .input('branchId', sql.Int, command.branchId)
    .input('businessDayId', sql.Int, command.businessDayId)
    .query(`
      INSERT INTO dbo.TblCashMove (
        invID, invType, invDate, invTime, ClientID, GrandTolal, inOut,
        Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID
      )
      OUTPUT INSERTED.ID
      VALUES (
        @invID, @invType, @invDate, @invTime, @clientId, @amount, @inOut,
        @notes, @shiftMoveId, @paymentMethodId, @branchId, @businessDayId
      )
    `);

  const cashMoveId = Number(result.recordset[0]?.ID);
  if (!Number.isFinite(cashMoveId) || cashMoveId <= 0) {
    throw new Error('Treasury sale CashMove insert did not return an id');
  }
  return cashMoveId;
}
