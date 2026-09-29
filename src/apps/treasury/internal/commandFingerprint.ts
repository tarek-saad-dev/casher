import 'server-only';
import { createHash } from 'node:crypto';
import type { PostCommand, ReverseCommand } from '../public/moneyMovement';

export function fingerprintPost(command: PostCommand): string {
  const payload = JSON.stringify({
    tenantId: command.tenantId,
    locationId: command.locationId,
    businessDayId: command.businessDayId,
    shiftInstanceId: command.shiftInstanceId,
    amount: command.amount,
    direction: command.direction,
    reason: command.reason,
    sourceRef: command.sourceRef,
    paymentMethodId: command.paymentMethodId,
    categoryId: command.categoryId ?? null,
    transferGroupKey: command.transferGroupKey ?? null,
    invType: command.invType ?? null,
  });
  return createHash('sha256').update(payload).digest('hex');
}

export function fingerprintReverse(command: ReverseCommand): string {
  const payload = JSON.stringify({
    tenantId: command.tenantId,
    originalIdempotencyKey: command.originalIdempotencyKey,
    reason: command.reason,
  });
  return createHash('sha256').update(payload).digest('hex');
}
