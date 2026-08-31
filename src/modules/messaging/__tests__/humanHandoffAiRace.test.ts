import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AiTurnRow, AiStructuredResult } from '@/modules/messaging/ai/domain/types';
import type { AiModelClient } from '@/modules/messaging/ai/model/aiModelClient';

const scheduleAiTurnAfterInbound = vi.fn();
const markAiTurnCompleted = vi.fn();
const markAiTurnSkipped = vi.fn();
const loadConversationContext = vi.fn();
const getInboundMessageReceivedAt = vi.fn();
const getOutboundBotMessageByAiTurnId = vi.fn();
const insertOutboundBotMessage = vi.fn();
const enqueueMessage = vi.fn();
const getConversationControl = vi.fn();

const getAiTurnById = vi.fn();

vi.mock('@/modules/messaging/ai/infra/aiTurnRepository', () => ({
  scheduleAiTurnAfterInbound: (...args: unknown[]) => scheduleAiTurnAfterInbound(...args),
  claimPendingAiTurnBatch: vi.fn(),
  getAiTurnById: (...args: unknown[]) => getAiTurnById(...args),
  markAiTurnCompleted: (...args: unknown[]) => markAiTurnCompleted(...args),
  markAiTurnFailed: vi.fn(),
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

vi.mock('@/modules/messaging/handoff/infra/conversationControlRepository', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/modules/messaging/handoff/infra/conversationControlRepository')
  >();
  return {
    ...actual,
    getConversationControl: (...args: unknown[]) => getConversationControl(...args),
  };
});

vi.mock('@/modules/messaging/ai/planner/processBookingPlannerTurn', () => ({
  processBookingPlannerTurn: vi.fn(async () => ({
    handled: false,
    preservePlan: false,
    replyText: null,
    plan: null,
    intent: 'unknown',
    trace: {},
  })),
}));

vi.mock('@/modules/messaging/ai/bookingManagement/featureFlag', () => ({
  isBookingManagementActiveForPhone: () => false,
}));

import { processAiTurn } from '@/modules/messaging/ai/application/processAiTurn';

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
    replyText: 'أهلاً!',
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
    generateConversationTurn: vi.fn(async () => ({
      result,
      latencyMs: 5,
      model: 'test',
      rawText: JSON.stringify(result),
    })),
  };
}

describe('AI race suppression with human takeover', () => {
  const originalHandoff = process.env.HUMAN_HANDOFF_V1;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.HUMAN_HANDOFF_V1 = 'true';
    process.env.HUMAN_HANDOFF_CANARY_PHONES = '';
    getAiTurnById.mockImplementation(async (id: number) => turnRow({ turnId: id }));
    loadConversationContext.mockResolvedValue({
      conversationId: 10,
      phone: '201555000000',
      messages: [{ direction: 'inbound', text: 'مرحبا', messageId: 100 }],
    });
    getInboundMessageReceivedAt.mockResolvedValue(new Date().toISOString());
    getOutboundBotMessageByAiTurnId.mockResolvedValue(null);
    insertOutboundBotMessage.mockResolvedValue({ messageId: 500 });
    enqueueMessage.mockResolvedValue({ messageId: 600 });
    process.env.MESSAGING_CUSTOMER_LED_V4 = 'false';
    process.env.MESSAGING_CONVERSATION_ORCHESTRATOR_V3 = 'false';
  });

  afterEach(() => {
    if (originalHandoff === undefined) delete process.env.HUMAN_HANDOFF_V1;
    else process.env.HUMAN_HANDOFF_V1 = originalHandoff;
  });

  it('8. HUMAN conversation blocks AI turn before generation', async () => {
    getConversationControl.mockResolvedValue({
      conversationId: 10,
      mode: 'HUMAN',
      controlVersion: 2,
      humanLeaseUntil: new Date(Date.now() + 600_000).toISOString(),
      humanLastActivityAt: new Date().toISOString(),
      takeoverSource: 'WHATSAPP_MANUAL',
      takenOverByUserId: null,
      handoffReason: null,
      handoffRequestedAt: null,
      lastHumanMessageId: 1,
      lastBotMessageId: null,
      lastCustomerMessageId: 100,
      unreadCount: 0,
    });
    const result = await processAiTurn(turnRow(), { modelClient: modelClient(structured()) });
    expect(result.skipped).toBe(true);
    expect(enqueueMessage).not.toHaveBeenCalled();
  });

  it('9. race: takeover during generation suppresses before enqueue', async () => {
    getConversationControl
      .mockResolvedValueOnce({
        conversationId: 10,
        mode: 'BOT',
        controlVersion: 1,
        humanLeaseUntil: null,
        humanLastActivityAt: null,
        takeoverSource: null,
        takenOverByUserId: null,
        handoffReason: null,
        handoffRequestedAt: null,
        lastHumanMessageId: null,
        lastBotMessageId: null,
        lastCustomerMessageId: 100,
        unreadCount: 0,
      })
      .mockResolvedValueOnce({
        conversationId: 10,
        mode: 'HUMAN',
        controlVersion: 2,
        humanLeaseUntil: new Date(Date.now() + 900_000).toISOString(),
        humanLastActivityAt: new Date().toISOString(),
        takeoverSource: 'WHATSAPP_MANUAL',
        takenOverByUserId: null,
        handoffReason: null,
        handoffRequestedAt: null,
        lastHumanMessageId: 55,
        lastBotMessageId: null,
        lastCustomerMessageId: 100,
        unreadCount: 0,
      });
    const result = await processAiTurn(turnRow(), { modelClient: modelClient(structured()) });
    expect(result.skipped).toBe(true);
    expect(markAiTurnSkipped).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: 'CONTROL_VERSION' }),
    );
    expect(enqueueMessage).not.toHaveBeenCalled();
  });
});
