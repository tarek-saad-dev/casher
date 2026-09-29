import 'server-only';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import type { PostCommand } from '../public/moneyMovement';
import { insertCashMoveRow } from './cashMoveInsert';
import { fingerprintPost } from './commandFingerprint';
import {
  findRegistryByKey,
  insertRegistryRow,
  isRegistryUniqueViolation,
  TreasuryIdempotencyConflictError,
} from './idempotencyStore';
import { isSaleReason } from './movementMapping';
import { publishTreasuryOutboxEvent } from './treasuryOutbox';

export async function postMoneyMovement(
  tx: Transaction,
  _actor: ActorContext,
  command: PostCommand,
): Promise<number> {
  if (isSaleReason(command.reason)) {
    throw new Error(
      'Sale cash is posted by InsCashMoveSales — Treasury.post must not run for sales while the trigger is live',
    );
  }

  if (!command.tenantId) {
    throw new Error('Treasury post requires tenantId');
  }
  if (!Number.isFinite(command.amount) || command.amount <= 0) {
    throw new Error('Treasury post amount must be positive');
  }
  if (!command.idempotencyKey?.trim()) {
    throw new Error('Treasury post requires idempotencyKey');
  }

  const fingerprint = fingerprintPost(command);
  const existing = await findRegistryByKey(tx, command.tenantId, command.idempotencyKey);
  if (existing) {
    if (existing.Fingerprint !== fingerprint) {
      throw new TreasuryIdempotencyConflictError();
    }
    return existing.CashMoveId;
  }

  const cashMoveId = await insertCashMoveRow(tx, command);

  try {
    await insertRegistryRow(tx, {
      tenantId: command.tenantId,
      idempotencyKey: command.idempotencyKey,
      fingerprint,
      kind: command.transferGroupKey ? command.reason : 'post',
      cashMoveId,
      transferGroupKey: command.transferGroupKey ?? null,
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

  const outboxKey = command.transferGroupKey
    ? `treasury.transfer.posted:${command.transferGroupKey}:${command.reason}`
    : `treasury.movement.posted:${command.idempotencyKey}`;

  await publishTreasuryOutboxEvent(
    tx,
    command.tenantId,
    command.transferGroupKey ? 'treasury.transfer.posted' : 'treasury.movement.posted',
    {
      cashMoveId,
      tenantId: command.tenantId,
      locationId: command.locationId,
      businessDayId: command.businessDayId,
      shiftInstanceId: command.shiftInstanceId,
      amount: command.amount,
      direction: command.direction,
      reason: command.reason,
      sourceRef: command.sourceRef,
      transferGroupKey: command.transferGroupKey ?? null,
    },
    outboxKey,
  );

  return cashMoveId;
}
