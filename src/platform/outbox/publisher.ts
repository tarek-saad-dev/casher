import 'server-only';
import type { Transaction } from 'mssql';
import { sql } from '@/lib/db';
import type { PlatformOutboxInsert, PlatformOutboxRow } from './types';

/**
 * Transaction-aware outbox publisher. Inserts on the caller's transaction so
 * aggregate rollback removes the outbox row.
 */
export async function publishPlatformOutboxEvent(
  transaction: Transaction,
  event: PlatformOutboxInsert,
): Promise<number> {
  const occurredAt = event.occurredAt ?? new Date();
  const req = new sql.Request(transaction)
    .input('tenantId', sql.UniqueIdentifier, event.tenantId)
    .input('aggregateType', sql.NVarChar(64), event.aggregateType)
    .input('aggregateId', sql.NVarChar(128), event.aggregateId)
    .input('eventType', sql.NVarChar(128), event.eventType)
    .input('payload', sql.NVarChar(sql.MAX), event.payload)
    .input('idempotencyKey', sql.NVarChar(256), event.idempotencyKey ?? null)
    .input('correlationId', sql.NVarChar(128), event.correlationId ?? null)
    .input('occurredAt', sql.DateTime2, occurredAt);

  const result = await req.query(`
    INSERT INTO dbo.PlatformOutbox (
      TenantId, AggregateType, AggregateId, EventType, Payload,
      IdempotencyKey, CorrelationId, OccurredAt, Status, Attempts
    )
    OUTPUT INSERTED.Id AS id
    VALUES (
      @tenantId, @aggregateType, @aggregateId, @eventType, @payload,
      @idempotencyKey, @correlationId, @occurredAt, N'pending', 0
    );
  `);

  return Number(result.recordset[0].id);
}

export async function countOutboxRowsForTenant(
  transaction: Transaction,
  tenantId: string,
): Promise<number> {
  const result = await new sql.Request(transaction)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT COUNT(*) AS cnt FROM dbo.PlatformOutbox WITH (UPDLOCK, HOLDLOCK)
      WHERE TenantId = @tenantId;
    `);
  return Number(result.recordset[0].cnt);
}

export type { PlatformOutboxInsert, PlatformOutboxRow };
