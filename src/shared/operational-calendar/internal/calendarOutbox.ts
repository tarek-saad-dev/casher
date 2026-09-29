import 'server-only';
import { sql } from '@/lib/db';
import { publishPlatformOutboxEvent } from '@/platform/public';

export async function publishCalendarOutboxEvent(
  tx: sql.Transaction,
  tenantId: string,
  eventType:
    | 'calendar.day.opened'
    | 'calendar.day.closed'
    | 'calendar.shift.opened'
    | 'calendar.shift.closed',
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  const aggregateType = eventType.startsWith('calendar.day') ? 'business_day' : 'shift_session';
  const aggregateId = String(payload.businessDayId ?? payload.shiftInstanceId ?? idempotencyKey);
  await publishPlatformOutboxEvent(tx, {
    tenantId,
    aggregateType,
    aggregateId,
    eventType,
    payload: JSON.stringify(payload),
    idempotencyKey,
    correlationId: aggregateId,
  });
}
