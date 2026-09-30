import 'server-only';
import { sql } from '@/lib/db';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import type { PostSaleCommand } from '../public/saleCashMove';
import {
  findRegistryByKey,
  insertRegistryRow,
  isRegistryUniqueViolation,
  TreasuryIdempotencyConflictError,
} from './idempotencyStore';
import { fingerprintSalePost } from './saleCommandFingerprint';
import { publishTreasuryOutboxEvent } from './treasuryOutbox';

/**
 * Treasury-owned POS sale CashMove insert.
 * Uses the sale invoice invID (not allocateInvID) to preserve legacy trigger semantics.
 */
export async function postSaleCashMove(
  tx: Transaction,
  _actor: ActorContext,
  command: PostSaleCommand,
): Promise<number> {
  if (!command.tenantId) {
    throw new Error('Treasury sale post requires tenantId');
  }
  if (!Number.isFinite(command.saleInvId) || command.saleInvId <= 0) {
    throw new Error('Treasury sale post requires a positive saleInvId');
  }
  if (!Number.isFinite(command.amount) || command.amount <= 0) {
    throw new Error('Treasury sale post amount must be positive');
  }
  if (!command.idempotencyKey?.trim()) {
    throw new Error('Treasury sale post requires idempotencyKey');
  }
  if (command.inOut !== 'in' && command.inOut !== 'out') {
    throw new Error('Treasury sale post inOut must be in or out');
  }

  const fingerprint = fingerprintSalePost(command);
  const existing = await findRegistryByKey(tx, command.tenantId, command.idempotencyKey);
  if (existing) {
    if (existing.Fingerprint !== fingerprint) {
      throw new TreasuryIdempotencyConflictError();
    }
    return existing.CashMoveId;
  }

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

  const cashMoveId = Number(result.recordset[0].ID);

  try {
    await insertRegistryRow(tx, {
      tenantId: command.tenantId,
      idempotencyKey: command.idempotencyKey,
      fingerprint,
      kind: 'sale',
      cashMoveId,
      sourceRef: command.sourceRef,
    });
  } catch (err) {
    if (isRegistryUniqueViolation(err)) {
      const replay = await findRegistryByKey(tx, command.tenantId, command.idempotencyKey);
      if (replay) {
        if (replay.Fingerprint !== fingerprint) throw new TreasuryIdempotencyConflictError();
        return replay.CashMoveId;
      }
    }
    throw err;
  }

  await publishTreasuryOutboxEvent(
    tx,
    command.tenantId,
    'treasury.sale.posted',
    {
      cashMoveId,
      tenantId: command.tenantId,
      saleInvId: command.saleInvId,
      invType: command.invType,
      locationId: command.branchId,
      businessDayId: command.businessDayId,
      shiftInstanceId: command.shiftMoveId,
      amount: command.amount,
      direction: command.inOut,
      sourceRef: command.sourceRef,
    },
    `treasury.sale.posted:${command.idempotencyKey}`,
  );

  return cashMoveId;
}
