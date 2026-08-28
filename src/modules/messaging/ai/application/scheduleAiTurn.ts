import { getAiConfig, getAiWorkerConfig } from '../config';
import { scheduleAiTurnAfterInbound } from '../infra/aiTurnRepository';

export type ScheduleAiTurnInput = {
  conversationId: number;
  inboundMessageId: number;
};

export type ScheduleAiTurnResult = {
  scheduled: boolean;
  turnId: number | null;
  skipped: boolean;
};

/**
 * Schedule durable AI work after canonical inbound message persistence.
 * Does not call Gemini — only inserts/extends a pending TblBotAiTurn row.
 */
export async function scheduleAiTurn(input: ScheduleAiTurnInput): Promise<ScheduleAiTurnResult> {
  const config = getAiConfig();
  if (!config.enabled) {
    return { scheduled: false, turnId: null, skipped: true };
  }

  const workerConfig = getAiWorkerConfig();
  return scheduleAiTurnAfterInbound({
    conversationId: input.conversationId,
    inboundMessageId: input.inboundMessageId,
    debounceMs: config.burstDebounceMs,
    maxRetries: workerConfig.maxRetries,
  });
}
