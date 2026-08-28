import { enqueueMessage } from '@/modules/messaging/application/enqueueMessage';
import {
  getOutboundBotMessageByAiTurnId,
  insertOutboundBotMessage,
} from '@/modules/messaging/conversation/infra/botMessageRepository';
import { AI_SYSTEM_INSTRUCTIONS_V1 } from '../domain/systemInstructions';
import type { AiTurnRow, ProcessAiTurnResult } from '../domain/types';
import type { AiModelClient } from '../model/aiModelClient';
import {
  getAiTurnById,
  markAiTurnCompleted,
  markAiTurnFailed,
  markAiTurnSkipped,
} from '../infra/aiTurnRepository';
import {
  getInboundMessageReceivedAt,
  loadConversationContext,
} from './loadConversationContext';
import {
  AiProcessorPerfTimer,
  computeMsBetween,
  logAiProcessorPerf,
} from '../observability/aiProcessorPerf';

export type ProcessAiTurnDeps = {
  modelClient: AiModelClient;
};

function errorMeta(err: unknown): { message: string; code: string; retryable: boolean } {
  const e = err as { message?: string; code?: string; retryable?: boolean };
  return {
    message: e?.message ?? String(err),
    code: String(e?.code ?? 'AI_PROCESS_FAILED'),
    retryable: e?.retryable === true,
  };
}

async function resumeCompletedTurn(turn: AiTurnRow): Promise<ProcessAiTurnResult> {
  return {
    turnId: turn.turnId,
    status: turn.status,
    duplicate: true,
    outboundMessageId: turn.outboundMessageId,
    outboxId: turn.outboxId,
    skipped: turn.status === 'skipped',
  };
}

export async function processAiTurn(
  turn: AiTurnRow,
  deps: ProcessAiTurnDeps,
): Promise<ProcessAiTurnResult> {
  const timer = AiProcessorPerfTimer.start();
  const pickupStarted = performance.now();
  const fresh = await getAiTurnById(turn.turnId);
  if (!fresh) {
    throw new Error(`AI turn ${turn.turnId} not found`);
  }
  turn = fresh;
  timer.markAiPickupDone(performance.now() - pickupStarted);

  if (turn.status === 'completed' || turn.status === 'skipped' || turn.status === 'failed') {
    return resumeCompletedTurn(turn);
  }

  if (turn.outboundMessageId != null && turn.outboxId != null && turn.resultJson) {
    await markAiTurnCompleted({
      turnId: turn.turnId,
      outboundMessageId: turn.outboundMessageId,
      outboxId: turn.outboxId,
      intent: turn.intent ?? 'unknown',
      confidence: turn.confidence ?? 0,
      needsBusinessTool: turn.needsBusinessTool ?? false,
      resultJson: turn.resultJson,
    });
    return resumeCompletedTurn({ ...turn, status: 'completed' });
  }

  if (turn.controlModeSnapshot !== 'BOT') {
    await markAiTurnSkipped({
      turnId: turn.turnId,
      errorCode: 'CONTROL_MODE',
      lastError: `ControlMode ${turn.controlModeSnapshot} skips AI`,
    });
    logAiProcessorPerf({
      event: 'ai_turn_skipped',
      turnId: turn.turnId,
      conversationId: turn.conversationId,
      anchorInboundMessageId: turn.anchorInboundMessageId,
      latestInboundMessageId: turn.latestInboundMessageId,
      skipped: true,
      ...timer.snapshot(),
      messageReceivedToAiStartMs: null,
      messageReceivedToReplyEnqueuedMs: null,
      errorCode: 'CONTROL_MODE',
    });
    return {
      turnId: turn.turnId,
      status: 'skipped',
      duplicate: false,
      outboundMessageId: null,
      outboxId: null,
      skipped: true,
    };
  }

  const receivedAt = await getInboundMessageReceivedAt(turn.latestInboundMessageId);
  const aiStartAt = new Date();

  try {
    const contextStarted = performance.now();
    const context = await loadConversationContext({
      conversationId: turn.conversationId,
      anchorInboundMessageId: turn.anchorInboundMessageId,
      latestInboundMessageId: turn.latestInboundMessageId,
    });
    timer.markContextLoadDone(performance.now() - contextStarted);

    const debounceUntilMs = new Date(turn.debounceUntil).getTime();
    const nowMs = Date.now();
    if (debounceUntilMs > nowMs) {
      timer.markBurstWaitDone(debounceUntilMs - nowMs);
    }

    const modelStarted = performance.now();
    const modelOutput = await deps.modelClient.generateConversationTurn({
      systemInstructions: AI_SYSTEM_INSTRUCTIONS_V1,
      conversation: context,
    });
    timer.markGeminiDone(modelOutput.latencyMs ?? performance.now() - modelStarted);

    const validationStarted = performance.now();
    const structured = modelOutput.result;
    timer.markOutputValidationDone(performance.now() - validationStarted);

    if (!structured.shouldReply || !structured.replyText.trim()) {
      await markAiTurnCompleted({
        turnId: turn.turnId,
        outboundMessageId: null,
        outboxId: null,
        intent: structured.intent,
        confidence: structured.confidence,
        needsBusinessTool: structured.needsBusinessTool,
        resultJson: JSON.stringify(structured),
      });
      const finishedAt = new Date();
      logAiProcessorPerf({
        event: 'ai_turn_processed',
        turnId: turn.turnId,
        conversationId: turn.conversationId,
        anchorInboundMessageId: turn.anchorInboundMessageId,
        latestInboundMessageId: turn.latestInboundMessageId,
        intent: structured.intent,
        skipped: true,
        ...timer.snapshot(),
        messageReceivedToAiStartMs: computeMsBetween(receivedAt, aiStartAt),
        messageReceivedToReplyEnqueuedMs: computeMsBetween(receivedAt, finishedAt),
      });
      return {
        turnId: turn.turnId,
        status: 'completed',
        duplicate: false,
        outboundMessageId: null,
        outboxId: null,
        skipped: true,
      };
    }

    let outboundMessageId = turn.outboundMessageId;
    const persistStarted = performance.now();
    if (outboundMessageId == null) {
      const existing = await getOutboundBotMessageByAiTurnId(turn.turnId);
      if (existing) {
        outboundMessageId = existing.messageId;
      } else {
        const outbound = await insertOutboundBotMessage({
          conversationId: turn.conversationId,
          turnId: turn.turnId,
          text: structured.replyText,
        });
        outboundMessageId = outbound.messageId;
      }
    }
    timer.markReplyPersistDone(performance.now() - persistStarted);

    let outboxId = turn.outboxId;
    const enqueueStarted = performance.now();
    if (outboxId == null) {
      const enqueueResult = await enqueueMessage({
        channel: 'whatsapp',
        recipient: { phone: context.phone },
        content: { text: structured.replyText },
        idempotencyKey: `whatsapp-bot-ai-turn:${turn.turnId}`,
        metadata: {
          source: 'ai-receptionist',
          turnId: turn.turnId,
          conversationId: turn.conversationId,
          anchorInboundMessageId: turn.anchorInboundMessageId,
          latestInboundMessageId: turn.latestInboundMessageId,
          outboundMessageId,
          intent: structured.intent,
          needsBusinessTool: structured.needsBusinessTool,
        },
        context: {},
      });
      outboxId = enqueueResult.messageId;
    }
    timer.markOutboxEnqueueDone(performance.now() - enqueueStarted);

    await markAiTurnCompleted({
      turnId: turn.turnId,
      outboundMessageId,
      outboxId,
      intent: structured.intent,
      confidence: structured.confidence,
      needsBusinessTool: structured.needsBusinessTool,
      resultJson: JSON.stringify(structured),
    });

    const finishedAt = new Date();
    logAiProcessorPerf({
      event: 'ai_turn_processed',
      turnId: turn.turnId,
      conversationId: turn.conversationId,
      anchorInboundMessageId: turn.anchorInboundMessageId,
      latestInboundMessageId: turn.latestInboundMessageId,
      outboundMessageId,
      outboxId,
      intent: structured.intent,
      duplicate: Boolean(turn.outboundMessageId),
      ...timer.snapshot(),
      messageReceivedToAiStartMs: computeMsBetween(receivedAt, aiStartAt),
      messageReceivedToReplyEnqueuedMs: computeMsBetween(receivedAt, finishedAt),
    });

    return {
      turnId: turn.turnId,
      status: 'completed',
      duplicate: Boolean(turn.outboundMessageId),
      outboundMessageId,
      outboxId,
      skipped: false,
    };
  } catch (err) {
    const meta = errorMeta(err);
    await markAiTurnFailed({
      turnId: turn.turnId,
      errorCode: meta.code,
      lastError: meta.message,
      retryable: meta.retryable,
    });
    logAiProcessorPerf({
      event: 'ai_turn_failed',
      turnId: turn.turnId,
      conversationId: turn.conversationId,
      anchorInboundMessageId: turn.anchorInboundMessageId,
      latestInboundMessageId: turn.latestInboundMessageId,
      ...timer.snapshot(),
      messageReceivedToAiStartMs: computeMsBetween(receivedAt, aiStartAt),
      messageReceivedToReplyEnqueuedMs: null,
      errorCode: meta.code,
    });
    throw err;
  }
}
