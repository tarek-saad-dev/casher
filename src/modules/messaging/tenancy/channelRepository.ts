import { getPool, sql } from '@/lib/db';
import { TenantScopedMemo } from '@/platform/tenant/tenantMemo';

export type TenantMessagingChannelStatus = 'pending' | 'active' | 'disabled';

export interface TenantMessagingChannel {
  channelId: string;
  tenantId: string;
  channel: 'whatsapp';
  provider: string;
  endpointUrl: string | null;
  sessionId: string | null;
  phoneNumber: string | null;
  status: TenantMessagingChannelStatus;
}

/** A channel that may carry traffic: active, with an endpoint, owned by an active tenant. */
export interface ActiveTenantMessagingChannel extends TenantMessagingChannel {
  status: 'active';
  endpointUrl: string;
}

type RawChannel = {
  ChannelId: string;
  TenantId: string;
  Channel: string;
  Provider: string;
  EndpointUrl: string | null;
  SessionId: string | null;
  PhoneNumber: string | null;
  Status: string;
};

const CHANNEL_COLUMNS = `
  ch.ChannelId, ch.TenantId, ch.Channel, ch.Provider, ch.EndpointUrl,
  ch.SessionId, ch.PhoneNumber, ch.Status
`;

function mapChannel(row: RawChannel): TenantMessagingChannel {
  const status = row.Status === 'active' || row.Status === 'disabled' ? row.Status : 'pending';
  return {
    channelId: String(row.ChannelId).toLowerCase(),
    tenantId: String(row.TenantId).toLowerCase(),
    channel: 'whatsapp',
    provider: String(row.Provider),
    endpointUrl: row.EndpointUrl ? String(row.EndpointUrl).replace(/\/+$/, '') : null,
    sessionId: row.SessionId ?? null,
    phoneNumber: row.PhoneNumber ?? null,
    status,
  };
}

function asActive(channel: TenantMessagingChannel | null): ActiveTenantMessagingChannel | null {
  if (!channel || channel.status !== 'active' || !channel.endpointUrl) return null;
  return channel as ActiveTenantMessagingChannel;
}

const activeChannelMemo = new TenantScopedMemo<ActiveTenantMessagingChannel | null>('messaging-channel', 15_000);
const tokenMemo = new Map<string, { channel: ActiveTenantMessagingChannel | null; expiresAt: number }>();
const TOKEN_TTL_MS = 15_000;

/**
 * Inbound authority: the channel whose stored token hash equals the presented token's hash.
 * Unknown, pending, disabled channels and channels of suspended tenants resolve to null.
 */
export async function findActiveChannelByTokenHash(
  tokenHash: string,
): Promise<ActiveTenantMessagingChannel | null> {
  const hash = String(tokenHash ?? '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const now = Date.now();
  const hit = tokenMemo.get(hash);
  if (hit && hit.expiresAt > now) return hit.channel;

  const pool = await getPool();
  const result = await pool
    .request()
    .input('hash', sql.Char(64), hash)
    .query(`
      SELECT ${CHANNEL_COLUMNS}
      FROM dbo.TenantMessagingChannel ch
      INNER JOIN dbo.Tenant t ON t.TenantId = ch.TenantId
      WHERE ch.WebhookTokenHash = @hash AND ch.Status = N'active' AND t.Status = N'active';
    `);
  const row = result.recordset[0] as RawChannel | undefined;
  const channel = asActive(row ? mapChannel(row) : null);
  tokenMemo.set(hash, { channel, expiresAt: now + TOKEN_TTL_MS });
  return channel;
}

/** Outbound authority: the tenant's single active WhatsApp channel, or null (fail closed). */
export async function getActiveChannelForTenant(
  tenantId: string,
): Promise<ActiveTenantMessagingChannel | null> {
  return activeChannelMemo.getOrLoad(tenantId, ['whatsapp'], async () => {
    const pool = await getPool();
    const result = await pool
      .request()
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        SELECT TOP 1 ${CHANNEL_COLUMNS}
        FROM dbo.TenantMessagingChannel ch
        INNER JOIN dbo.Tenant t ON t.TenantId = ch.TenantId
        WHERE ch.TenantId = @tenantId AND ch.Channel = N'whatsapp'
          AND ch.Status = N'active' AND t.Status = N'active';
      `);
    const row = result.recordset[0] as RawChannel | undefined;
    return asActive(row ? mapChannel(row) : null);
  });
}

export async function listChannelsForTenant(tenantId: string): Promise<TenantMessagingChannel[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT ${CHANNEL_COLUMNS}
      FROM dbo.TenantMessagingChannel ch
      WHERE ch.TenantId = @tenantId
      ORDER BY ch.CreatedAt;
    `);
  return (result.recordset as RawChannel[]).map(mapChannel);
}

/**
 * Operator binding of a tenant's WhatsApp channel (bridge endpoint + token hash). Activates the
 * channel. Only operator scripts call this; request paths never write channels.
 */
export async function bindTenantWhatsAppChannel(input: {
  tenantId: string;
  provider: string;
  endpointUrl: string;
  webhookTokenHash: string;
  sessionId: string | null;
  phoneNumber: string | null;
}): Promise<TenantMessagingChannel> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, input.tenantId)
    .input('provider', sql.NVarChar(50), input.provider)
    .input('endpointUrl', sql.NVarChar(500), input.endpointUrl.replace(/\/+$/, ''))
    .input('hash', sql.Char(64), input.webhookTokenHash.toLowerCase())
    .input('sessionId', sql.NVarChar(128), input.sessionId)
    .input('phoneNumber', sql.NVarChar(50), input.phoneNumber)
    .query(`
      SET XACT_ABORT ON;
      BEGIN TRAN;
      DECLARE @id UNIQUEIDENTIFIER = (
        SELECT TOP 1 ChannelId FROM dbo.TenantMessagingChannel WITH (UPDLOCK, HOLDLOCK)
        WHERE TenantId = @tenantId AND Channel = N'whatsapp'
        ORDER BY CASE Status WHEN N'active' THEN 0 WHEN N'pending' THEN 1 ELSE 2 END, CreatedAt
      );
      IF @id IS NULL
      BEGIN
        SET @id = NEWID();
        INSERT INTO dbo.TenantMessagingChannel (ChannelId, TenantId, Channel, Provider, Status)
        VALUES (@id, @tenantId, N'whatsapp', @provider, N'pending');
      END;
      UPDATE dbo.TenantMessagingChannel
      SET Provider = @provider, EndpointUrl = @endpointUrl, WebhookTokenHash = @hash,
          SessionId = @sessionId, PhoneNumber = @phoneNumber, Status = N'active',
          UpdatedAt = SYSUTCDATETIME()
      WHERE ChannelId = @id AND TenantId = @tenantId;
      COMMIT TRAN;
      SELECT ${CHANNEL_COLUMNS} FROM dbo.TenantMessagingChannel ch WHERE ch.ChannelId = @id;
    `);
  resetMessagingChannelCaches();
  return mapChannel(result.recordset[0] as RawChannel);
}

export function resetMessagingChannelCaches(): void {
  activeChannelMemo.clear();
  tokenMemo.clear();
}
