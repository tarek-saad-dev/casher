import { getConversationById } from '../infra/botConversationRepository';
import { listMessagesByConversation } from '../infra/botMessageRepository';

export const CONVERSATION_MESSAGES_DEFAULT_LIMIT = 50;
export const CONVERSATION_MESSAGES_MAX_LIMIT = 200;

export async function listConversationMessages(input: {
  conversationId: number;
  limit?: number | null;
}) {
  const limit = Math.max(
    1,
    Math.min(
      CONVERSATION_MESSAGES_MAX_LIMIT,
      Math.floor(
        Number(input.limit ?? CONVERSATION_MESSAGES_DEFAULT_LIMIT) ||
          CONVERSATION_MESSAGES_DEFAULT_LIMIT,
      ),
    ),
  );

  const conversation = await getConversationById(input.conversationId);
  if (!conversation) {
    return { conversation: null, items: [], limit };
  }

  const items = await listMessagesByConversation({
    conversationId: input.conversationId,
    fetchLimit: limit,
  });

  return { conversation, items, limit };
}
