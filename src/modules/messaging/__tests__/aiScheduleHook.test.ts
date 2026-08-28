import { describe, it, expect, vi, beforeEach } from 'vitest';

const processInboxMessage = vi.fn();
const scheduleAiTurn = vi.fn();

vi.mock('@/modules/messaging/inbox/infra/messageInboxRepository', () => ({
  claimPendingBatch: vi.fn().mockResolvedValue([]),
  markFailed: vi.fn(),
  recoverStaleProcessing: vi.fn().mockResolvedValue({ completed: 0, requeued: 0 }),
}));

vi.mock('@/modules/messaging/conversation/application/processInboxMessage', () => ({
  processInboxMessage: (...args: unknown[]) => processInboxMessage(...args),
}));

vi.mock('@/modules/messaging/ai/application/scheduleAiTurn', () => ({
  scheduleAiTurn: (...args: unknown[]) => scheduleAiTurn(...args),
}));

import { processInboxTick } from '@/modules/messaging/conversation/application/processInboxTick';
import { claimPendingBatch } from '@/modules/messaging/inbox/infra/messageInboxRepository';

describe('processInboxTick AI scheduling hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scheduleAiTurn.mockResolvedValue({ scheduled: true, turnId: 1, skipped: false });
  });

  it('schedules AI after successful non-duplicate inbound processing', async () => {
    vi.mocked(claimPendingBatch).mockResolvedValueOnce([
      {
        id: 1,
        provider: 'whatsapp-web',
        providerMessageId: 'pm-1',
        phone: '201234567890',
        chatTitle: null,
        messageType: 'text',
        text: 'مساء الخير',
        isGroup: false,
        rawPayload: null,
        status: 'processing',
        retryCount: 0,
        lastError: null,
        receivedAt: '2026-08-28T07:00:00.000Z',
        processingStartedAt: '2026-08-28T07:00:01.000Z',
        processedAt: null,
        createdAt: '2026-08-28T07:00:00.000Z',
        updatedAt: null,
      },
    ]);
    processInboxMessage.mockResolvedValue({
      inboxId: 1,
      conversationId: 10,
      messageId: 100,
      duplicate: false,
      conversationCreated: true,
      clientLinked: false,
      clientAmbiguous: false,
    });

    await processInboxTick({ batchSize: 1, staleProcessingMs: 120000 });

    expect(scheduleAiTurn).toHaveBeenCalledWith({
      conversationId: 10,
      inboundMessageId: 100,
    });
  });

  it('does not schedule AI for duplicate inbox processing', async () => {
    vi.mocked(claimPendingBatch).mockResolvedValueOnce([
      {
        id: 2,
        provider: 'whatsapp-web',
        providerMessageId: 'pm-2',
        phone: '201234567890',
        chatTitle: null,
        messageType: 'text',
        text: 'تمام',
        isGroup: false,
        rawPayload: null,
        status: 'processing',
        retryCount: 0,
        lastError: null,
        receivedAt: '2026-08-28T07:00:00.000Z',
        processingStartedAt: '2026-08-28T07:00:01.000Z',
        processedAt: null,
        createdAt: '2026-08-28T07:00:00.000Z',
        updatedAt: null,
      },
    ]);
    processInboxMessage.mockResolvedValue({
      inboxId: 2,
      conversationId: 10,
      messageId: 100,
      duplicate: true,
      conversationCreated: false,
      clientLinked: false,
      clientAmbiguous: false,
    });

    await processInboxTick({ batchSize: 1, staleProcessingMs: 120000 });
    expect(scheduleAiTurn).not.toHaveBeenCalled();
  });
});
