import { SUPPORTED_MESSAGE_CHANNELS } from '../domain/types';
import {
  MessageOutboxError,
  type EnqueueMessageInput,
  type EnqueueMessageResult,
} from '../domain/outboxTypes';
import { enqueue as enqueueOutboxRow } from '../outbox/messageOutboxRepository';
import { serializeOutboxMetadata } from '../outbox/serializeMetadata';

function isSupportedChannel(channel: string): channel is 'whatsapp' {
  return (SUPPORTED_MESSAGE_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Persist a rendered message snapshot in the outbox.
 * Does not send. Status / attempts / provider IDs are infrastructure-owned.
 */
export async function enqueueMessage(input: EnqueueMessageInput): Promise<EnqueueMessageResult> {
  const channel = String(input?.channel ?? '');
  if (!isSupportedChannel(channel)) {
    throw new MessageOutboxError('Unsupported messaging channel', 'UNSUPPORTED_CHANNEL');
  }

  const phone = String(input?.recipient?.phone ?? '').trim();
  if (!phone) {
    throw new MessageOutboxError('Recipient phone is required', 'EMPTY_RECIPIENT');
  }

  const text = String(input?.content?.text ?? '');
  if (text.trim().length === 0) {
    throw new MessageOutboxError('Message content is required', 'EMPTY_CONTENT');
  }

  const idempotencyKey = String(input?.idempotencyKey ?? '').trim();
  if (!idempotencyKey) {
    throw new MessageOutboxError('Idempotency key is required', 'EMPTY_IDEMPOTENCY_KEY');
  }

  const templateRaw = input?.templateKey;
  const templateKey =
    typeof templateRaw === 'string' && templateRaw.trim().length > 0 ? templateRaw.trim() : null;

  const metadataJson = serializeOutboxMetadata(input?.metadata);

  const branchId =
    typeof input?.context?.branchId === 'number' && Number.isFinite(input.context.branchId)
      ? input.context.branchId
      : null;
  const createdByUserId =
    typeof input?.context?.userId === 'number' && Number.isFinite(input.context.userId)
      ? input.context.userId
      : null;

  const { row, duplicate } = await enqueueOutboxRow({
    channel,
    recipient: phone,
    content: text,
    templateKey,
    metadataJson,
    idempotencyKey,
    branchId,
    createdByUserId,
  });

  return {
    queued: true,
    messageId: row.id,
    status: row.status,
    duplicate,
  };
}
