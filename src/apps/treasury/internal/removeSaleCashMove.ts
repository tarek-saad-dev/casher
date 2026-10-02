import 'server-only';
import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import type { SaleInvType } from '../public/saleCashMove';
import {
  deleteRegistryByKey,
  findRegistryByKey,
} from './idempotencyStore';
import { reverseMoneyMovement } from './reverseMovement';
import {
  defaultSaleIdempotencyKey,
  saleDeleteReverseIdempotencyKey,
} from './saleCommandFingerprint';
import { publishTreasuryOutboxEvent } from './treasuryOutbox';

export type RemoveSaleCashMoveInput = {
  tenantId: string;
  saleInvId: number;
  invType: SaleInvType;
};

export type RemoveSaleCashMoveResult = {
  treasuryOwned: boolean;
  reversedCashMoveId: number | null;
};

/** True when the sale idempotency key already has a registry row. */
export async function isTreasuryOwnedSaleCashMove(
  tx: Transaction,
  input: RemoveSaleCashMoveInput,
): Promise<boolean> {
  if (!input.tenantId) throw new Error('Treasury sale ownership check requires tenantId');
  const idempotencyKey = defaultSaleIdempotencyKey(input.saleInvId, input.invType);
  const existing = await findRegistryByKey(tx, input.tenantId, idempotencyKey);
  return existing != null;
}

/**
 * Treasury-owned sale CashMove removal for invoice delete.
 * Reverses the sale movement and removes the Kind=sale registry row.
 * Returns treasuryOwned=false when no registry row exists (legacy sale).
 */
export async function removeSaleCashMove(
  tx: Transaction,
  actor: ActorContext,
  input: RemoveSaleCashMoveInput,
): Promise<RemoveSaleCashMoveResult> {
  if (!input.tenantId) throw new Error('Treasury sale remove requires tenantId');

  const idempotencyKey = defaultSaleIdempotencyKey(input.saleInvId, input.invType);
  const existing = await findRegistryByKey(tx, input.tenantId, idempotencyKey);
  if (!existing) {
    return { treasuryOwned: false, reversedCashMoveId: null };
  }

  const reversedCashMoveId = await reverseMoneyMovement(tx, actor, {
    tenantId: input.tenantId,
    originalIdempotencyKey: idempotencyKey,
    idempotencyKey: saleDeleteReverseIdempotencyKey(input.saleInvId, input.invType),
    reason: 'sale_delete',
  });

  await deleteRegistryByKey(tx, input.tenantId, idempotencyKey);

  await publishTreasuryOutboxEvent(
    tx,
    input.tenantId,
    'treasury.sale.removed',
    {
      reversedCashMoveId,
      originalCashMoveId: existing.CashMoveId,
      tenantId: input.tenantId,
      saleInvId: input.saleInvId,
      invType: input.invType,
    },
    `treasury.sale.removed:${idempotencyKey}`,
  );

  return { treasuryOwned: true, reversedCashMoveId };
}
