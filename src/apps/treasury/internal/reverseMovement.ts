import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import type { ActorContext } from '@/platform/public';
import type { ReverseCommand } from '../public/moneyMovement';
import { insertCashMoveRow } from './cashMoveInsert';
import { fingerprintReverse } from './commandFingerprint';
import {
  findRegistryByKey,
  insertRegistryRow,
  isRegistryUniqueViolation,
  TreasuryIdempotencyConflictError,
} from './idempotencyStore';
import { buildReversalPosting } from './reversalPosting';
import { publishTreasuryOutboxEvent } from './treasuryOutbox';

type OriginalMovement = {
  ID: number;
  BranchID: number;
  BusinessDayID: number | null;
  ShiftMoveID: number | null;
  GrandTolal: number;
  inOut: string;
  invType: string;
  ExpINID: number | null;
  PaymentMethodID: number | null;
  Notes: string | null;
  IsReversed: boolean | number;
};

async function loadOriginalByIdempotency(
  tx: Transaction,
  tenantId: string,
  originalIdempotencyKey: string,
): Promise<{ registry: Awaited<ReturnType<typeof findRegistryByKey>>; movement: OriginalMovement }> {
  const registry = await findRegistryByKey(tx, tenantId, originalIdempotencyKey);
  if (!registry) {
    throw new Error('Original treasury movement not found for reversal');
  }

  const result = await new sql.Request(tx)
    .input('id', sql.Int, registry.CashMoveId)
    .query(`
      SELECT TOP 1
        ID, BranchID, BusinessDayID, ShiftMoveID, GrandTolal, inOut, invType,
        ExpINID, PaymentMethodID, Notes, ISNULL(IsReversed, 0) AS IsReversed
      FROM dbo.TblCashMove
      WHERE ID = @id
    `);
  const movement = result.recordset[0] as OriginalMovement | undefined;
  if (!movement) {
    throw new Error('Original cash movement row missing');
  }
  return { registry, movement };
}

export async function reverseMoneyMovement(
  tx: Transaction,
  _actor: ActorContext,
  command: ReverseCommand,
): Promise<number> {
  if (!command.tenantId) throw new Error('Treasury reverse requires tenantId');
  if (!command.idempotencyKey?.trim()) throw new Error('Treasury reverse requires idempotencyKey');
  if (!command.originalIdempotencyKey?.trim()) {
    throw new Error('Treasury reverse requires originalIdempotencyKey');
  }

  const fingerprint = fingerprintReverse(command);
  const existingReverse = await findRegistryByKey(tx, command.tenantId, command.idempotencyKey);
  if (existingReverse) {
    if (existingReverse.Fingerprint !== fingerprint) {
      throw new TreasuryIdempotencyConflictError();
    }
    return existingReverse.CashMoveId;
  }

  const { registry, movement } = await loadOriginalByIdempotency(
    tx,
    command.tenantId,
    command.originalIdempotencyKey,
  );

  if (movement.IsReversed === true || movement.IsReversed === 1) {
    const priorReverse = await new sql.Request(tx)
      .input('originalId', sql.Int, movement.ID)
      .query(`
        SELECT TOP 1 ID FROM dbo.TblCashMove
        WHERE ReversalOfCashMoveId = @originalId
        ORDER BY ID DESC
      `);
    const reversalId = priorReverse.recordset[0]?.ID;
    if (reversalId) return Number(reversalId);
    throw new Error('Original movement already reversed but reversal row missing');
  }

  const posting = buildReversalPosting({
    inOut: movement.inOut,
    invType: movement.invType,
    amount: Number(movement.GrandTolal),
  });
  const reversalCashMoveId = await insertCashMoveRow(tx, {
    tenantId: command.tenantId,
    locationId: Number(movement.BranchID),
    businessDayId: Number(movement.BusinessDayID),
    shiftInstanceId: movement.ShiftMoveID != null ? Number(movement.ShiftMoveID) : null,
    amount: Math.abs(posting.storedAmount),
    direction: posting.direction,
    reason: command.reason || 'reversal',
    sourceRef: registry.SourceRef ?? command.originalIdempotencyKey,
    paymentMethodId: movement.PaymentMethodID != null ? Number(movement.PaymentMethodID) : null,
    idempotencyKey: command.idempotencyKey,
    categoryId: movement.ExpINID,
    notes: movement.Notes ? `[reversal] ${movement.Notes}` : '[reversal]',
    invType: posting.invType,
    reversalOfCashMoveId: movement.ID,
    negateAmount: true,
  });

  await new sql.Request(tx)
    .input('id', sql.Int, movement.ID)
    .query(`UPDATE dbo.TblCashMove SET IsReversed = 1 WHERE ID = @id`);

  try {
    await insertRegistryRow(tx, {
      tenantId: command.tenantId,
      idempotencyKey: command.idempotencyKey,
      fingerprint,
      kind: 'reverse',
      cashMoveId: reversalCashMoveId,
      originalIdempotencyKey: command.originalIdempotencyKey,
      sourceRef: registry.SourceRef ?? command.originalIdempotencyKey,
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
    'treasury.movement.reversed',
    {
      cashMoveId: reversalCashMoveId,
      originalCashMoveId: movement.ID,
      originalIdempotencyKey: command.originalIdempotencyKey,
      tenantId: command.tenantId,
      reason: command.reason,
    },
    `treasury.movement.reversed:${command.idempotencyKey}`,
  );

  return reversalCashMoveId;
}

/** Reverse by cash move ID when registry key is derived from the row. */
export async function reverseMoneyMovementByCashMoveId(
  tx: Transaction,
  actor: ActorContext,
  input: {
    tenantId: string;
    cashMoveId: number;
    idempotencyKey: string;
    reason?: string;
  },
): Promise<number> {
  const registryResult = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('cashMoveId', sql.Int, input.cashMoveId)
    .query(`
      SELECT TOP 1 IdempotencyKey FROM dbo.TreasuryMovementRegistry
      WHERE TenantId = @tenantId AND CashMoveId = @cashMoveId AND Kind <> 'reverse'
      ORDER BY Id
    `);
  const originalKey = registryResult.recordset[0]?.IdempotencyKey;
  if (!originalKey) {
    throw new Error('Movement is not treasury-owned — cannot reverse through Treasury port');
  }

  return reverseMoneyMovement(tx, actor, {
    tenantId: input.tenantId,
    originalIdempotencyKey: String(originalKey),
    idempotencyKey: input.idempotencyKey,
    reason: input.reason ?? 'delete',
  });
}
