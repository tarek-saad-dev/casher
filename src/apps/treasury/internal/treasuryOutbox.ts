import 'server-only';
import type { Transaction } from 'mssql';
import { publishPlatformOutboxEvent } from '@/platform/public';

export type TreasuryOutboxEventType =
  | 'treasury.movement.posted'
  | 'treasury.movement.reversed'
  | 'treasury.transfer.posted'
  | 'treasury.sale.posted'
  | 'treasury.sale.replaced'
  | 'treasury.sale.removed';

export async function publishTreasuryOutboxEvent(
  tx: Transaction,
  tenantId: string,
  eventType: TreasuryOutboxEventType,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  const aggregateId = String(payload.cashMoveId ?? payload.transferGroupKey ?? idempotencyKey);
  await publishPlatformOutboxEvent(tx, {
    tenantId,
    aggregateType: 'cash_movement',
    aggregateId,
    eventType,
    payload: JSON.stringify(payload),
    idempotencyKey,
    correlationId: String(payload.sourceRef ?? aggregateId),
  });
}
