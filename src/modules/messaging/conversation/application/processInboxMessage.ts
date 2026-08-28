import type { MessageInboxRow } from '../../inbox/domain/types';
import type { ProcessInboxMessageResult } from '../domain/types';
import { processInboxMessageAtomic } from '../infra/processInboxMessageAtomic';
import type { InboxProcessorPerfSink } from '../observability/inboxProcessorPerf';

/**
 * Process one claimed inbox row into canonical conversation state.
 * Hot path: single SQL round trip via processInboxMessageAtomic.
 */
export async function processInboxMessage(
  inbox: MessageInboxRow,
  perf?: InboxProcessorPerfSink,
): Promise<ProcessInboxMessageResult & { clientAmbiguous: boolean }> {
  if (inbox.isGroup || inbox.status === 'ignored') {
    throw new Error(`Inbox ${inbox.id} is not processable (group/ignored)`);
  }

  perf?.markConversationDbStarted();
  const started = performance.now();
  const result = await processInboxMessageAtomic(inbox);
  const elapsed = Math.max(0, Math.round(performance.now() - started));
  perf?.markConversationDbDone(elapsed);
  perf?.markMessageCommitDone(elapsed);

  return {
    inboxId: result.inboxId,
    conversationId: result.conversationId,
    messageId: result.messageId,
    duplicate: result.duplicate,
    conversationCreated: result.conversationCreated,
    clientLinked: result.clientLinked,
    clientAmbiguous: result.clientAmbiguous,
  };
}
