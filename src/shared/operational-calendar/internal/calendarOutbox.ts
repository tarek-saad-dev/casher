import 'server-only';
import { sql } from '@/lib/db';
import { BranchDomainError } from '@/lib/branch/types';
import { publishPlatformOutboxEvent } from '@/platform/public';

export type CalendarOutboxEventType =
  | 'calendar.day.opened'
  | 'calendar.day.closed'
  | 'calendar.shift.opened'
  | 'calendar.shift.closed';

/**
 * One key per committed day transition. reopenOrInsertDay reuses TblNewDay.ID,
 * so a key of only location+day collides on the next open or close.
 */
export function calendarDayIdempotencyKey(
  eventType: 'calendar.day.opened' | 'calendar.day.closed',
  locationId: number,
  businessDayId: number,
  occurrence: number,
): string {
  if (!Number.isInteger(occurrence) || occurrence < 1) {
    throw new Error('calendar day occurrence must be a positive integer');
  }
  return `${eventType}:${locationId}:${businessDayId}:${occurrence}`;
}

export async function nextCalendarDayIdempotencyKey(
  tx: sql.Transaction,
  tenantId: string,
  eventType: 'calendar.day.opened' | 'calendar.day.closed',
  locationId: number,
  businessDayId: number,
): Promise<string> {
  const base = `${eventType}:${locationId}:${businessDayId}`;
  const result = await new sql.Request(tx)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .input('base', sql.NVarChar(256), base)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM dbo.PlatformOutbox WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId
        AND (IdempotencyKey = @base OR IdempotencyKey LIKE @base + ':%')
    `);
  const occurrence = Number(result.recordset[0]?.cnt ?? 0) + 1;
  return calendarDayIdempotencyKey(eventType, locationId, businessDayId, occurrence);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function errorNumber(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as { number?: number; originalError?: { info?: { number?: number } } };
  return record.number ?? record.originalError?.info?.number;
}

export function isPlatformOutboxIdempotencyViolation(err: unknown): boolean {
  const number = errorNumber(err);
  if (number === 2601 || number === 2627) return true;
  return /UX_PlatformOutbox_Tenant_Idempotency|Cannot insert duplicate key/i.test(errorText(err));
}

/** Map a duplicate outbox key to the stable day-domain error. Never leak the SQL unique-key failure. */
export function mapCalendarOutboxUniqueViolation(err: unknown, eventType: string): unknown {
  if (!isPlatformOutboxIdempotencyViolation(err)) return err;
  if (eventType === 'calendar.day.opened') {
    return new BranchDomainError(
      'ALREADY_OPEN_BUSINESS_DAY',
      'يوجد يوم عمل مفتوح بالفعل لهذا الفرع',
      400,
    );
  }
  if (eventType === 'calendar.day.closed') {
    return new BranchDomainError(
      'BUSINESS_DAY_ALREADY_CLOSED',
      'لا يوجد يوم عمل مفتوح لإغلاقه',
      400,
    );
  }
  return err;
}

export async function publishCalendarOutboxEvent(
  tx: sql.Transaction,
  tenantId: string,
  eventType: CalendarOutboxEventType,
  payload: Record<string, unknown>,
  idempotencyKey: string,
): Promise<void> {
  const aggregateType = eventType.startsWith('calendar.day') ? 'business_day' : 'shift_session';
  const aggregateId = String(payload.businessDayId ?? payload.shiftInstanceId ?? idempotencyKey);
  try {
    await publishPlatformOutboxEvent(tx, {
      tenantId,
      aggregateType,
      aggregateId,
      eventType,
      payload: JSON.stringify(payload),
      idempotencyKey,
      correlationId: aggregateId,
    });
  } catch (err) {
    throw mapCalendarOutboxUniqueViolation(err, eventType);
  }
}
