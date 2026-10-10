import { getPool, sql } from '@/lib/db';
import { bindMessagingTenant } from '@/modules/messaging/tenancy/tenantSql';
import type { MessageActorOrigin } from '../domain/types';
import { isMessageActorOrigin } from '../domain/types';
import type { OutboundCorrelation } from '../domain/classify';

export async function insertOutboundCorrelation(input: {
  outboxId: number;
  conversationId: number | null;
  phone: string;
  origin: MessageActorOrigin;
  expectedControlVersion: number | null;
}): Promise<void> {
  const pool = await getPool();
  await bindMessagingTenant(pool.request(), 'handoff.insertOutboundCorrelation')
    .input('outboxId', sql.BigInt, input.outboxId)
    .input('cid', sql.BigInt, input.conversationId)
    .input('phone', sql.NVarChar(50), input.phone)
    .input('origin', sql.NVarChar(30), input.origin)
    .input('ver', sql.Int, input.expectedControlVersion)
    .query(`
      IF NOT EXISTS (
        SELECT 1 FROM dbo.TblWhatsAppOutboundCorrelation
        WHERE OutboxID = @outboxId AND TenantId = @tenantId
      )
      INSERT INTO dbo.TblWhatsAppOutboundCorrelation
        (TenantId, OutboxID, ConversationID, Phone, Origin, ExpectedControlVersion)
      VALUES (@tenantId, @outboxId, @cid, @phone, @origin, @ver)
    `);
}

export async function stampOutboundCorrelation(input: {
  outboxId: number;
  providerMessageId: string;
}): Promise<void> {
  const pool = await getPool();
  await bindMessagingTenant(pool.request(), 'handoff.stampOutboundCorrelation')
    .input('outboxId', sql.BigInt, input.outboxId)
    .input('pmid', sql.NVarChar(250), input.providerMessageId)
    .query(`
      UPDATE dbo.TblWhatsAppOutboundCorrelation
      SET ProviderMessageID = @pmid, StampedAt = SYSUTCDATETIME()
      WHERE OutboxID = @outboxId AND TenantId = @tenantId
    `);
}

export async function findCorrelationByProviderMessageId(
  providerMessageId: string,
): Promise<OutboundCorrelation | null> {
  const pool = await getPool();
  const result = await bindMessagingTenant(pool.request(), 'handoff.findCorrelationByProviderMessageId')
    .input('pmid', sql.NVarChar(250), providerMessageId)
    .query(`
      SELECT Phone, Origin, ProviderMessageID, CreatedAt, StampedAt
      FROM dbo.TblWhatsAppOutboundCorrelation
      WHERE ProviderMessageID = @pmid AND TenantId = @tenantId
    `);
  const row = result.recordset[0] as
    | {
        Phone: string;
        Origin: string;
        ProviderMessageID: string | null;
        CreatedAt: Date | string;
        StampedAt: Date | string | null;
      }
    | undefined;
  if (!row || !isMessageActorOrigin(row.Origin)) return null;
  return {
    providerMessageId: row.ProviderMessageID,
    origin: row.Origin,
    phone: String(row.Phone),
    createdAt: row.CreatedAt instanceof Date ? row.CreatedAt.toISOString() : String(row.CreatedAt),
    stamped: row.StampedAt != null,
  };
}

export async function hasPendingUnstampedCorrelation(input: {
  phone: string;
  since: Date;
}): Promise<boolean> {
  const pool = await getPool();
  const result = await bindMessagingTenant(pool.request(), 'handoff.hasPendingUnstampedCorrelation')
    .input('phone', sql.NVarChar(50), input.phone)
    .input('since', sql.DateTime2, input.since)
    .query(`
      SELECT TOP 1 CorrelationID
      FROM dbo.TblWhatsAppOutboundCorrelation
      WHERE Phone = @phone
        AND TenantId = @tenantId
        AND ProviderMessageID IS NULL
        AND CreatedAt >= @since
    `);
  return Boolean(result.recordset[0]);
}
