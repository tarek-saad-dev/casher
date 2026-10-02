import 'server-only';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import type { PostSaleCommand } from '../public/saleCashMove';
import {
  deleteRegistryByKey,
  findRegistryByKey,
  TreasuryIdempotencyConflictError,
  updateRegistryRow,
} from './idempotencyStore';
import { insertSaleCashMoveRow } from './insertSaleCashMoveRow';
import { postSaleCashMove } from './postSaleCashMove';
import { reverseMoneyMovement } from './reverseMovement';
import {
  fingerprintSalePost,
  saleReplaceReverseIdempotencyKey,
} from './saleCommandFingerprint';
import { publishTreasuryOutboxEvent } from './treasuryOutbox';

/**
 * Treasury-owned sale CashMove replace for invoice edit.
 *
 * Registry lifecycle: Option A — the Kind=sale registry row is updated atomically
 * with the new CashMoveId and fingerprint after reversing the prior movement.
 */
export async function replaceSaleCashMove(
  tx: Transaction,
  actor: ActorContext,
  command: PostSaleCommand,
): Promise<number | null> {
  if (!command.tenantId) throw new Error('Treasury sale replace requires tenantId');
  if (!command.idempotencyKey?.trim()) throw new Error('Treasury sale replace requires idempotencyKey');

  const fingerprint = fingerprintSalePost(command);
  const existing = await findRegistryByKey(tx, command.tenantId, command.idempotencyKey);

  if (command.amount <= 0) {
    if (!existing) return null;
    await reverseMoneyMovement(tx, actor, {
      tenantId: command.tenantId,
      originalIdempotencyKey: command.idempotencyKey,
      idempotencyKey: saleReplaceReverseIdempotencyKey(command.saleInvId, command.invType),
      reason: 'sale_replace_zero',
    });
    await deleteRegistryByKey(tx, command.tenantId, command.idempotencyKey);
    return null;
  }

  if (existing) {
    if (existing.Fingerprint === fingerprint) {
      return existing.CashMoveId;
    }

    await reverseMoneyMovement(tx, actor, {
      tenantId: command.tenantId,
      originalIdempotencyKey: command.idempotencyKey,
      idempotencyKey: saleReplaceReverseIdempotencyKey(command.saleInvId, command.invType),
      reason: 'sale_replace',
    });

    const cashMoveId = await insertSaleCashMoveRow(tx, command);
    await updateRegistryRow(tx, {
      tenantId: command.tenantId,
      idempotencyKey: command.idempotencyKey,
      fingerprint,
      cashMoveId,
    });

    await publishTreasuryOutboxEvent(
      tx,
      command.tenantId,
      'treasury.sale.replaced',
      {
        cashMoveId,
        priorCashMoveId: existing.CashMoveId,
        tenantId: command.tenantId,
        saleInvId: command.saleInvId,
        invType: command.invType,
        amount: command.amount,
        sourceRef: command.sourceRef,
      },
      `treasury.sale.replaced:${command.idempotencyKey}`,
    );

    return cashMoveId;
  }

  try {
    return await postSaleCashMove(tx, actor, command);
  } catch (err) {
    if (err instanceof TreasuryIdempotencyConflictError) throw err;
    throw err;
  }
}
