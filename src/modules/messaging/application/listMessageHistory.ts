import {
  isOutboxMessageStatus,
  MESSAGE_HISTORY_DEFAULT_LIMIT,
  MESSAGE_HISTORY_MAX_LIMIT,
  MessageOutboxError,
  type ListMessageHistoryInput,
  type ListMessageHistoryResult,
  type MessageHistoryItem,
} from '../domain/outboxTypes';
import { SUPPORTED_MESSAGE_CHANNELS } from '../domain/types';
import { decodeMessageHistoryCursor, encodeMessageHistoryCursor } from '../outbox/historyCursor';
import { list as listOutboxRows } from '../outbox/messageOutboxRepository';
import { parseOutboxMetadataJson } from '../outbox/serializeMetadata';

function clampHistoryLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return MESSAGE_HISTORY_DEFAULT_LIMIT;
  return Math.min(MESSAGE_HISTORY_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/**
 * Bounded newest-first outbox history. No HTTP/UI in Phase 5A.
 */
export async function listMessageHistory(
  input: ListMessageHistoryInput = {},
): Promise<ListMessageHistoryResult> {
  const limit = clampHistoryLimit(input.limit);

  if (input.status != null && !isOutboxMessageStatus(input.status)) {
    throw new MessageOutboxError('Unsupported outbox status filter', 'INVALID_FILTER');
  }

  const channel = input.channel != null ? String(input.channel).trim() : undefined;
  if (channel && !(SUPPORTED_MESSAGE_CHANNELS as readonly string[]).includes(channel)) {
    throw new MessageOutboxError('Unsupported messaging channel filter', 'INVALID_FILTER');
  }

  const branchId =
    typeof input.branchId === 'number' && Number.isFinite(input.branchId) ? input.branchId : undefined;

  let cursorCreatedAt: Date | null = null;
  let cursorId: number | null = null;
  if (input.cursor != null && String(input.cursor).trim() !== '') {
    const decoded = decodeMessageHistoryCursor(input.cursor);
    cursorCreatedAt = new Date(decoded.createdAt);
    cursorId = decoded.id;
  }

  const rows = await listOutboxRows({
    branchId: branchId ?? null,
    status: input.status ?? null,
    channel: channel ?? null,
    cursorCreatedAt,
    cursorId,
    fetchLimit: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last ? encodeMessageHistoryCursor(last.createdAt, last.id) : null;

  const items: MessageHistoryItem[] = page.map((row) => ({
    messageId: row.id,
    channel: row.channel,
    recipient: row.recipient,
    templateKey: row.templateKey,
    content: row.content,
    status: row.status,
    metadata: parseOutboxMetadataJson(row.metadataJson),
    attemptCount: row.attemptCount,
    providerMessageId: row.providerMessageId,
    lastError: row.lastError,
    branchId: row.branchId,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    sentAt: row.sentAt,
    failedAt: row.failedAt,
  }));

  return { items, nextCursor };
}
