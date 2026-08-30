import {
  claimPendingBatch,
  markFailed,
  recoverStaleProcessing,
} from '../../inbox/infra/messageInboxRepository';
import { processInboxMessage } from './processInboxMessage';
import { scheduleAiTurn } from '../../ai/application/scheduleAiTurn';
import {
  computePersistedToReadyMs,
  InboxProcessorPerfTimer,
  logInboxProcessorPerf,
} from '../observability/inboxProcessorPerf';
import { isHumanHandoffV1Enabled } from '@/modules/messaging/handoff/featureFlag';

export type ProcessInboxTickInput = {
  batchSize: number;
  staleProcessingMs: number;
};

export type ProcessInboxTickResult = {
  recoveredCompleted: number;
  recoveredRequeued: number;
  claimed: number;
  processed: number;
  duplicates: number;
  failed: number;
  skippedIgnored: number;
  leasesExpired?: number;
  resumesClaimed?: number;
};

export async function processInboxTick(
  input: ProcessInboxTickInput,
): Promise<ProcessInboxTickResult> {
  const recovery = await recoverStaleProcessing({ staleMs: input.staleProcessingMs });

  const claimStarted = performance.now();
  const claimed = await claimPendingBatch({ batchSize: input.batchSize });
  const claimDbMs = Math.max(0, Math.round(performance.now() - claimStarted));
  const claimFinishedAt = new Date();

  const summary: ProcessInboxTickResult = {
    recoveredCompleted: recovery.completed,
    recoveredRequeued: recovery.requeued,
    claimed: claimed.length,
    processed: 0,
    duplicates: 0,
    failed: 0,
    skippedIgnored: 0,
  };

  for (const row of claimed) {
    const timer = InboxProcessorPerfTimer.start();
    timer.markClaimDbDone(claimDbMs);
    const workerWakeMs = computePersistedToReadyMs(row.createdAt, claimFinishedAt);

    if (row.isGroup || row.status === 'ignored') {
      summary.skippedIgnored += 1;
      logInboxProcessorPerf({
        event: 'inbox_message_skipped',
        inboxId: row.id,
        provider: row.provider,
        providerMessageId: row.providerMessageId,
        duplicate: false,
        conversationCreated: false,
        clientLinked: false,
        workerWakeMs,
        claimDbMs,
        conversationDbMs: null,
        clientLookupMs: null,
        messageCommitMs: null,
        processorTotalMs: timer.snapshot().processorTotalMs,
        inboxPersistedToConversationReadyMs: null,
        sqlRoundTrips: null,
        errorCode: 'ignored_group',
      });
      continue;
    }

    try {
      const result = await processInboxMessage(row, timer);
      const timing = timer.snapshot();
      const readyAt = new Date();

      if (result.duplicate) summary.duplicates += 1;
      else {
        summary.processed += 1;
        if (result.conversationId != null && result.messageId != null) {
          try {
            await scheduleAiTurn({
              conversationId: result.conversationId,
              inboundMessageId: result.messageId,
            });
          } catch (scheduleErr) {
            const scheduleMessage =
              scheduleErr instanceof Error ? scheduleErr.message : String(scheduleErr);
            console.error(
              JSON.stringify({
                type: 'messaging_ai_schedule_failed',
                inboxId: row.id,
                conversationId: result.conversationId,
                messageId: result.messageId,
                error: scheduleMessage,
              }),
            );
          }
        }
      }

      logInboxProcessorPerf({
        event: 'inbox_message_processed',
        inboxId: row.id,
        conversationId: result.conversationId,
        messageId: result.messageId,
        provider: row.provider,
        providerMessageId: row.providerMessageId,
        duplicate: result.duplicate,
        conversationCreated: result.conversationCreated,
        clientLinked: result.clientLinked,
        clientAmbiguous: result.clientAmbiguous,
        workerWakeMs,
        claimDbMs: timing.claimDbMs,
        conversationDbMs: timing.conversationDbMs,
        clientLookupMs: timing.clientLookupMs,
        messageCommitMs: timing.messageCommitMs,
        processorTotalMs: timing.processorTotalMs,
        inboxPersistedToConversationReadyMs: computePersistedToReadyMs(row.createdAt, readyAt),
        sqlRoundTrips: 1,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markFailed({ id: row.id, lastError: message });
      summary.failed += 1;
      const timing = timer.snapshot();
      logInboxProcessorPerf({
        event: 'inbox_message_failed',
        inboxId: row.id,
        provider: row.provider,
        providerMessageId: row.providerMessageId,
        duplicate: false,
        conversationCreated: false,
        clientLinked: false,
        workerWakeMs,
        claimDbMs: timing.claimDbMs,
        conversationDbMs: timing.conversationDbMs,
        clientLookupMs: timing.clientLookupMs,
        messageCommitMs: timing.messageCommitMs,
        processorTotalMs: timing.processorTotalMs,
        inboxPersistedToConversationReadyMs: null,
        sqlRoundTrips: null,
        errorCode: 'PROCESS_FAILED',
      });
    }
  }

  if (isHumanHandoffV1Enabled()) {
    try {
      const { reconcileExpiredLeases } = await import(
        '@/modules/messaging/handoff/application/reconcileExpiredLeases'
      );
      const lease = await reconcileExpiredLeases();
      summary.leasesExpired = lease.expired;
      summary.resumesClaimed = lease.resumed;
    } catch (err) {
      console.error(
        JSON.stringify({
          type: 'human_lease_reconcile_tick_failed',
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return summary;
}
