import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TenantMessageInboxRow } from '@/modules/messaging/inbox/infra/messageInboxRepository';

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
import { currentMessagingTenantScope } from '@/modules/messaging/tenancy/messagingTenantScope';
import { TENANT_A, TENANT_B } from './support/messagingTenantTestKit';

function inboxRow(partial: Partial<TenantMessageInboxRow> & Pick<TenantMessageInboxRow, 'id'>): TenantMessageInboxRow {
  return {
    tenantId: TENANT_A,
    provider: 'whatsapp-web',
    providerMessageId: `pm-${partial.id}`,
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
    ...partial,
  };
}

describe('processInboxTick AI scheduling hook', () => {
  let scopes: { process: Array<string | undefined>; schedule: Array<string | undefined> };

  beforeEach(() => {
    vi.clearAllMocks();
    scopes = { process: [], schedule: [] };
    scheduleAiTurn.mockImplementation(async () => {
      scopes.schedule.push(currentMessagingTenantScope()?.tenantId);
      return { scheduled: true, turnId: 1, skipped: false };
    });
  });

  it('schedules AI after successful non-duplicate inbound processing', async () => {
    vi.mocked(claimPendingBatch).mockResolvedValueOnce([inboxRow({ id: 1, tenantId: TENANT_B })]);
    processInboxMessage.mockImplementation(async () => {
      scopes.process.push(currentMessagingTenantScope()?.tenantId);
      return {
        inboxId: 1,
        conversationId: 10,
        messageId: 100,
        duplicate: false,
        conversationCreated: true,
        clientLinked: false,
        clientAmbiguous: false,
      };
    });

    await processInboxTick({ batchSize: 1, staleProcessingMs: 120000 });

    expect(scheduleAiTurn).toHaveBeenCalledWith({
      conversationId: 10,
      inboundMessageId: 100,
    });
    expect(scopes.process).toEqual([TENANT_B]);
    expect(scopes.schedule).toEqual([TENANT_B]);
    expect(currentMessagingTenantScope()).toBeNull();
  });

  it('does not schedule AI for duplicate inbox processing', async () => {
    vi.mocked(claimPendingBatch).mockResolvedValueOnce([inboxRow({ id: 2, text: 'تمام' })]);
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

  it('skips a claimed row without tenantId: no processing, no AI turn', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(claimPendingBatch).mockResolvedValueOnce([inboxRow({ id: 3, tenantId: null })]);

    const summary = await processInboxTick({ batchSize: 1, staleProcessingMs: 120000 });

    expect(summary).toMatchObject({ claimed: 1, processed: 0, failed: 0 });
    expect(processInboxMessage).not.toHaveBeenCalled();
    expect(scheduleAiTurn).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
