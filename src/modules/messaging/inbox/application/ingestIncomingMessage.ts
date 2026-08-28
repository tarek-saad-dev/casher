import { normalizeInboxPhone } from '../domain/normalizePhone';
import {
  MessageInboxError,
  type IngestIncomingMessageInput,
  type IngestIncomingMessageResult,
} from '../domain/types';
import type { InboxWebhookPerfSink } from '../observability/inboxWebhookPerf';
import { insert } from '../infra/messageInboxRepository';

function serializeRawPayload(rawPayload: unknown): string | null {
  if (rawPayload == null) return null;
  if (typeof rawPayload === 'string') {
    const trimmed = rawPayload.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  try {
    return JSON.stringify(rawPayload);
  } catch {
    throw new MessageInboxError('rawPayload must be JSON-serializable', 'INVALID_INPUT');
  }
}

function parseReceivedAt(value: string | Date): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new MessageInboxError('receivedAt must be a valid ISO-8601 timestamp', 'INVALID_RECEIVED_AT');
    }
    return value;
  }
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    throw new MessageInboxError('receivedAt is required', 'MISSING_RECEIVED_AT');
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new MessageInboxError('receivedAt must be a valid ISO-8601 timestamp', 'INVALID_RECEIVED_AT');
  }
  return parsed;
}

function normalizeProvider(provider: string): string {
  return String(provider ?? '').trim().toLowerCase();
}

function normalizeProviderMessageId(providerMessageId: string): string {
  return String(providerMessageId ?? '').trim();
}

function normalizeMessageType(messageType: string): string {
  return String(messageType ?? '').trim().toLowerCase();
}

function normalizeChatTitle(chatTitle: string | null | undefined): string | null {
  if (chatTitle == null) return null;
  const trimmed = String(chatTitle).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeText(text: string | null | undefined): string | null {
  if (text == null) return null;
  return String(text);
}

/**
 * Persist a normalized inbound provider event.
 * Duplicate (Provider, ProviderMessageID) pairs return the existing row.
 */
export async function ingestIncomingMessage(
  input: IngestIncomingMessageInput,
  perf?: InboxWebhookPerfSink,
): Promise<IngestIncomingMessageResult> {
  const provider = normalizeProvider(input?.provider ?? '');
  if (!provider) {
    throw new MessageInboxError('provider is required', 'MISSING_PROVIDER');
  }

  const providerMessageId = normalizeProviderMessageId(input?.providerMessageId ?? '');
  if (!providerMessageId) {
    throw new MessageInboxError('providerMessageId is required', 'MISSING_PROVIDER_MESSAGE_ID');
  }

  const phone = normalizeInboxPhone(input?.phone ?? '');
  if (!phone) {
    throw new MessageInboxError('phone is required', 'MISSING_PHONE');
  }

  const messageType = normalizeMessageType(input?.messageType ?? '');
  if (!messageType) {
    throw new MessageInboxError('messageType is required', 'MISSING_MESSAGE_TYPE');
  }

  const receivedAt = parseReceivedAt(input.receivedAt);
  const isGroup = Boolean(input?.isGroup);
  const status = isGroup ? 'ignored' : 'pending';

  perf?.markValidationCompleted();
  perf?.markDbIngestStarted();

  const { row, duplicate } = await insert({
    provider,
    providerMessageId,
    phone,
    chatTitle: normalizeChatTitle(input.chatTitle),
    messageType,
    text: normalizeText(input.text),
    isGroup,
    rawPayloadJson: serializeRawPayload(input.rawPayload),
    status,
    receivedAt,
  });

  perf?.markDbIngestCompleted();

  return {
    inboxId: row.id,
    duplicate,
  };
}
