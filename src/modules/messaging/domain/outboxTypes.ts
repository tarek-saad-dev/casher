export const OUTBOX_MESSAGE_STATUSES = ['pending', 'sending', 'sent', 'failed'] as const;

export type OutboxMessageStatus = (typeof OUTBOX_MESSAGE_STATUSES)[number];

export const DEFAULT_OUTBOX_MAX_ATTEMPTS = 5;

export const MESSAGE_HISTORY_DEFAULT_LIMIT = 50;
export const MESSAGE_HISTORY_MAX_LIMIT = 100;

export type MessageOutboxErrorCode =
  | 'EMPTY_RECIPIENT'
  | 'EMPTY_CONTENT'
  | 'EMPTY_IDEMPOTENCY_KEY'
  | 'UNSUPPORTED_CHANNEL'
  | 'INVALID_METADATA'
  | 'INVALID_CURSOR'
  | 'INVALID_FILTER'
  | 'NOT_FOUND';

export class MessageOutboxError extends Error {
  readonly code: MessageOutboxErrorCode;

  constructor(message: string, code: MessageOutboxErrorCode) {
    super(message);
    this.name = 'MessageOutboxError';
    this.code = code;
  }
}

export type EnqueueMessageInput = {
  channel: 'whatsapp';
  recipient: { phone: string };
  content: { text: string };
  templateKey?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey: string;
  context?: {
    branchId?: number;
    userId?: number;
  };
};

export type EnqueueMessageResult = {
  queued: true;
  messageId: number;
  status: OutboxMessageStatus;
  duplicate: boolean;
};

export type MessageHistoryItem = {
  messageId: number;
  channel: string;
  recipient: string;
  templateKey: string | null;
  content: string;
  status: OutboxMessageStatus;
  metadata: Record<string, unknown> | null;
  attemptCount: number;
  providerMessageId: string | null;
  lastError: string | null;
  branchId: number | null;
  createdByUserId: number | null;
  createdAt: string;
  sentAt: string | null;
  failedAt: string | null;
};

export type ListMessageHistoryInput = {
  branchId?: number;
  status?: OutboxMessageStatus;
  channel?: string;
  limit?: number;
  cursor?: string;
};

export type ListMessageHistoryResult = {
  items: MessageHistoryItem[];
  nextCursor: string | null;
};

export type OutboxMessageRow = {
  id: number;
  channel: string;
  recipient: string;
  templateKey: string | null;
  content: string;
  metadataJson: string | null;
  idempotencyKey: string;
  status: OutboxMessageStatus;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  providerMessageId: string | null;
  lastError: string | null;
  branchId: number | null;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
};

export function isOutboxMessageStatus(value: unknown): value is OutboxMessageStatus {
  return typeof value === 'string' && (OUTBOX_MESSAGE_STATUSES as readonly string[]).includes(value);
}
