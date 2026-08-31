import { getPool, sql } from '@/lib/db';
import { resolveExternalContactKey } from '@/modules/messaging/conversation/domain/externalContactKey';
import { DEFAULT_BOT_CHANNEL } from '@/modules/messaging/conversation/domain/types';
import {
  classifyFromMeEvent,
} from '../domain/classify';
import type { MessageActorOrigin } from '../domain/types';
import { isMessageActorOrigin } from '../domain/types';
import {
  findCorrelationByProviderMessageId,
  hasPendingUnstampedCorrelation,
} from '../infra/outboundCorrelationRepository';
import {
  getHumanHandoffCorrelationWindowMs,
  isHumanHandoffActiveForPhone,
} from '../featureFlag';
import { logHandoffEvent } from '../observability';
import { applyWhatsAppManualControl, recordHumanActivity, type ControlCommandDeps } from './commands';

const MANUAL_PROVIDER = 'whatsapp-web';

export type ObserveManualOutboundInput = {
  provider?: string;
  providerMessageId: string;
  phone: string;
  text?: string | null;
  occurredAt?: string | Date;
  rawPayload?: unknown;
};

export type ObserveManualOutboundResult = {
  classified: ReturnType<typeof classifyFromMeEvent>['kind'];
  conversationId: number | null;
  messageId: number | null;
  takeover: boolean;
  duplicate: boolean;
};

function serializeRaw(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw.trim() || null;
  try {
    return JSON.stringify(raw);
  } catch {
    return null;
  }
}

async function findConversationIdByContactKey(externalContactKey: string): Promise<{
  conversationId: number;
  phone: string;
} | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('channel', sql.NVarChar(30), DEFAULT_BOT_CHANNEL)
    .input('key', sql.NVarChar(100), externalContactKey)
    .query(`
      SELECT TOP 1 ConversationID, Phone
      FROM dbo.TblBotConversation
      WHERE Channel = @channel AND ExternalContactKey = @key
      ORDER BY LastMessageAt DESC, ConversationID DESC
    `);
  const row = result.recordset[0] as { ConversationID: number | string; Phone: string } | undefined;
  if (!row) return null;
  return { conversationId: Number(row.ConversationID), phone: String(row.Phone) };
}

async function ensureConversation(input: {
  externalContactKey: string;
  phone: string;
  provider: string;
  occurredAt: Date;
}): Promise<number> {
  const existing = await findConversationIdByContactKey(input.externalContactKey);
  if (existing) return existing.conversationId;
  const pool = await getPool();
  const result = await pool
    .request()
    .input('channel', sql.NVarChar(30), DEFAULT_BOT_CHANNEL)
    .input('provider', sql.NVarChar(50), input.provider)
    .input('key', sql.NVarChar(100), input.externalContactKey)
    .input('phone', sql.NVarChar(50), input.phone)
    .input('occurredAt', sql.DateTime2, input.occurredAt)
    .query(`
      SET NOCOUNT ON;
      BEGIN TRY
        INSERT INTO dbo.TblBotConversation
          (Channel, Provider, ExternalContactKey, Phone, ClientID, BranchID, ControlMode, ContextJson, LastMessageAt, CreatedAt)
        OUTPUT INSERTED.ConversationID
        VALUES (@channel, @provider, @key, @phone, NULL, NULL, N'BOT', N'{}', @occurredAt, SYSUTCDATETIME());
      END TRY
      BEGIN CATCH
        IF ERROR_NUMBER() NOT IN (2627, 2601) THROW;
        SELECT TOP 1 ConversationID
        FROM dbo.TblBotConversation
        WHERE Channel = @channel AND ExternalContactKey = @key
        ORDER BY LastMessageAt DESC, ConversationID DESC;
      END CATCH
    `);
  const id = Number(result.recordset[0]?.ConversationID);
  if (!Number.isFinite(id)) throw new Error('Failed to ensure conversation for manual outbound');
  return id;
}

async function findExistingManualMessage(
  provider: string,
  providerMessageId: string,
): Promise<{ messageId: number; conversationId: number } | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('provider', sql.NVarChar(50), provider)
    .input('pmid', sql.NVarChar(250), providerMessageId)
    .query(`
      SELECT TOP 1 MessageID, ConversationID
      FROM dbo.TblBotMessage
      WHERE Provider = @provider AND ProviderMessageID = @pmid
    `);
  const row = result.recordset[0] as
    | { MessageID: number | string; ConversationID: number | string }
    | undefined;
  if (!row) return null;
  return { messageId: Number(row.MessageID), conversationId: Number(row.ConversationID) };
}

async function insertManualHumanMessage(input: {
  conversationId: number;
  provider: string;
  providerMessageId: string;
  text: string | null;
  occurredAt: Date;
  origin: MessageActorOrigin;
}): Promise<{ messageId: number; duplicate: boolean }> {
  const existing = await findExistingManualMessage(input.provider, input.providerMessageId);
  if (existing) return { messageId: existing.messageId, duplicate: true };
  const pool = await getPool();
  try {
    const result = await pool
      .request()
      .input('cid', sql.BigInt, input.conversationId)
      .input('provider', sql.NVarChar(50), input.provider)
      .input('pmid', sql.NVarChar(250), input.providerMessageId)
      .input('text', sql.NVarChar(sql.MAX), input.text)
      .input('occurredAt', sql.DateTime2, input.occurredAt)
      .input('origin', sql.NVarChar(30), input.origin)
      .query(`
        INSERT INTO dbo.TblBotMessage
          (ConversationID, InboxID, Direction, Provider, ProviderMessageID, MessageType, Text, OccurredAt, CreatedAt, Origin)
        OUTPUT INSERTED.MessageID
        VALUES (@cid, NULL, N'outbound', @provider, @pmid, N'text', @text, @occurredAt, SYSUTCDATETIME(), @origin);

        UPDATE dbo.TblBotConversation
        SET LastMessageAt = @occurredAt, UpdatedAt = SYSUTCDATETIME()
        WHERE ConversationID = @cid;
      `);
    return { messageId: Number(result.recordset[0]?.MessageID), duplicate: false };
  } catch (err) {
    const existingAfter = await findExistingManualMessage(input.provider, input.providerMessageId);
    if (existingAfter) return { messageId: existingAfter.messageId, duplicate: true };
    throw err;
  }
}

/**
 * Classify a fromMe WhatsApp observation and take over when it is a real human outbound.
 */
export async function observeManualOutbound(
  input: ObserveManualOutboundInput,
  deps?: ControlCommandDeps,
): Promise<ObserveManualOutboundResult> {
  if (!isHumanHandoffActiveForPhone(String(input.phone ?? ''))) {
    return {
      classified: 'AUTOMATED',
      conversationId: null,
      messageId: null,
      takeover: false,
      duplicate: false,
    };
  }

  const providerMessageId = String(input.providerMessageId ?? '').trim();
  if (!providerMessageId) {
    throw new Error('providerMessageId is required');
  }
  const provider = String(input.provider ?? MANUAL_PROVIDER).trim().toLowerCase() || MANUAL_PROVIDER;
  const rawPayload = serializeRaw(input.rawPayload);
  const externalContactKey = resolveExternalContactKey({
    phone: String(input.phone ?? ''),
    rawPayload,
  });
  const occurredAtRaw = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const occurredAt = Number.isNaN(occurredAtRaw.getTime()) ? new Date() : occurredAtRaw;

  const known = await findCorrelationByProviderMessageId(providerMessageId);
  const since = new Date(Date.now() - getHumanHandoffCorrelationWindowMs());
  const pending = await hasPendingUnstampedCorrelation({ phone: externalContactKey, since });
  // also check raw phone form
  const pendingAlt = pending
    ? true
    : await hasPendingUnstampedCorrelation({ phone: String(input.phone ?? '').replace(/\D/g, ''), since });

  const classified = classifyFromMeEvent({
    providerMessageId,
    known,
    pendingUnstampedForPhone: pending || pendingAlt,
  });

  if (classified.kind === 'AUTOMATED') {
    logHandoffEvent('manual_fromme_classified', {
      providerMessageId,
      kind: 'AUTOMATED',
      origin: classified.origin,
    });
    return {
      classified: 'AUTOMATED',
      conversationId: null,
      messageId: null,
      takeover: false,
      duplicate: false,
    };
  }

  if (classified.kind === 'AMBIGUOUS') {
    logHandoffEvent('manual_fromme_ambiguous', { providerMessageId, phone: externalContactKey });
    return {
      classified: 'AMBIGUOUS',
      conversationId: null,
      messageId: null,
      takeover: false,
      duplicate: false,
    };
  }

  const conversationId = await ensureConversation({
    externalContactKey,
    phone: String(input.phone ?? externalContactKey),
    provider,
    occurredAt,
  });

  if (classified.kind === 'HUMAN_ERP') {
    const existing = await findExistingManualMessage(provider, providerMessageId);
    if (existing) {
      await recordHumanActivity(
        { conversationId, humanMessageId: existing.messageId, source: 'ERP' },
        deps,
      );
      return {
        classified: 'HUMAN_ERP',
        conversationId,
        messageId: existing.messageId,
        takeover: false,
        duplicate: true,
      };
    }
    await recordHumanActivity(
      { conversationId, humanMessageId: null, source: 'ERP' },
      deps,
    );
    logHandoffEvent('manual_fromme_classified', {
      providerMessageId,
      kind: 'HUMAN_ERP',
      conversationId,
    });
    return {
      classified: 'HUMAN_ERP',
      conversationId,
      messageId: null,
      takeover: false,
      duplicate: false,
    };
  }

  // WHATSAPP_MANUAL
  const inserted = await insertManualHumanMessage({
    conversationId,
    provider,
    providerMessageId,
    text: input.text != null ? String(input.text) : null,
    occurredAt,
    origin: 'HUMAN_WHATSAPP',
  });
  const result = await applyWhatsAppManualControl(
    { conversationId, humanMessageId: inserted.messageId },
    deps,
  );
  logHandoffEvent('manual_fromme_classified', {
    providerMessageId,
    kind: 'WHATSAPP_MANUAL',
    conversationId,
    takeover: result.changed,
    duplicate: inserted.duplicate,
  });
  if (result.changed) {
    logHandoffEvent('human_manual_whatsapp_detected', {
      conversationId,
      providerMessageId,
      controlVersion: result.state.controlVersion,
    });
  }
  return {
    classified: 'WHATSAPP_MANUAL',
    conversationId,
    messageId: inserted.messageId,
    takeover: result.changed,
    duplicate: inserted.duplicate,
  };
}

/** Test helper — validates origin strings from metadata. */
export function parseOutboundOrigin(value: unknown): MessageActorOrigin | null {
  if (typeof value !== 'string') return null;
  return isMessageActorOrigin(value) ? value : null;
}
