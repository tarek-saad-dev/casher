import {
  isMessageInboxStatus,
  type MessageInboxListItem,
  type MessageInboxStatus,
} from '../domain/types';
import { list as listInboxRows } from '../infra/messageInboxRepository';

export const MESSAGE_INBOX_DEFAULT_LIMIT = 50;
export const MESSAGE_INBOX_MAX_LIMIT = 200;

export type ListInboxMessagesInput = {
  status?: string | null;
  limit?: number | null;
};

export type ListInboxMessagesResult = {
  items: MessageInboxListItem[];
  limit: number;
};

export async function listInboxMessages(
  input: ListInboxMessagesInput = {},
): Promise<ListInboxMessagesResult> {
  const rawLimit = input.limit ?? MESSAGE_INBOX_DEFAULT_LIMIT;
  const limit = Math.max(
    1,
    Math.min(MESSAGE_INBOX_MAX_LIMIT, Math.floor(Number(rawLimit) || MESSAGE_INBOX_DEFAULT_LIMIT)),
  );

  const statusRaw = input.status == null ? null : String(input.status).trim().toLowerCase();
  const status: MessageInboxStatus | null =
    statusRaw && isMessageInboxStatus(statusRaw) ? statusRaw : null;

  const items = await listInboxRows({
    status,
    fetchLimit: limit,
  });

  return { items, limit };
}
