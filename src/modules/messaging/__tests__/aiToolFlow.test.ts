import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiTurnRow, AiStructuredResult } from '@/modules/messaging/ai/domain/types';
import type { AiModelClient } from '@/modules/messaging/ai/model/aiModelClient';

const getAiTurnById = vi.fn();
const markAiTurnCompleted = vi.fn();
const markAiTurnFailed = vi.fn();
const markAiTurnSkipped = vi.fn();
const loadConversationContext = vi.fn();
const getInboundMessageReceivedAt = vi.fn();
const getOutboundBotMessageByAiTurnId = vi.fn();
const insertOutboundBotMessage = vi.fn();
const enqueueMessage = vi.fn();

vi.mock('@/modules/messaging/ai/infra/aiTurnRepository', () => ({
  getAiTurnById: (...args: unknown[]) => getAiTurnById(...args),
  markAiTurnCompleted: (...args: unknown[]) => markAiTurnCompleted(...args),
  markAiTurnFailed: (...args: unknown[]) => markAiTurnFailed(...args),
  markAiTurnSkipped: (...args: unknown[]) => markAiTurnSkipped(...args),
  recoverStaleAiProcessing: vi.fn().mockResolvedValue({ requeued: 0, failed: 0 }),
  scheduleAiTurnAfterInbound: vi.fn(),
  claimPendingAiTurnBatch: vi.fn(),
}));

vi.mock('@/modules/messaging/ai/application/loadConversationContext', () => ({
  loadConversationContext: (...args: unknown[]) => loadConversationContext(...args),
  getInboundMessageReceivedAt: (...args: unknown[]) => getInboundMessageReceivedAt(...args),
}));

vi.mock('@/modules/messaging/conversation/infra/botMessageRepository', () => ({
  getOutboundBotMessageByAiTurnId: (...args: unknown[]) => getOutboundBotMessageByAiTurnId(...args),
  insertOutboundBotMessage: (...args: unknown[]) => insertOutboundBotMessage(...args),
}));

vi.mock('@/modules/messaging/application/enqueueMessage', () => ({
  enqueueMessage: (...args: unknown[]) => enqueueMessage(...args),
}));

vi.mock('@/modules/messaging/ai/planner/processBookingPlannerTurn', () => ({
  processBookingPlannerTurn: vi.fn(async () => ({
    handled: false,
    preservePlan: false,
    replyText: null,
    plan: null,
    intent: 'unknown',
    trace: {
      conversationId: 10,
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
      deterministicAction: null,
    },
  })),
}));

import { processAiTurn } from '@/modules/messaging/ai/application/processAiTurn';

function turnRow(overrides: Partial<AiTurnRow> = {}): AiTurnRow {
  return {
    turnId: 55,
    conversationId: 10,
    anchorInboundMessageId: 100,
    latestInboundMessageId: 100,
    status: 'processing',
    controlModeSnapshot: 'BOT',
    debounceUntil: new Date(Date.now() - 1000).toISOString(),
    outboundMessageId: null,
    outboxId: null,
    intent: null,
    confidence: null,
    needsBusinessTool: null,
    resultJson: null,
    lastError: null,
    errorCode: null,
    retryCount: 0,
    maxRetries: 3,
    nextAttemptAt: null,
    processingStartedAt: new Date().toISOString(),
    completedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    ...overrides,
  };
}

function structured(over: Partial<AiStructuredResult> = {}): AiStructuredResult {
  return {
    replyText: '',
    intent: 'price_question',
    confidence: 0.95,
    needsBusinessTool: true,
    missingInformation: [],
    entities: {
      dateText: null,
      timeText: null,
      employeeName: null,
      serviceText: 'شعر ودقن',
      branchText: null,
    },
    shouldReply: true,
    toolCalls: [{ name: 'list_services', branchCode: null, serviceQuery: 'شعر ودقن', employeeName: null, dateText: null, timePreference: null }],
    ...over,
  };
}

describe('Phase 2 AI tool flow in processAiTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAiTurnById.mockImplementation(async (id: number) => turnRow({ turnId: id }));
    getInboundMessageReceivedAt.mockResolvedValue('2026-08-29T10:00:00.000Z');
    loadConversationContext.mockResolvedValue({
      conversationId: 10,
      phone: '201557994946',
      controlMode: 'BOT',
      burstInboundMessageIds: [100],
      messages: [
        { messageId: 100, direction: 'inbound', text: 'شعر ودقن بكام؟', occurredAt: '2026-08-29T10:00:00.000Z' },
      ],
    });
    getOutboundBotMessageByAiTurnId.mockResolvedValue(null);
    insertOutboundBotMessage.mockResolvedValue({ messageId: 501 });
    enqueueMessage.mockResolvedValue({ messageId: 9001, duplicate: false });
    markAiTurnCompleted.mockResolvedValue(undefined);
  });

  it('15 greeting uses no tool', async () => {
    const modelClient: AiModelClient = {
      async generateConversationTurn() {
        return {
          result: structured({
            intent: 'greeting',
            needsBusinessTool: false,
            toolCalls: [],
            replyText: 'أهلاً بيك',
          }),
          model: 'test',
          latencyMs: 5,
        };
      },
    };
    const runTools = vi.fn();
    await processAiTurn(turnRow(), { modelClient, runTools });
    expect(runTools).not.toHaveBeenCalled();
  });

  it('16 price question calls service tool and grounds reply', async () => {
    let call = 0;
    const modelClient: AiModelClient = {
      async generateConversationTurn(input) {
        call += 1;
        if (call === 1) {
          return { result: structured(), model: 'test', latencyMs: 5 };
        }
        expect(input.toolResultsJson).toContain('list_services');
        return {
          result: structured({
            replyText: 'شعر ودقن بـ 250 جنيه.',
            needsBusinessTool: false,
            toolCalls: [],
          }),
          model: 'test',
          latencyMs: 8,
        };
      },
    };
    const runTools = vi.fn(async () => ({
      requested: [{ name: 'list_services' as const, serviceQuery: 'شعر ودقن' }],
      truncated: false,
      executed: [
        {
          name: 'list_services' as const,
          ok: true,
          durationMs: 12,
          input: { serviceQuery: 'شعر ودقن' },
          data: { services: [{ nameAr: 'شعر ودقن', price: 250 }] },
        },
      ],
    }));

    await processAiTurn(turnRow(), { modelClient, runTools });
    expect(runTools).toHaveBeenCalledTimes(1);
    expect(insertOutboundBotMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('250') }),
    );
    const resultJson = JSON.parse(markAiTurnCompleted.mock.calls[0][0].resultJson);
    expect(resultJson.toolTrace.tools[0].name).toBe('list_services');
  });

  it('20 tool failure produces safe reply', async () => {
    let call = 0;
    const modelClient: AiModelClient = {
      async generateConversationTurn() {
        call += 1;
        if (call === 1) return { result: structured(), model: 'test', latencyMs: 5 };
        return {
          result: structured({
            replyText: 'ثواني أراجع السيستم',
            needsBusinessTool: false,
            toolCalls: [],
          }),
          model: 'test',
          latencyMs: 5,
        };
      },
    };
    const runTools = vi.fn(async () => ({
      requested: [{ name: 'list_services' as const }],
      truncated: false,
      executed: [
        {
          name: 'list_services' as const,
          ok: false,
          durationMs: 3,
          input: {},
          errorCode: 'SERVICE_LOOKUP_FAILED',
          errorMessage: 'boom',
        },
      ],
    }));

    await processAiTurn(turnRow(), { modelClient, runTools });
    const text = insertOutboundBotMessage.mock.calls[0][0].text as string;
    expect(text).not.toMatch(/أراجع السيستم/);
    expect(text.length).toBeGreaterThan(10);
  });

  it('22 no fake checking without execution when entities missing', async () => {
    const modelClient: AiModelClient = {
      async generateConversationTurn() {
        return {
          result: structured({
            intent: 'booking_request',
            needsBusinessTool: true,
            toolCalls: [],
            entities: {
              dateText: null,
              timeText: null,
              employeeName: null,
              serviceText: null,
              branchText: null,
            },
            replyText: 'ثواني هأكدلك الحجز من السيستم',
          }),
          model: 'test',
          latencyMs: 5,
        };
      },
    };
    const runTools = vi.fn();
    await processAiTurn(turnRow(), { modelClient, runTools });
    expect(runTools).not.toHaveBeenCalled();
    const text = insertOutboundBotMessage.mock.calls[0][0].text as string;
    expect(text).not.toMatch(/هأكدلك الحجز من السيستم/);
  });
});
