/**
 * Access to dbo.TblBotConversation. Identity is unique per tenant via
 * UX_TblBotConversation_TenantIdentity (TenantId, Channel, Provider, ExternalContactKey).
 */
import { getPool, sql } from '@/lib/db';
import {
  isBotConversationControlMode,
  type BotConversationListItem,
  type BotConversationRow,
} from '../domain/types';
import { bindMessagingTenant } from '../../tenancy/tenantSql';

type RawConversationRow = {
  ConversationID: number | string;
  Channel: string;
  Provider: string;
  ExternalContactKey: string;
  Phone: string;
  ClientID: number | null;
  BranchID: number | null;
  ControlMode: string;
  ContextJson: string;
  Summary: string | null;
  LastMessageAt: Date | string;
  CreatedAt: Date | string;
  UpdatedAt: Date | string | null;
};

const CONVERSATION_COLUMNS = `
  [ConversationID],
  [Channel],
  [Provider],
  [ExternalContactKey],
  [Phone],
  [ClientID],
  [BranchID],
  [ControlMode],
  [ContextJson],
  [Summary],
  [LastMessageAt],
  [CreatedAt],
  [UpdatedAt]
`;

const CONVERSATION_OUTPUT_COLUMNS = CONVERSATION_COLUMNS.replace(/\[/g, 'INSERTED.[');

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function isConversationUniqueConstraintError(err: unknown): boolean {
  const e = err as {
    number?: number;
    message?: string;
    originalError?: { info?: { number?: number }; message?: string };
  };
  const number = e?.number ?? e?.originalError?.info?.number;
  if (number === 2627 || number === 2601) return true;
  return /UQ_TblBotConversation_Identity|UX_TblBotConversation_TenantIdentity|UNIQUE KEY|duplicate key/i.test(
    String(e?.message ?? e?.originalError?.message ?? ''),
  );
}

export function mapConversationRow(row: RawConversationRow): BotConversationRow {
  const controlMode = isBotConversationControlMode(row.ControlMode) ? row.ControlMode : 'BOT';
  return {
    conversationId: Number(row.ConversationID),
    channel: String(row.Channel),
    provider: String(row.Provider),
    externalContactKey: String(row.ExternalContactKey),
    phone: String(row.Phone),
    clientId: row.ClientID == null ? null : Number(row.ClientID),
    branchId: row.BranchID == null ? null : Number(row.BranchID),
    controlMode,
    contextJson: String(row.ContextJson ?? '{}'),
    summary: row.Summary != null ? String(row.Summary) : null,
    lastMessageAt: toIso(row.LastMessageAt) ?? new Date(0).toISOString(),
    createdAt: toIso(row.CreatedAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.UpdatedAt),
  };
}

export function mapConversationListItem(row: RawConversationRow): BotConversationListItem {
  const mapped = mapConversationRow(row);
  return {
    conversationId: mapped.conversationId,
    channel: mapped.channel,
    provider: mapped.provider,
    externalContactKey: mapped.externalContactKey,
    phone: mapped.phone,
    clientId: mapped.clientId,
    branchId: mapped.branchId,
    controlMode: mapped.controlMode,
    lastMessageAt: mapped.lastMessageAt,
    createdAt: mapped.createdAt,
  };
}

export async function getConversationByIdentity(
  input: {
    channel: string;
    provider: string;
    externalContactKey: string;
  },
  transaction?: sql.Transaction,
): Promise<BotConversationRow | null> {
  const exec = async (req: sql.Request) => {
    const result = await bindMessagingTenant(req, 'botConversation.getConversationByIdentity')
      .input('channel', sql.NVarChar(30), input.channel)
      .input('provider', sql.NVarChar(50), input.provider)
      .input('externalContactKey', sql.NVarChar(100), input.externalContactKey)
      .query(`
        SELECT TOP 1 ${CONVERSATION_COLUMNS}
        FROM [dbo].[TblBotConversation]
        WHERE [TenantId] = @tenantId
          AND [Channel] = @channel
          AND [Provider] = @provider
          AND [ExternalContactKey] = @externalContactKey
      `);
    const row = result.recordset[0] as RawConversationRow | undefined;
    return row ? mapConversationRow(row) : null;
  };

  if (transaction) return exec(new sql.Request(transaction));
  const pool = await getPool();
  return exec(pool.request());
}

export async function createConversation(
  input: {
    channel: string;
    provider: string;
    externalContactKey: string;
    phone: string;
    clientId: number | null;
    branchId: number | null;
    lastMessageAt: Date;
  },
  transaction: sql.Transaction,
): Promise<BotConversationRow> {
  const result = await bindMessagingTenant(new sql.Request(transaction), 'botConversation.createConversation')
    .input('channel', sql.NVarChar(30), input.channel)
    .input('provider', sql.NVarChar(50), input.provider)
    .input('externalContactKey', sql.NVarChar(100), input.externalContactKey)
    .input('phone', sql.NVarChar(50), input.phone)
    .input('clientId', sql.Int, input.clientId)
    .input('branchId', sql.Int, input.branchId)
    .input('lastMessageAt', sql.DateTime2, input.lastMessageAt)
    .query(`
      INSERT INTO [dbo].[TblBotConversation] (
        [TenantId],
        [Channel],
        [Provider],
        [ExternalContactKey],
        [Phone],
        [ClientID],
        [BranchID],
        [ControlMode],
        [ContextJson],
        [LastMessageAt],
        [CreatedAt]
      )
      OUTPUT ${CONVERSATION_OUTPUT_COLUMNS}
      VALUES (
        @tenantId,
        @channel,
        @provider,
        @externalContactKey,
        @phone,
        @clientId,
        @branchId,
        N'BOT',
        N'{}',
        @lastMessageAt,
        SYSUTCDATETIME()
      )
    `);
  const row = result.recordset[0] as RawConversationRow | undefined;
  if (!row) throw new Error('Conversation insert did not return a row');
  return mapConversationRow(row);
}

export async function touchConversationLastMessage(
  input: { conversationId: number; lastMessageAt: Date },
  transaction: sql.Transaction,
): Promise<void> {
  await bindMessagingTenant(new sql.Request(transaction), 'botConversation.touchConversationLastMessage')
    .input('conversationId', sql.BigInt, input.conversationId)
    .input('lastMessageAt', sql.DateTime2, input.lastMessageAt)
    .query(`
      UPDATE [dbo].[TblBotConversation]
      SET
        [LastMessageAt] = @lastMessageAt,
        [UpdatedAt] = SYSUTCDATETIME()
      WHERE [ConversationID] = @conversationId AND [TenantId] = @tenantId
    `);
}

export async function listConversations(filters: {
  fetchLimit: number;
}): Promise<BotConversationListItem[]> {
  const fetchLimit = Math.max(1, Math.min(200, Math.floor(filters.fetchLimit)));
  const pool = await getPool();
  const result = await bindMessagingTenant(pool.request(), 'botConversation.listConversations')
    .input('fetchLimit', sql.Int, fetchLimit)
    .query(`
      SELECT TOP (@fetchLimit) ${CONVERSATION_COLUMNS}
      FROM [dbo].[TblBotConversation]
      WHERE [TenantId] = @tenantId
      ORDER BY [LastMessageAt] DESC, [ConversationID] DESC
    `);
  return (result.recordset as RawConversationRow[]).map(mapConversationListItem);
}

export async function getConversationById(
  conversationId: number,
): Promise<BotConversationRow | null> {
  if (!Number.isFinite(conversationId) || conversationId <= 0) return null;
  const pool = await getPool();
  const result = await bindMessagingTenant(pool.request(), 'botConversation.getConversationById')
    .input('conversationId', sql.BigInt, conversationId)
    .query(`
      SELECT ${CONVERSATION_COLUMNS}
      FROM [dbo].[TblBotConversation]
      WHERE [ConversationID] = @conversationId AND [TenantId] = @tenantId
    `);
  const row = result.recordset[0] as RawConversationRow | undefined;
  return row ? mapConversationRow(row) : null;
}
