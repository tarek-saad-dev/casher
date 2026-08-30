import { enqueueMessage } from '@/modules/messaging/application/enqueueMessage';
import { getConversationById } from '@/modules/messaging/conversation/infra/botConversationRepository';
import { getPool, sql } from '@/lib/db';
import { HandoffError } from './errors';
import {
  takeoverConversationErp,
  type ControlCommandDeps,
} from './commands';
import { isHumanHandoffActiveForPhone } from '../featureFlag';

async function insertHumanErpMessage(input: {
  conversationId: number;
  text: string;
  userId: number;
}): Promise<number> {
  const pool = await getPool();
  const providerMessageId = `erp:${input.conversationId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const result = await pool
    .request()
    .input('cid', sql.BigInt, input.conversationId)
    .input('pmid', sql.NVarChar(250), providerMessageId)
    .input('text', sql.NVarChar(sql.MAX), input.text)
    .query(`
      DECLARE @MessageId BIGINT;
      INSERT INTO dbo.TblBotMessage
        (ConversationID, InboxID, Direction, Provider, ProviderMessageID, MessageType, Text, OccurredAt, CreatedAt, Origin)
      VALUES (@cid, NULL, N'outbound', N'casher-erp', @pmid, N'text', @text, SYSUTCDATETIME(), SYSUTCDATETIME(), N'HUMAN_ERP');
      SET @MessageId = SCOPE_IDENTITY();

      UPDATE dbo.TblBotConversation
      SET LastMessageAt = SYSUTCDATETIME(),
          LastHumanMessageID = @MessageId,
          UpdatedAt = SYSUTCDATETIME()
      WHERE ConversationID = @cid;

      SELECT @MessageId AS MessageID;
    `);
  return Number(result.recordset[0]?.MessageID);
}

/**
 * ERP human send: must own (or take over), extend lease, durable outbox, HUMAN_ERP origin.
 */
export async function sendHumanErpMessage(
  input: {
    conversationId: number;
    userId: number;
    text: string;
    branchId?: number | null;
  },
  deps?: ControlCommandDeps,
): Promise<{ messageId: number; outboxId: number; controlVersion: number }> {
  const text = String(input.text ?? '').trim();
  if (!text) throw new HandoffError('الرسالة فارغة', 'EMPTY_CONTENT', 400);

  const conversation = await getConversationById(input.conversationId);
  if (!conversation) throw new HandoffError('المحادثة غير موجودة', 'NOT_FOUND', 404);
  if (!isHumanHandoffActiveForPhone(conversation.phone)) {
    throw new HandoffError('التحويل للموظف غير مفعّل', 'FEATURE_DISABLED', 403);
  }

  const control = await takeoverConversationErp(
    { conversationId: input.conversationId, userId: input.userId },
    deps,
  );
  if (control.mode !== 'HUMAN' || control.takenOverByUserId !== input.userId) {
    throw new HandoffError('لازم تستلم المحادثة قبل الإرسال', 'NOT_OWNER', 409);
  }

  const messageId = await insertHumanErpMessage({
    conversationId: input.conversationId,
    text,
    userId: input.userId,
  });

  const enqueued = await enqueueMessage({
    channel: 'whatsapp',
    recipient: { phone: conversation.phone },
    content: { text },
    idempotencyKey: `whatsapp-human-erp:${input.conversationId}:${messageId}`,
    metadata: {
      source: 'erp-inbox',
      origin: 'HUMAN_ERP',
      conversationId: input.conversationId,
      outboundMessageId: messageId,
      expectedControlVersion: control.controlVersion,
      actorUserId: input.userId,
    },
    context: {
      userId: input.userId,
      ...(input.branchId != null ? { branchId: input.branchId } : {}),
    },
  });

  return {
    messageId,
    outboxId: enqueued.messageId,
    controlVersion: control.controlVersion,
  };
}
