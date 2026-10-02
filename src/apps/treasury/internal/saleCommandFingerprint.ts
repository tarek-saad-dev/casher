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

/** Stable reverse key when replacing a sale CashMove (Option A mutable registry). */
export function saleReplaceReverseIdempotencyKey(saleInvId: number, invType: SaleInvType): string {
  return `pos-sale:replace-reverse:${invType}:${saleInvId}`;
}

/** Stable reverse key when deleting a treasury-owned sale CashMove. */
export function saleDeleteReverseIdempotencyKey(saleInvId: number, invType: SaleInvType): string {
  return `pos-sale:delete-reverse:${invType}:${saleInvId}`;
}
