import { enqueueMessage } from '@/modules/messaging/application/enqueueMessage';
import {
  getOutboundBotMessageByAiTurnId,
  insertOutboundBotMessage,
} from '@/modules/messaging/conversation/infra/botMessageRepository';
import {
  AI_SYSTEM_INSTRUCTIONS_GROUNDED_V1,
  AI_SYSTEM_INSTRUCTIONS_V1,
} from '../domain/systemInstructions';
import type { AiStructuredResult, AiTurnRow, ProcessAiTurnResult } from '../domain/types';
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
import {
  executeAiToolPlan,
  intentRequiresBusinessTools,
  looksLikeFakeSystemCheck,
  planBusinessToolCalls,
  SAFE_NO_WRITE_BOOKING_REPLY_AR,
  SAFE_TOOL_FAILURE_REPLY_AR,
  type AiToolTrace,
} from '../tools';
import {
  processBookingPlannerTurn,
  type PlannerTurnResult,
} from '../planner/processBookingPlannerTurn';

export type ProcessAiTurnDeps = {
  modelClient: AiModelClient;
  /** Optional override for tests. */
  runTools?: typeof executeAiToolPlan;
  /** Optional override for Phase 3 planner (tests). */
  runPlanner?: typeof processBookingPlannerTurn;
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

function compactToolTrace(trace: AiToolTrace): unknown {
  return {
    truncated: trace.truncated,
    tools: trace.executed.map((t) => ({
      name: t.name,
      ok: t.ok,
      durationMs: t.durationMs,
      input: t.input,
      errorCode: t.errorCode ?? null,
      data: t.data ?? null,
    })),
  };
}

function finalizeReplyAfterTools(args: {
  structured: AiStructuredResult;
  toolTrace: AiToolTrace;
}): AiStructuredResult {
  let replyText = args.structured.replyText.trim();
  const anyOk = args.toolTrace.executed.some((t) => t.ok);
  const anyFailed = args.toolTrace.executed.some((t) => !t.ok);

  if (!replyText) {
    replyText = anyOk
      ? 'تمام، دي المعلومات المتاحة من السيستم.'
      : SAFE_TOOL_FAILURE_REPLY_AR;
  }

  if (looksLikeFakeSystemCheck(replyText)) {
    replyText = anyOk
      ? replyText.replace(
          /ثواني.*?(سيستم|أكد)[^.!؟\n]*/gi,
          'حسب السيستم',
        )
      : SAFE_TOOL_FAILURE_REPLY_AR;
    if (looksLikeFakeSystemCheck(replyText)) {
      replyText = anyOk
        ? 'دي نتيجة السيستم الحالية حسب البيانات المتاحة.'
        : SAFE_TOOL_FAILURE_REPLY_AR;
    }
  }

  if (!anyOk && anyFailed) {
    if (!replyText || looksLikeFakeSystemCheck(replyText)) {
      replyText = SAFE_TOOL_FAILURE_REPLY_AR;
    }
  }

  if (args.structured.intent === 'booking_request') {
    const triedAvailability = args.toolTrace.executed.some((t) => t.name === 'get_availability');
    if (triedAvailability && !/الاستقبال|مش مفعّل|مش مفعل/.test(replyText)) {
      replyText = `${replyText}\n${SAFE_NO_WRITE_BOOKING_REPLY_AR}`.trim();
    }
  }

  return {
    ...args.structured,
    replyText,
    needsBusinessTool: false,
    toolCalls: [],
    shouldReply: true,
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
  const runTools = deps.runTools ?? executeAiToolPlan;

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

    const latestInbound =
      [...context.messages].reverse().find((m) => m.direction === 'inbound')?.text ?? '';

    const modelStarted = performance.now();
    const modelOutput = await deps.modelClient.generateConversationTurn({
      systemInstructions: AI_SYSTEM_INSTRUCTIONS_V1,
      conversation: context,
    });
    let geminiMs = modelOutput.latencyMs ?? performance.now() - modelStarted;

    const validationStarted = performance.now();
    let structured = modelOutput.result;
    timer.markOutputValidationDone(performance.now() - validationStarted);

    let toolTrace: AiToolTrace = { requested: [], executed: [], truncated: false };
    let toolDecisionMs = 0;
    let toolExecMs = 0;
    let groundedMs = 0;
    let plannerResult: PlannerTurnResult | null = null;

    // Phase 3: Booking Planner owns booking_request / availability multi-turn state.
    const runPlanner = deps.runPlanner ?? processBookingPlannerTurn;
    const plannerStarted = performance.now();
    try {
      plannerResult = await runPlanner({
        conversationId: turn.conversationId,
        turnId: turn.turnId,
        phone: context.phone,
        inboundText: latestInbound,
        structured,
      });
    } catch (plannerErr) {
      console.error(
        JSON.stringify({
          type: 'messaging_booking_planner_error',
          turnId: turn.turnId,
          conversationId: turn.conversationId,
          message: plannerErr instanceof Error ? plannerErr.message : String(plannerErr),
        }),
      );
      plannerResult = {
        handled: false,
        preservePlan: false,
        replyText: null,
        plan: null,
        intent: structured.intent,
        trace: {
          conversationId: turn.conversationId,
          planId: null,
          stageBefore: 'none',
          stageAfter: 'none',
          extracted: {},
          validatedChanges: [],
          invalidatedFields: [],
          toolCalls: [],
          missingFields: [],
          candidateSlotCount: 0,
          selectedSlot: null,
          deterministicAction: 'planner_error_fallback',
        },
      };
    }
    const plannerMs = Math.max(0, Math.round(performance.now() - plannerStarted));

    if (plannerResult.handled && plannerResult.replyText) {
      structured = {
        ...structured,
        intent: plannerResult.intent,
        replyText: plannerResult.replyText,
        needsBusinessTool: false,
        toolCalls: [],
        shouldReply: true,
      };
      toolTrace = {
        requested: [],
        executed: plannerResult.trace.toolCalls.map((t) => ({
          name: t.name as 'get_availability',
          ok: t.ok,
          durationMs: t.durationMs,
          input: {},
          errorCode: t.errorCode ?? undefined,
        })),
        truncated: false,
      };
      toolExecMs = plannerMs;
    } else {
      const wantsTools =
        intentRequiresBusinessTools(structured.intent, structured.needsBusinessTool) ||
        structured.toolCalls.length > 0 ||
        looksLikeFakeSystemCheck(structured.replyText);

      if (wantsTools) {
        const planStarted = performance.now();
        const plan = planBusinessToolCalls(structured);
        toolDecisionMs = Math.max(0, Math.round(performance.now() - planStarted));

        if (plan.length > 0) {
          const execStarted = performance.now();
          toolTrace = await runTools(plan, {
            phone: context.phone,
            conversationId: turn.conversationId,
            turnId: turn.turnId,
          });
          toolExecMs = Math.max(0, Math.round(performance.now() - execStarted));

          const groundedStarted = performance.now();
          const grounded = await deps.modelClient.generateConversationTurn({
            systemInstructions: AI_SYSTEM_INSTRUCTIONS_GROUNDED_V1,
            conversation: context,
            toolResultsJson: JSON.stringify(compactToolTrace(toolTrace)),
          });
          groundedMs = grounded.latencyMs ?? Math.max(0, Math.round(performance.now() - groundedStarted));
          geminiMs += groundedMs;
          structured = finalizeReplyAfterTools({
            structured: grounded.result,
            toolTrace,
          });
        } else if (looksLikeFakeSystemCheck(structured.replyText) || structured.needsBusinessTool) {
          structured = {
            ...structured,
            replyText:
              structured.missingInformation.length > 0
                ? `محتاج منك: ${structured.missingInformation.join('، ')}.`
                : structured.intent === 'booking_request'
                  ? 'حاضر، قولي الفرع والخدمة واليوم (ومع مين لو حابب) عشان أشوفلك المواعيد المتاحة من السيستم.'
                  : 'محتاج تفاصيل أوضح عشان أقدر أجاوب من السيستم بدقة.',
            needsBusinessTool: false,
            toolCalls: [],
            shouldReply: true,
          };
        }
      }
    }

    timer.markGeminiDone(geminiMs);

    if (!structured.shouldReply || !structured.replyText.trim()) {
      await markAiTurnCompleted({
        turnId: turn.turnId,
        outboundMessageId: null,
        outboxId: null,
        intent: structured.intent,
        confidence: structured.confidence,
        needsBusinessTool: structured.needsBusinessTool,
        resultJson: JSON.stringify({
          ...structured,
          toolTrace: compactToolTrace(toolTrace),
          timing: { toolDecisionMs, toolExecMs, groundedMs },
        }),
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
          tools: toolTrace.executed.map((t) => ({
            name: t.name,
            ok: t.ok,
            durationMs: t.durationMs,
            errorCode: t.errorCode ?? null,
          })),
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
      needsBusinessTool: Boolean(toolTrace.executed.length) || structured.needsBusinessTool,
      resultJson: JSON.stringify({
        ...structured,
        toolTrace: compactToolTrace(toolTrace),
        bookingPlanner: plannerResult
          ? {
              handled: plannerResult.handled,
              planId: plannerResult.plan?.planId ?? null,
              stage: plannerResult.plan?.stage ?? null,
              trace: plannerResult.trace,
            }
          : null,
        timing: { toolDecisionMs, toolExecMs, groundedMs, plannerMs: plannerResult ? toolExecMs : 0 },
      }),
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
    console.log(
      JSON.stringify({
        type: 'messaging_ai_tool_trace',
        turnId: turn.turnId,
        conversationId: turn.conversationId,
        intent: structured.intent,
        needsBusinessTool: Boolean(toolTrace.executed.length),
        bookingPlanner: plannerResult
          ? {
              handled: plannerResult.handled,
              planId: plannerResult.plan?.planId ?? null,
              stage: plannerResult.plan?.stage ?? plannerResult.trace.stageAfter,
            }
          : null,
        tools: toolTrace.executed.map((t) => ({
          name: t.name,
          ok: t.ok,
          durationMs: t.durationMs,
          errorCode: t.errorCode ?? null,
        })),
        truncated: toolTrace.truncated,
        timing: { toolDecisionMs, toolExecMs, groundedMs },
      }),
    );

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
