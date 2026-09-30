import 'server-only';
import { sql } from '@/lib/db';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import type { PostSaleCommand } from '../public/saleCashMove';
import {
  findRegistryByKey,
  TreasuryIdempotencyConflictError,
} from './idempotencyStore';
import { fingerprintSalePost } from './saleCommandFingerprint';
import { publishTreasuryOutboxEvent } from './treasuryOutbox';

const SALE_POST_SAVEPOINT = 'drvo_sale_post';

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

  return insertSaleCashMoveResolvingConflict(tx, command);
}

/**
 * Inserts the sale CashMove and registry row under a savepoint.
 * A registry unique violation rolls the new CashMove back before returning the
 * existing CashMoveId, so a later commit cannot keep an unregistered duplicate.
 * Call this when the pre-check missed a committed or concurrent registry row.
 */
export async function insertSaleCashMoveResolvingConflict(
  tx: Transaction,
  command: PostSaleCommand,
): Promise<number> {
  const fingerprint = fingerprintSalePost(command);
  const invDate =
    command.invDate instanceof Date
      ? command.invDate.toISOString().slice(0, 10)
      : String(command.invDate).slice(0, 10);

  const result = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, command.tenantId)
    .input('key', sql.NVarChar(256), command.idempotencyKey)
    .input('fingerprint', sql.NVarChar(128), fingerprint)
    .input('sourceRef', sql.NVarChar(256), command.sourceRef)
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
      DECLARE @cashMoveId INT = NULL;
      DECLARE @existingCashMoveId INT = NULL;
      DECLARE @existingFingerprint NVARCHAR(128) = NULL;
      DECLARE @outcome NVARCHAR(16) = N'inserted';
      DECLARE @inserted TABLE (ID INT);

      SAVE TRANSACTION ${SALE_POST_SAVEPOINT};

      BEGIN TRY
        INSERT INTO dbo.TblCashMove (
          invID, invType, invDate, invTime, ClientID, GrandTolal, inOut,
          Notes, ShiftMoveID, PaymentMethodID, BranchID, BusinessDayID
        )
        OUTPUT INSERTED.ID INTO @inserted (ID)
        VALUES (
          @invID, @invType, @invDate, @invTime, @clientId, @amount, @inOut,
          @notes, @shiftMoveId, @paymentMethodId, @branchId, @businessDayId
        );

        SELECT @cashMoveId = ID FROM @inserted;

        INSERT INTO dbo.TreasuryMovementRegistry (
          TenantId, IdempotencyKey, Fingerprint, Kind, CashMoveId,
          TransferGroupKey, OriginalIdempotencyKey, SourceRef
        )
        VALUES (
          @tenantId, @key, @fingerprint, N'sale', @cashMoveId,
          NULL, NULL, @sourceRef
        );
      END TRY
      BEGIN CATCH
        IF ERROR_NUMBER() IN (2601, 2627)
        BEGIN
          IF XACT_STATE() <> 1
            THROW;
          ROLLBACK TRANSACTION ${SALE_POST_SAVEPOINT};
          SELECT
            @existingCashMoveId = CashMoveId,
            @existingFingerprint = Fingerprint
          FROM dbo.TreasuryMovementRegistry WITH (UPDLOCK, HOLDLOCK)
          WHERE TenantId = @tenantId AND IdempotencyKey = @key;

          IF @existingCashMoveId IS NULL
            THROW 50001, 'Treasury sale registry conflict did not resolve to an existing row', 1;

          SET @outcome = N'replay';
          SET @cashMoveId = @existingCashMoveId;
        END
        ELSE
        BEGIN
          IF XACT_STATE() = 1
            ROLLBACK TRANSACTION ${SALE_POST_SAVEPOINT};
          THROW;
        END
      END CATCH

      SELECT
        @outcome AS Outcome,
        @cashMoveId AS CashMoveId,
        @existingFingerprint AS ExistingFingerprint;
    `);

  const row = result.recordset[0] as
    | { Outcome?: string; CashMoveId?: number; ExistingFingerprint?: string | null }
    | undefined;
  const outcome = String(row?.Outcome ?? '').trim();
  const cashMoveId = Number(row?.CashMoveId);
  if (!row || !Number.isFinite(cashMoveId) || cashMoveId <= 0) {
    throw new Error('Treasury sale post did not return a CashMove id');
  }

  if (outcome === 'replay') {
    if (String(row.ExistingFingerprint ?? '') !== fingerprint) {
      throw new TreasuryIdempotencyConflictError();
    }
    return cashMoveId;
  }

  if (outcome !== 'inserted') {
    throw new Error(`Treasury sale post returned unexpected outcome ${outcome || '(empty)'}`);
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
