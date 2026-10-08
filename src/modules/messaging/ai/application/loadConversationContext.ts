import { getConversationById } from '@/modules/messaging/conversation/infra/botConversationRepository';
import { getPool, sql } from '@/lib/db';
import { bindMessagingTenant } from '@/modules/messaging/tenancy/tenantSql';
import type { AiConversationContext, AiConversationContextMessage } from '../domain/types';
import { getAiConfig } from '../config';

type RawTimelineRow = {
  MessageID: number | string;
  Direction: string;
  Text: string | null;
  OccurredAt: Date | string;
};

function mapTimelineRow(row: RawTimelineRow): AiConversationContextMessage {
  const direction = row.Direction === 'outbound' ? 'outbound' : 'inbound';
  return {
    messageId: Number(row.MessageID),
    direction,
    text: row.Text != null ? String(row.Text) : '',
    occurredAt:
      row.OccurredAt instanceof Date
        ? row.OccurredAt.toISOString()
        : String(row.OccurredAt),
  };
}

export async function loadConversationContext(input: {
  conversationId: number;
  anchorInboundMessageId: number;
  latestInboundMessageId: number;
}): Promise<AiConversationContext> {
  const config = getAiConfig();
  const conversation = await getConversationById(input.conversationId);
  if (!conversation) {
    throw Object.assign(new Error('Conversation not found'), { code: 'CONVERSATION_NOT_FOUND' });
  }

  const pool = await getPool();
  const result = await bindMessagingTenant(pool.request(), 'ai.loadConversationContext')
    .input('conversationId', sql.BigInt, input.conversationId)
    .input('anchorId', sql.BigInt, input.anchorInboundMessageId)
    .input('latestId', sql.BigInt, input.latestInboundMessageId)
    .input('fetchLimit', sql.Int, config.contextMaxMessages + 5)
    .query(`
      SELECT TOP (@fetchLimit)
        m.[MessageID],
        m.[Direction],
        m.[Text],
        m.[OccurredAt]
      FROM [dbo].[TblBotMessage] AS m
      WHERE m.[ConversationID] = @conversationId
        AND m.[TenantId] = @tenantId
      ORDER BY m.[OccurredAt] DESC, m.[MessageID] DESC
    `);

  const timeline = (result.recordset as RawTimelineRow[])
    .map(mapTimelineRow)
    .reverse();

  const recent = timeline.slice(-config.contextMaxMessages);

  const burstResult = await bindMessagingTenant(pool.request(), 'ai.loadConversationContext.burst')
    .input('conversationId', sql.BigInt, input.conversationId)
    .input('anchorId', sql.BigInt, input.anchorInboundMessageId)
    .input('latestId', sql.BigInt, input.latestInboundMessageId)
    .query(`
      SELECT m.[MessageID]
      FROM [dbo].[TblBotMessage] AS m
      WHERE m.[ConversationID] = @conversationId
        AND m.[TenantId] = @tenantId
        AND m.[Direction] = N'inbound'
        AND m.[MessageID] >= @anchorId
        AND m.[MessageID] <= @latestId
      ORDER BY m.[MessageID] ASC
    `);

  const burstInboundMessageIds = (burstResult.recordset as Array<{ MessageID: number | string }>).map(
    (r) => Number(r.MessageID),
  );

  return {
    conversationId: conversation.conversationId,
    phone: conversation.phone,
    controlMode: conversation.controlMode,
    messages: recent,
    burstInboundMessageIds,
  };
}

export async function getInboundMessageReceivedAt(messageId: number): Promise<string | null> {
  const pool = await getPool();
  const result = await bindMessagingTenant(pool.request(), 'ai.getInboundMessageReceivedAt')
    .input('messageId', sql.BigInt, messageId)
    .query(`
      SELECT m.[OccurredAt], i.[ReceivedAt]
      FROM [dbo].[TblBotMessage] AS m
      LEFT JOIN [dbo].[TblMessageInbox] AS i
        ON i.[ID] = m.[InboxID]
        AND i.[TenantId] = m.[TenantId]
        AND i.[TenantId] = @tenantId
      WHERE m.[MessageID] = @messageId
        AND m.[TenantId] = @tenantId
    `);
  const row = result.recordset[0] as
    | { OccurredAt: Date | string; ReceivedAt: Date | string | null }
    | undefined;
  if (!row) return null;
  const received = row.ReceivedAt ?? row.OccurredAt;
  return received instanceof Date ? received.toISOString() : String(received);
}
