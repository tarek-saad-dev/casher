import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AiTurnRow, AiStructuredResult } from '@/modules/messaging/ai/domain/types';
import type { AiModelClient } from '@/modules/messaging/ai/model/aiModelClient';

const scheduleAiTurnAfterInbound = vi.fn();
const claimPendingAiTurnBatch = vi.fn();
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
  scheduleAiTurnAfterInbound: (...args: unknown[]) => scheduleAiTurnAfterInbound(...args),
  claimPendingAiTurnBatch: (...args: unknown[]) => claimPendingAiTurnBatch(...args),
  getAiTurnById: (...args: unknown[]) => getAiTurnById(...args),
  markAiTurnCompleted: (...args: unknown[]) => markAiTurnCompleted(...args),
  markAiTurnFailed: (...args: unknown[]) => markAiTurnFailed(...args),
  markAiTurnSkipped: (...args: unknown[]) => markAiTurnSkipped(...args),
  recoverStaleAiProcessing: vi.fn().mockResolvedValue({ requeued: 0, failed: 0 }),
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

import { scheduleAiTurn } from '@/modules/messaging/ai/application/scheduleAiTurn';
import { processAiTurn } from '@/modules/messaging/ai/application/processAiTurn';
import {
  parseAiStructuredResult,
  validateAiStructuredResult,
} from '@/modules/messaging/ai/domain/structuredOutput';

function turnRow(overrides: Partial<AiTurnRow> = {}): AiTurnRow {
  return {
    turnId: 1,
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

function structured(overrides: Partial<AiStructuredResult> = {}): AiStructuredResult {
  return {
    replyText: 'أهلاً! إزيك؟',
    intent: 'greeting',
    confidence: 0.9,
    needsBusinessTool: false,
    missingInformation: [],
    entities: {
      dateText: null,
      timeText: null,
      employeeName: null,
      serviceText: null,
      branchText: null,
    },
    shouldReply: true,
    toolCalls: [],
    ...overrides,
  };
}

function modelClient(result: AiStructuredResult): AiModelClient {
  return {
    async generateConversationTurn() {
      return { result, model: 'test-model', latencyMs: 12 };
    },
  };
}

describe('Phase 3 AI processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-key';
    getAiTurnById.mockImplementation(async (id: number) => turnRow({ turnId: id }));
    getInboundMessageReceivedAt.mockResolvedValue('2026-08-28T07:00:00.000Z');
    loadConversationContext.mockResolvedValue({
      conversationId: 10,
      phone: '201234567890',
      controlMode: 'BOT',
      burstInboundMessageIds: [100],
      messages: [{ messageId: 100, direction: 'inbound', text: 'مساء الخير', occurredAt: '2026-08-28T07:00:00.000Z' }],
    });
    getOutboundBotMessageByAiTurnId.mockResolvedValue(null);
    insertOutboundBotMessage.mockResolvedValue({
      messageId: 500,
      conversationId: 10,
      inboxId: null,
      direction: 'outbound',
      provider: 'casher-ai',
      providerMessageId: 'turn:1',
      messageType: 'text',
      text: 'أهلاً! إزيك؟',
      occurredAt: '2026-08-28T07:00:01.000Z',
      createdAt: '2026-08-28T07:00:01.000Z',
    });
    enqueueMessage.mockResolvedValue({ queued: true, messageId: 900, status: 'pending', duplicate: false });
    markAiTurnCompleted.mockResolvedValue(undefined);
    markAiTurnFailed.mockResolvedValue(undefined);
    markAiTurnSkipped.mockResolvedValue(undefined);
    scheduleAiTurnAfterInbound.mockResolvedValue({ scheduled: true, turnId: 1, skipped: false });
  });

  it('A — schedules AI work once per inbound message', async () => {
    const result = await scheduleAiTurn({ conversationId: 10, inboundMessageId: 100 });
    expect(result.scheduled).toBe(true);
    expect(scheduleAiTurnAfterInbound).toHaveBeenCalledTimes(1);
  });

  it('B — duplicate AI processing does not duplicate reply', async () => {
    getAiTurnById.mockResolvedValue(
      turnRow({ outboundMessageId: 500, outboxId: 900, resultJson: JSON.stringify(structured()) }),
    );
    const result = await processAiTurn(turnRow(), { modelClient: modelClient(structured()) });
    expect(result.duplicate).toBe(true);
    expect(insertOutboundBotMessage).not.toHaveBeenCalled();
    expect(enqueueMessage).not.toHaveBeenCalled();
  });

  it('C — validates Gemini structured result', () => {
    const parsed = parseAiStructuredResult({
      replyText: 'تمام',
      intent: 'booking_request',
      confidence: 0.94,
      needsBusinessTool: true,
      missingInformation: ['employee'],
      entities: { serviceText: 'قص شعر' },
      shouldReply: true,
    });
    expect(() => validateAiStructuredResult(parsed)).not.toThrow();
    expect(parsed.intent).toBe('booking_request');
    expect(parsed.needsBusinessTool).toBe(true);
  });

  it('D — malformed model output fails validation', () => {
    const parsed = parseAiStructuredResult({
      replyText: 'x',
      intent: 'greeting',
      confidence: 0.5,
      needsBusinessTool: false,
      shouldReply: true,
    });
    parsed.replyText = '';
    expect(() => validateAiStructuredResult(parsed)).toThrow(/replyText/);
  });

  it('E — retryable Gemini error requeues via markAiTurnFailed', async () => {
    const failingClient: AiModelClient = {
      async generateConversationTurn() {
        throw Object.assign(new Error('rate limit'), { code: 'AI_RATE_LIMIT', retryable: true });
      },
    };
    await expect(processAiTurn(turnRow(), { modelClient: failingClient })).rejects.toThrow(/rate limit/);
    expect(markAiTurnFailed).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: true, errorCode: 'AI_RATE_LIMIT' }),
    );
    expect(insertOutboundBotMessage).not.toHaveBeenCalled();
  });

  it('F — permanent error marks failed without reply', async () => {
    const failingClient: AiModelClient = {
      async generateConversationTurn() {
        throw Object.assign(new Error('bad key'), { code: 'AI_NOT_CONFIGURED', retryable: false });
      },
    };
    await expect(processAiTurn(turnRow(), { modelClient: failingClient })).rejects.toThrow(/bad key/);
    expect(markAiTurnFailed).toHaveBeenCalledWith(expect.objectContaining({ retryable: false }));
  });

  it('G — crash after reply persisted completes without duplicate outbox', async () => {
    getAiTurnById.mockResolvedValue(
      turnRow({
        outboundMessageId: 500,
        outboxId: 900,
        resultJson: JSON.stringify(structured()),
      }),
    );
    const result = await processAiTurn(turnRow(), { modelClient: modelClient(structured()) });
    expect(result.status).toBe('completed');
    expect(enqueueMessage).not.toHaveBeenCalled();
    expect(markAiTurnCompleted).toHaveBeenCalled();
  });

  it('H — conversation context preserves ordering', async () => {
    getAiTurnById.mockResolvedValue(turnRow({ latestInboundMessageId: 101 }));
    loadConversationContext.mockResolvedValue({
      conversationId: 10,
      phone: '201234567890',
      controlMode: 'BOT',
      burstInboundMessageIds: [100, 101],
      messages: [
        { messageId: 100, direction: 'inbound', text: 'أول', occurredAt: '2026-08-28T07:00:00.000Z' },
        { messageId: 101, direction: 'inbound', text: 'تاني', occurredAt: '2026-08-28T07:00:01.000Z' },
      ],
    });
    await processAiTurn(turnRow({ latestInboundMessageId: 101 }), {
      modelClient: modelClient(structured({ replyText: 'تمام يا باشا' })),
    });
    expect(loadConversationContext).toHaveBeenCalledWith(
      expect.objectContaining({ anchorInboundMessageId: 100, latestInboundMessageId: 101 }),
    );
  });

  it('I — burst coalescing is handled at schedule layer', async () => {
    scheduleAiTurnAfterInbound.mockResolvedValueOnce({ scheduled: true, turnId: 1, skipped: false });
    await scheduleAiTurn({ conversationId: 10, inboundMessageId: 100 });
    scheduleAiTurnAfterInbound.mockResolvedValueOnce({ scheduled: true, turnId: 1, skipped: false });
    await scheduleAiTurn({ conversationId: 10, inboundMessageId: 101 });
    expect(scheduleAiTurnAfterInbound).toHaveBeenCalledTimes(2);
  });

  it('J — two conversations remain independent', async () => {
    await scheduleAiTurn({ conversationId: 10, inboundMessageId: 100 });
    await scheduleAiTurn({ conversationId: 11, inboundMessageId: 200 });
    expect(scheduleAiTurnAfterInbound).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ conversationId: 10, inboundMessageId: 100 }),
    );
    expect(scheduleAiTurnAfterInbound).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ conversationId: 11, inboundMessageId: 200 }),
    );
  });

  it('K — HUMAN conversation produces no AI reply', async () => {
    getAiTurnById.mockResolvedValue(turnRow({ controlModeSnapshot: 'HUMAN' }));
    const result = await processAiTurn(turnRow({ controlModeSnapshot: 'HUMAN' }), {
      modelClient: modelClient(structured()),
    });
    expect(result.skipped).toBe(true);
    expect(markAiTurnSkipped).toHaveBeenCalled();
    expect(enqueueMessage).not.toHaveBeenCalled();
  });

  it('L — PAUSED conversation produces no AI reply', async () => {
    getAiTurnById.mockResolvedValue(turnRow({ controlModeSnapshot: 'PAUSED' }));
    const result = await processAiTurn(turnRow({ controlModeSnapshot: 'PAUSED' }), {
      modelClient: modelClient(structured()),
    });
    expect(result.skipped).toBe(true);
    expect(enqueueMessage).not.toHaveBeenCalled();
  });

  it('M — Arabic response preserved correctly', async () => {
    const arabic = 'تمام يا أحمد ❤️ تحب مع حد معين؟';
    await processAiTurn(turnRow(), {
      modelClient: modelClient(structured({ replyText: arabic })),
    });
    expect(insertOutboundBotMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: arabic }),
    );
    expect(enqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: { text: arabic } }),
    );
  });

  it('N — identical incoming text messages remain separate canonical messages', async () => {
    await scheduleAiTurn({ conversationId: 10, inboundMessageId: 100 });
    await scheduleAiTurn({ conversationId: 10, inboundMessageId: 101 });
    const calls = scheduleAiTurnAfterInbound.mock.calls;
    expect(calls[0][0].inboundMessageId).toBe(100);
    expect(calls[1][0].inboundMessageId).toBe(101);
  });

  it('O — outbox idempotency key is stable per AI turn', async () => {
    await processAiTurn(turnRow({ turnId: 42 }), { modelClient: modelClient(structured()) });
    expect(enqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'whatsapp-bot-ai-turn:42' }),
    );
  });

  it('P — no booking/business DB action occurs', async () => {
    await processAiTurn(
      turnRow(),
      {
        modelClient: modelClient(
          structured({
            intent: 'booking_request',
            needsBusinessTool: true,
            replyText: 'ثواني هأكدلك الحجز من السيستم.',
          }),
        ),
      },
    );
    expect(enqueueMessage).toHaveBeenCalledTimes(1);
    expect(markAiTurnCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'booking_request' }),
    );
    const text = insertOutboundBotMessage.mock.calls[0][0].text as string;
    expect(text).not.toMatch(/هأكدلك الحجز من السيستم/);
  });
});
