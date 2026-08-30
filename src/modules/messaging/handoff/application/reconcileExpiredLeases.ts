import { getPool, sql } from '@/lib/db';
import { scheduleAiTurn } from '@/modules/messaging/ai/application/scheduleAiTurn';
import {
  findLatestUnansweredCustomerTurn,
  resumeClaimKey,
  type TimelineMessage,
} from '../domain/classify';
import { isMessageActorOrigin } from '../domain/types';
import { isHumanHandoffV1Enabled } from '../featureFlag';
import { logHandoffEvent } from '../observability';
import {
  returnConversationToBot,
  type ControlCommandDeps,
} from './commands';

async function loadTimeline(conversationId: number): Promise<TimelineMessage[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('cid', sql.BigInt, conversationId)
    .query(`
      SELECT MessageID, Direction, Origin, OccurredAt
      FROM dbo.TblBotMessage
      WHERE ConversationID = @cid
      ORDER BY OccurredAt ASC, MessageID ASC
    `);
  return (result.recordset as Array<{
    MessageID: number | string;
    Direction: string;
    Origin: string | null;
    OccurredAt: Date | string;
  }>).map((row) => ({
    messageId: Number(row.MessageID),
    direction: row.Direction === 'outbound' ? 'outbound' : 'inbound',
    origin:
      row.Origin && isMessageActorOrigin(row.Origin)
        ? row.Origin
        : row.Direction === 'outbound'
          ? 'BOT'
          : 'CUSTOMER',
    occurredAt:
      row.OccurredAt instanceof Date ? row.OccurredAt.toISOString() : String(row.OccurredAt),
  }));
}

export async function maybeClaimResumeAiTurn(
  input: { conversationId: number },
  deps?: ControlCommandDeps,
): Promise<{ claimed: boolean; latestCustomerMessageId: number | null }> {
  const timeline = await loadTimeline(input.conversationId);
  const latest = findLatestUnansweredCustomerTurn(timeline);
  if (latest == null) {
    logHandoffEvent('resume_no_unanswered_message', { conversationId: input.conversationId });
    return { claimed: false, latestCustomerMessageId: null };
  }
  const store = deps?.store;
  if (!store) {
    const { sqlConversationControlStore } = await import('../infra/sqlControlStore');
    const claim = await sqlConversationControlStore.tryResumeClaim({
      conversationId: input.conversationId,
      latestCustomerMessageId: latest,
      claimKey: resumeClaimKey(input.conversationId, latest),
    });
    if (!claim.claimed) {
      return { claimed: false, latestCustomerMessageId: latest };
    }
  } else {
    const claim = await store.tryResumeClaim({
      conversationId: input.conversationId,
      latestCustomerMessageId: latest,
      claimKey: resumeClaimKey(input.conversationId, latest),
    });
    if (!claim.claimed) {
      return { claimed: false, latestCustomerMessageId: latest };
    }
  }

  await scheduleAiTurn({
    conversationId: input.conversationId,
    inboundMessageId: latest,
  });
  logHandoffEvent('resume_unanswered_claimed', {
    conversationId: input.conversationId,
    latestCustomerMessageId: latest,
  });
  return { claimed: true, latestCustomerMessageId: latest };
}

export async function returnToBotAndMaybeResume(
  input: { conversationId: number; actorUserId: number | null; reason: string },
  deps?: ControlCommandDeps,
): Promise<{ returned: boolean; resumed: boolean; latestCustomerMessageId: number | null }> {
  const result = await returnConversationToBot(input, deps);
  if (!result.changed) {
    return { returned: false, resumed: false, latestCustomerMessageId: null };
  }
  const resume = await maybeClaimResumeAiTurn({ conversationId: input.conversationId }, deps);
  return {
    returned: true,
    resumed: resume.claimed,
    latestCustomerMessageId: resume.latestCustomerMessageId,
  };
}

export async function reconcileExpiredLeases(
  deps?: ControlCommandDeps,
): Promise<{ expired: number; resumed: number }> {
  if (!(deps?.enabled?.() ?? isHumanHandoffV1Enabled())) {
    return { expired: 0, resumed: 0 };
  }
  const store = deps?.store ?? (await import('../infra/sqlControlStore')).sqlConversationControlStore;
  const now = deps?.now?.() ?? new Date();
  const expired = await store.listExpired(now);
  let expiredCount = 0;
  let resumed = 0;
  for (const row of expired) {
    try {
      const result = await returnToBotAndMaybeResume(
        {
          conversationId: row.conversationId,
          actorUserId: null,
          reason: 'lease_expired',
        },
        deps,
      );
      if (result.returned) {
        expiredCount += 1;
        logHandoffEvent('human_lease_expired', {
          conversationId: row.conversationId,
          previousMode: row.mode,
        });
      }
      if (result.resumed) resumed += 1;
    } catch (err) {
      console.error(
        JSON.stringify({
          type: 'human_lease_reconcile_error',
          conversationId: row.conversationId,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return { expired: expiredCount, resumed };
}
