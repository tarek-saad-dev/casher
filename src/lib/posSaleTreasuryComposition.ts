import 'server-only';

import type { Transaction } from 'mssql';
import type { ActorContext } from '@/platform/public';
import { postSaleCashMove } from '@/apps/treasury/public';
import { defaultSaleIdempotencyKey } from '@/apps/treasury/internal/saleCommandFingerprint';
import type { SaleCashMovePoster } from '@/apps/pos/public/saleCashMovePoster';

export function buildSaleCashMovePoster(
  tenantId: string,
  actor: ActorContext,
): SaleCashMovePoster {
  return async (tx: Transaction, input) => {
    const sourceRef = `pos-sale:${input.saleInvId}`;
    const idempotencyKey = defaultSaleIdempotencyKey(input.saleInvId, input.invType);
    return postSaleCashMove(tx, actor, {
      tenantId,
      saleInvId: input.saleInvId,
      invType: input.invType,
      invDate: input.invDate,
      invTime: input.invTime,
      clientId: input.clientId,
      amount: input.amount,
      inOut: 'in',
      notes: input.notes,
      shiftMoveId: input.shiftMoveId,
      paymentMethodId: input.paymentMethodId,
      branchId: input.branchId,
      businessDayId: input.businessDayId,
      sourceRef,
      idempotencyKey,
    });
  };
}
