import { listConversations as listConversationRows } from '../infra/botConversationRepository';

export const CONVERSATION_LIST_DEFAULT_LIMIT = 50;
export const CONVERSATION_LIST_MAX_LIMIT = 200;

export async function listConversations(input: { limit?: number | null } = {}) {
  const limit = Math.max(
    1,
    Math.min(
      CONVERSATION_LIST_MAX_LIMIT,
      Math.floor(Number(input.limit ?? CONVERSATION_LIST_DEFAULT_LIMIT) || CONVERSATION_LIST_DEFAULT_LIMIT),
    ),
  );
  const items = await listConversationRows({ fetchLimit: limit });
  return { items, limit };
}
