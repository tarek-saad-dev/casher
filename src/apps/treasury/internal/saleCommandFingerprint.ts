import 'server-only';
import { createHash } from 'node:crypto';
import type { PostSaleCommand, SaleInvType } from '../public/saleCashMove';

export function fingerprintSalePost(command: PostSaleCommand): string {
  const payload = JSON.stringify({
    tenantId: command.tenantId,
    saleInvId: command.saleInvId,
    invType: command.invType,
    invDate: String(command.invDate).slice(0, 10),
    invTime: command.invTime,
    clientId: command.clientId,
    amount: command.amount,
    inOut: command.inOut,
    shiftMoveId: command.shiftMoveId,
    paymentMethodId: command.paymentMethodId,
    branchId: command.branchId,
    businessDayId: command.businessDayId,
    sourceRef: command.sourceRef,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function defaultSaleIdempotencyKey(saleInvId: number, invType: SaleInvType): string {
  return `pos-sale:${invType}:${saleInvId}`;
}

/**
 * Reverse key for one live sale movement.
 * A later edit of the same invoice uses the new CashMove id, so it does not
 * replay the previous reversal.
 */
export function saleReplaceReverseIdempotencyKey(
  saleInvId: number,
  invType: SaleInvType,
  priorCashMoveId: number,
): string {
  return `pos-sale:replace-reverse:${invType}:${saleInvId}:${priorCashMoveId}`;
}

/** One replacement event per prior live sale movement. */
export function saleReplacedOutboxIdempotencyKey(
  saleIdempotencyKey: string,
  priorCashMoveId: number,
): string {
  return `treasury.sale.replaced:${saleIdempotencyKey}:${priorCashMoveId}`;
}

/**
 * Re-post outbox key used when replace inserts a sale that has no registry row.
 * Scoped to the new CashMove so it does not collide with an earlier
 * `treasury.sale.posted:{saleKey}` from create or a previous generation.
 */
export function saleReplacePostOutboxKeyPrefix(saleIdempotencyKey: string): string {
  return `treasury.sale.posted:${saleIdempotencyKey}`;
}

/** Stable reverse key when deleting a treasury-owned sale CashMove. */
export function saleDeleteReverseIdempotencyKey(saleInvId: number, invType: SaleInvType): string {
  return `pos-sale:delete-reverse:${invType}:${saleInvId}`;
}
