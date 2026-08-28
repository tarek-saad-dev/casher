export const MESSAGE_INBOX_STATUSES = [
  'pending',
  'processing',
  'completed',
  'failed',
  'ignored',
] as const;

export type MessageInboxStatus = (typeof MESSAGE_INBOX_STATUSES)[number];

export type MessageInboxRow = {
  id: number;
  provider: string;
  providerMessageId: string;
  phone: string;
  chatTitle: string | null;
  messageType: string;
  text: string | null;
  isGroup: boolean;
  rawPayload: string | null;
  status: MessageInboxStatus;
  retryCount: number;
  lastError: string | null;
  receivedAt: string;
  processingStartedAt: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type MessageInboxListItem = {
  id: number;
  provider: string;
  providerMessageId: string;
  phone: string;
  chatTitle: string | null;
  messageType: string;
  text: string | null;
  isGroup: boolean;
  status: MessageInboxStatus;
  retryCount: number;
  receivedAt: string;
  createdAt: string;
};

export type IngestIncomingMessageInput = {
  provider: string;
  providerMessageId: string;
  phone: string;
  chatTitle?: string | null;
  messageType: string;
  text?: string | null;
  isGroup?: boolean;
  receivedAt: string | Date;
  rawPayload?: unknown;
};

export type IngestIncomingMessageResult = {
  inboxId: number;
  duplicate: boolean;
};

export class MessageInboxError extends Error {
  readonly code:
    | 'INVALID_INPUT'
    | 'MISSING_PROVIDER'
    | 'MISSING_PROVIDER_MESSAGE_ID'
    | 'MISSING_PHONE'
    | 'MISSING_MESSAGE_TYPE'
    | 'MISSING_RECEIVED_AT'
    | 'INVALID_RECEIVED_AT';

  constructor(
    message: string,
    code: MessageInboxError['code'],
  ) {
    super(message);
    this.name = 'MessageInboxError';
    this.code = code;
  }
}

export function isMessageInboxStatus(value: string): value is MessageInboxStatus {
  return (MESSAGE_INBOX_STATUSES as readonly string[]).includes(value);
}
