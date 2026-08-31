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
import { isConversationOrchestratorV3Enabled } from '../conversationOrchestrator/featureFlag';
import {
  notePlannerConfirmAsk,
  notePlannerSlotAsk,
  orchestrateConversationTurn,
} from '../conversationOrchestrator/orchestrateTurn';
import type { OrchestratorDecision } from '../conversationOrchestrator/types';
import { isCustomerLedConversationV4Enabled } from '../conversationKernel/featureFlag';
import {
  noteKernelConfirmAsk,
  noteKernelSlotAsk,
  processKernelTurn,
} from '../conversationKernel/processKernelTurn';
import type { KernelDecision } from '../conversationKernel/types';
import { isHumanHandoffActiveForPhone } from '@/modules/messaging/handoff/featureFlag';
import {
  HANDOFF_ACK_AR,
  aiIsSuppressed,
  type MessageActorOrigin,
} from '@/modules/messaging/handoff/domain/types';
import { requestCustomerHandoff } from '@/modules/messaging/handoff/application/commands';
import { getConversationControl } from '@/modules/messaging/handoff/infra/conversationControlRepository';
import { automatedOutboundPermitted } from '@/modules/messaging/handoff/domain/classify';
import { logHandoffEvent } from '@/modules/messaging/handoff/observability';

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

  let expectedControlVersionAtClaim: number | null = null;

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

    const handoffActive = isHumanHandoffActiveForPhone(context.phone);
    let liveControl: Awaited<ReturnType<typeof getConversationControl>> = null;
    if (handoffActive) {
      liveControl = await getConversationControl(turn.conversationId);
      if (liveControl && aiIsSuppressed(liveControl.mode)) {
        await markAiTurnSkipped({
          turnId: turn.turnId,
          errorCode: 'CONTROL_MODE_LIVE',
          lastError: `Live ControlMode ${liveControl.mode} skips AI`,
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
          errorCode: 'CONTROL_MODE_LIVE',
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
      expectedControlVersionAtClaim = liveControl?.controlVersion ?? null;
    }

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
    let orchestratorDecision: OrchestratorDecision | null = null;
    let kernelDecision: KernelDecision | null = null;

    // V4: customer-led kernel (sovereign current message) — takes precedence over V3
    if (isCustomerLedConversationV4Enabled()) {
      try {
        kernelDecision = await processKernelTurn({
          conversationId: turn.conversationId,
          inboundText: latestInbound,
          phone: context.phone,
        });
        console.log(
          JSON.stringify({
            type: 'messaging_kernel_v4_trace',
            turnId: turn.turnId,
            conversationId: turn.conversationId,
            ...(kernelDecision?.trace ?? {}),
          }),
        );
      } catch (kernErr) {
        console.error(
          JSON.stringify({
            type: 'messaging_kernel_v4_error',
            turnId: turn.turnId,
            message: kernErr instanceof Error ? kernErr.message : String(kernErr),
          }),
        );
        kernelDecision = null;
      }
    } else if (isConversationOrchestratorV3Enabled()) {
      try {
        orchestratorDecision = await orchestrateConversationTurn({
          conversationId: turn.conversationId,
          inboundText: latestInbound,
        });
        console.log(
          JSON.stringify({
            type: 'messaging_orchestrator_v3_trace',
            turnId: turn.turnId,
            conversationId: turn.conversationId,
            ...(orchestratorDecision?.trace ?? {}),
          }),
        );
      } catch (orchErr) {
        console.error(
          JSON.stringify({
            type: 'messaging_orchestrator_v3_error',
            turnId: turn.turnId,
            message: orchErr instanceof Error ? orchErr.message : String(orchErr),
          }),
        );
        orchestratorDecision = null;
      }
    }

    const activeDecision = kernelDecision ?? orchestratorDecision;

    // Booking Management V1 (flag OFF by default) — lookup/cancel before create planner.
    let managementHandled = false;
    try {
      const { isBookingManagementActiveForPhone } = await import(
        '@/modules/messaging/ai/bookingManagement/featureFlag'
      );
      if (isBookingManagementActiveForPhone(context.phone)) {
        const { processBookingManagementTurn } = await import(
          '@/modules/messaging/ai/bookingManagement/processManagementTurn'
        );
        const mgmt = await processBookingManagementTurn({
          conversationId: turn.conversationId,
          turnId: turn.turnId,
          phone: context.phone,
          inboundText: latestInbound,
          controlAllowsMutation: !liveControl || !aiIsSuppressed(liveControl.mode),
        });
        if (mgmt?.handled && mgmt.replyText) {
          managementHandled = true;
          structured = {
            ...structured,
            intent: 'booking_management',
            replyText: mgmt.replyText,
            needsBusinessTool: false,
            toolCalls: [],
            shouldReply: true,
          };
          toolTrace = {
            requested: [],
            executed: [
              {
                name: 'get_upcoming_bookings',
                ok: true,
                durationMs: 0,
                input: { management: true, planId: mgmt.planId },
                errorCode: undefined,
              },
            ],
            truncated: false,
          };
        }
      }
    } catch (mgmtErr) {
      console.error(
        JSON.stringify({
          type: 'messaging_booking_management_error',
          turnId: turn.turnId,
          message: mgmtErr instanceof Error ? mgmtErr.message : String(mgmtErr),
        }),
      );
    }

    if (managementHandled) {
      // structured already set from Booking Management V1
    } else if (activeDecision?.handled && activeDecision.replyText) {
      const frame = kernelDecision?.turnFrame ?? orchestratorDecision!.turnFrame;
      structured = {
        ...structured,
        intent:
          frame.primaryIntent === 'PRICE_QUERY'
            ? 'price_question'
            : frame.primaryIntent === 'AVAILABILITY_QUERY' ||
                frame.primaryIntent === 'BOOKING_ALTERNATIVE_QUERY' ||
                frame.primaryIntent === 'BRANCH_QUERY'
              ? 'availability_question'
              : structured.intent,
        replyText: activeDecision.replyText,
        needsBusinessTool: false,
        toolCalls: [],
        shouldReply: true,
      };
      toolTrace = {
        requested: [],
        executed: [
          {
            name: 'get_availability',
            ok: true,
            durationMs: 0,
            input: { orchestrator: true, v4: Boolean(kernelDecision) },
            errorCode: undefined,
          },
        ],
        truncated: false,
      };
    } else {
    // Phase 3: Booking Planner owns booking_request / availability multi-turn state.
    // Skip planner when kernel/V3 routes ephemeral queries to Phase 2.
    const skipPlanner = Boolean(activeDecision?.bypassPlanner && activeDecision.passToPhase2);
    const runPlanner = deps.runPlanner ?? processBookingPlannerTurn;
    const plannerStarted = performance.now();
    if (!skipPlanner) {
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
    } else {
      plannerResult = {
        handled: false,
        preservePlan: true,
        replyText: null,
        plan: null,
        intent: structured.intent,
        trace: {
          conversationId: turn.conversationId,
          planId: null,
          stageBefore: 'none',
          stageAfter: 'none',
          extracted: { orchestrator: kernelDecision ? 'v4_phase2' : 'v3_phase2' },
          validatedChanges: [],
          invalidatedFields: [],
          toolCalls: [],
          missingFields: [],
          candidateSlotCount: 0,
          selectedSlot: null,
          deterministicAction: 'orchestrator_v3_phase2',
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
      if (isCustomerLedConversationV4Enabled()) {
        if (/أأكد|اكدلك|أأكدلك|أأكد الحجز|أكد الحجز/.test(plannerResult.replyText)) {
          noteKernelConfirmAsk({
            conversationId: turn.conversationId,
            replyText: plannerResult.replyText,
            planId: plannerResult.plan?.planId ?? null,
            planVersion: plannerResult.plan?.version ?? null,
          });
        } else if (/اختار|الأول|مواعيد|1\)|٢\)|2\)/.test(plannerResult.replyText)) {
          noteKernelSlotAsk({
            conversationId: turn.conversationId,
            replyText: plannerResult.replyText,
          });
        }
      } else if (isConversationOrchestratorV3Enabled()) {
        if (/أأكد|اكدلك|أأكدلك|أأكد الحجز|أكد الحجز/.test(plannerResult.replyText)) {
          notePlannerConfirmAsk({
            conversationId: turn.conversationId,
            replyText: plannerResult.replyText,
            planId: plannerResult.plan?.planId ?? null,
            planVersion: plannerResult.plan?.version ?? null,
          });
        } else if (/اختار|الأول|مواعيد|1\)|٢\)|2\)/.test(plannerResult.replyText)) {
          notePlannerSlotAsk({
            conversationId: turn.conversationId,
            replyText: plannerResult.replyText,
          });
        }
      }
    } else {
      const wantsTools =
        intentRequiresBusinessTools(structured.intent, structured.needsBusinessTool) ||
        structured.toolCalls.length > 0 ||
        looksLikeFakeSystemCheck(structured.replyText) ||
        Boolean(orchestratorDecision?.passToPhase2) ||
        Boolean(kernelDecision?.passToPhase2);

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
    } // end else (!orchestrator handled)

    timer.markGeminiDone(geminiMs);

    let outboundOrigin: MessageActorOrigin = 'BOT';
    let expectedControlVersion: number | null = expectedControlVersionAtClaim;

    if (handoffActive) {
      if (kernelDecision?.route?.action === 'human_handoff') {
        const handoff = await requestCustomerHandoff({
          conversationId: turn.conversationId,
          inboundMessageId: turn.latestInboundMessageId,
        });
        if (!handoff.ack) {
          await markAiTurnCompleted({
            turnId: turn.turnId,
            outboundMessageId: null,
            outboxId: null,
            intent: 'human_request',
            confidence: structured.confidence,
            needsBusinessTool: false,
            resultJson: JSON.stringify({
              ...structured,
              skippedHandoffAck: true,
              toolTrace: compactToolTrace(toolTrace),
            }),
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
        structured = {
          ...structured,
          replyText: HANDOFF_ACK_AR,
          intent: 'human_request',
          shouldReply: true,
          needsBusinessTool: false,
          toolCalls: [],
        };
        outboundOrigin = 'HANDOFF_ACK';
        expectedControlVersion = handoff.state.controlVersion;
      }
    }

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

    if (handoffActive) {
      const liveBeforeSend = await getConversationControl(turn.conversationId);
      if (!liveBeforeSend) {
        await markAiTurnSkipped({
          turnId: turn.turnId,
          errorCode: 'CONTROL_MISSING',
          lastError: 'Conversation control missing before enqueue',
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
      const permitted = automatedOutboundPermitted({
        origin: outboundOrigin,
        liveMode: liveBeforeSend.mode,
        expectedControlVersion,
        liveControlVersion: liveBeforeSend.controlVersion,
      });
      if (!permitted.allowed) {
        logHandoffEvent('ai_outbound_suppressed_before_enqueue', {
          turnId: turn.turnId,
          conversationId: turn.conversationId,
          origin: outboundOrigin,
          reason: permitted.reason,
          expectedControlVersion,
          liveControlVersion: liveBeforeSend.controlVersion,
          liveMode: liveBeforeSend.mode,
        });
        logHandoffEvent('bot_outbound_suppressed_control_version', {
          turnId: turn.turnId,
          conversationId: turn.conversationId,
          origin: outboundOrigin,
          reason: permitted.reason,
          expectedControlVersion,
          liveControlVersion: liveBeforeSend.controlVersion,
          liveMode: liveBeforeSend.mode,
        });
        await markAiTurnSkipped({
          turnId: turn.turnId,
          errorCode: 'CONTROL_VERSION',
          lastError: `suppressed:${permitted.reason}`,
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
          origin: outboundOrigin,
        });
        outboundMessageId = outbound.messageId;
      }
    }
    timer.markReplyPersistDone(performance.now() - persistStarted);

    let outboxId = turn.outboxId;
    const enqueueStarted = performance.now();
    if (outboxId == null) {
      const idempotencyKey =
        outboundOrigin === 'HANDOFF_ACK'
          ? `whatsapp-handoff-ack:${turn.conversationId}:${expectedControlVersion ?? 0}`
          : `whatsapp-bot-ai-turn:${turn.turnId}`;
      const enqueueResult = await enqueueMessage({
        channel: 'whatsapp',
        recipient: { phone: context.phone },
        content: { text: structured.replyText },
        idempotencyKey,
        metadata: {
          source: 'ai-receptionist',
          origin: outboundOrigin,
          turnId: turn.turnId,
          conversationId: turn.conversationId,
          anchorInboundMessageId: turn.anchorInboundMessageId,
          latestInboundMessageId: turn.latestInboundMessageId,
          outboundMessageId,
          expectedControlVersion,
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
