import { getPool, sql } from '@/lib/db';
import {
  isBotMessageDirection,
  type BotMessageListItem,
  type BotMessageRow,
} from '../domain/types';

type RawMessageRow = {
  MessageID: number | string;
  ConversationID: number | string;
  InboxID: number | string | null;
  Direction: string;
  Provider: string;
  ProviderMessageID: string;
  MessageType: string;
  Text: string | null;
  OccurredAt: Date | string;
  CreatedAt: Date | string;
};

const MESSAGE_COLUMNS = `
  [MessageID],
  [ConversationID],
  [InboxID],
  [Direction],
  [Provider],
  [ProviderMessageID],
  [MessageType],
  [Text],
  [OccurredAt],
  [CreatedAt]
`;

const MESSAGE_OUTPUT_COLUMNS = MESSAGE_COLUMNS.replace(/\[/g, 'INSERTED.[');

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function isBotMessageInboxUniqueError(err: unknown): boolean {
  const e = err as {
    number?: number;
    message?: string;
    originalError?: { info?: { number?: number }; message?: string };
  };
  const number = e?.number ?? e?.originalError?.info?.number;
  if (number === 2627 || number === 2601) return true;
  return /UX_TblBotMessage_InboxID|UNIQUE KEY|duplicate key/i.test(
    String(e?.message ?? e?.originalError?.message ?? ''),
  );
}

export function mapBotMessageRow(row: RawMessageRow): BotMessageRow {
  const direction = isBotMessageDirection(row.Direction) ? row.Direction : 'inbound';
  return {
    messageId: Number(row.MessageID),
    conversationId: Number(row.ConversationID),
    inboxId: row.InboxID == null ? null : Number(row.InboxID),
    direction,
    provider: String(row.Provider),
    providerMessageId: String(row.ProviderMessageID),
    messageType: String(row.MessageType),
    text: row.Text != null ? String(row.Text) : null,
    occurredAt: toIso(row.OccurredAt) ?? new Date(0).toISOString(),
    createdAt: toIso(row.CreatedAt) ?? new Date(0).toISOString(),
  };
}

export function mapBotMessageListItem(row: RawMessageRow): BotMessageListItem {
  const mapped = mapBotMessageRow(row);
  return {
    messageId: mapped.messageId,
    conversationId: mapped.conversationId,
    inboxId: mapped.inboxId,
    direction: mapped.direction,
    messageType: mapped.messageType,
    text: mapped.text,
    occurredAt: mapped.occurredAt,
    createdAt: mapped.createdAt,
  };
}

export async function getBotMessageByInboxId(
  inboxId: number,
  transaction?: sql.Transaction,
): Promise<BotMessageRow | null> {
  const exec = async (req: sql.Request) => {
    const result = await req.input('inboxId', sql.BigInt, inboxId).query(`
      SELECT ${MESSAGE_COLUMNS}
      FROM [dbo].[TblBotMessage]
      WHERE [InboxID] = @inboxId
    `);
    const row = result.recordset[0] as RawMessageRow | undefined;
    return row ? mapBotMessageRow(row) : null;
  };
  if (transaction) return exec(new sql.Request(transaction));
  const pool = await getPool();
  return exec(pool.request());
}

export async function insertInboundBotMessage(
  input: {
    conversationId: number;
    inboxId: number;
    provider: string;
    providerMessageId: string;
    messageType: string;
    text: string | null;
    occurredAt: Date;
  },
  transaction: sql.Transaction,
): Promise<BotMessageRow> {
  const result = await new sql.Request(transaction)
    .input('conversationId', sql.BigInt, input.conversationId)
    .input('inboxId', sql.BigInt, input.inboxId)
    .input('provider', sql.NVarChar(50), input.provider)
    .input('providerMessageId', sql.NVarChar(250), input.providerMessageId)
    .input('messageType', sql.NVarChar(50), input.messageType)
    .input('text', sql.NVarChar(sql.MAX), input.text)
    .input('occurredAt', sql.DateTime2, input.occurredAt)
    .query(`
      INSERT INTO [dbo].[TblBotMessage] (
        [ConversationID],
        [InboxID],
        [Direction],
        [Provider],
        [ProviderMessageID],
        [MessageType],
        [Text],
        [OccurredAt],
        [CreatedAt]
      )
      OUTPUT ${MESSAGE_OUTPUT_COLUMNS}
      VALUES (
        @conversationId,
        @inboxId,
        N'inbound',
        @provider,
        @providerMessageId,
        @messageType,
        @text,
        @occurredAt,
        SYSUTCDATETIME()
      )
    `);
  const row = result.recordset[0] as RawMessageRow | undefined;
  if (!row) throw new Error('Bot message insert did not return a row');
  return mapBotMessageRow(row);
}

export async function listMessagesByConversation(input: {
  conversationId: number;
  fetchLimit: number;
}): Promise<BotMessageListItem[]> {
  const fetchLimit = Math.max(1, Math.min(200, Math.floor(input.fetchLimit)));
  const pool = await getPool();
  const result = await pool
    .request()
    .input('conversationId', sql.BigInt, input.conversationId)
    .input('fetchLimit', sql.Int, fetchLimit)
    .query(`
      SELECT TOP (@fetchLimit) ${MESSAGE_COLUMNS}
      FROM [dbo].[TblBotMessage]
      WHERE [ConversationID] = @conversationId
      ORDER BY [OccurredAt] DESC, [MessageID] DESC
    `);
  return (result.recordset as RawMessageRow[]).map(mapBotMessageListItem);
}

export async function countMessagesByConversation(conversationId: number): Promise<number> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('conversationId', sql.BigInt, conversationId)
    .query(`
      SELECT COUNT(*) AS cnt
      FROM [dbo].[TblBotMessage]
      WHERE [ConversationID] = @conversationId
    `);
  return Number(result.recordset[0]?.cnt ?? 0);
}

const AI_OUTBOUND_PROVIDER = 'casher-ai';

export function aiTurnProviderMessageId(turnId: number): string {
  return `turn:${turnId}`;
}

export async function getOutboundBotMessageByAiTurnId(
  turnId: number,
): Promise<BotMessageRow | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('provider', sql.NVarChar(50), AI_OUTBOUND_PROVIDER)
    .input('providerMessageId', sql.NVarChar(250), aiTurnProviderMessageId(turnId))
    .query(`
      SELECT ${MESSAGE_COLUMNS}
      FROM [dbo].[TblBotMessage]
      WHERE [Provider] = @provider AND [ProviderMessageID] = @providerMessageId
    `);
  const row = result.recordset[0] as RawMessageRow | undefined;
  return row ? mapBotMessageRow(row) : null;
}

export async function insertOutboundBotMessage(input: {
  conversationId: number;
  turnId: number;
  text: string;
  occurredAt?: Date;
}): Promise<BotMessageRow> {
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input('conversationId', sql.BigInt, input.conversationId)
      .input('provider', sql.NVarChar(50), AI_OUTBOUND_PROVIDER)
      .input('providerMessageId', sql.NVarChar(250), aiTurnProviderMessageId(input.turnId))
      .input('messageType', sql.NVarChar(50), 'text')
      .input('text', sql.NVarChar(sql.MAX), input.text)
      .input('occurredAt', sql.DateTime2, input.occurredAt ?? new Date())
      .query(`
        INSERT INTO [dbo].[TblBotMessage] (
          [ConversationID],
          [InboxID],
          [Direction],
          [Provider],
          [ProviderMessageID],
          [MessageType],
          [Text],
          [OccurredAt],
          [CreatedAt]
        )
        OUTPUT ${MESSAGE_OUTPUT_COLUMNS}
        VALUES (
          @conversationId,
          NULL,
          N'outbound',
          @provider,
          @providerMessageId,
          @messageType,
          @text,
          @occurredAt,
          SYSUTCDATETIME()
        )
      `);
    const row = result.recordset[0] as RawMessageRow | undefined;
    if (!row) throw new Error('Outbound bot message insert did not return a row');
    return mapBotMessageRow(row);
  } catch (err) {
    const existing = await getOutboundBotMessageByAiTurnId(input.turnId);
    if (existing) return existing;
    throw err;
  }
}
