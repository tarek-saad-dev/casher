import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MessageInboxRow } from '@/modules/messaging/inbox/domain/types';

const processInboxMessageAtomic = vi.fn();

vi.mock('@/modules/messaging/conversation/infra/processInboxMessageAtomic', () => ({
  processInboxMessageAtomic: (...args: unknown[]) => processInboxMessageAtomic(...args),
}));

import { processInboxMessage } from '@/modules/messaging/conversation/application/processInboxMessage';

function inboxRow(overrides: Partial<MessageInboxRow> = {}): MessageInboxRow {
  return {
    id: 1,
    provider: 'whatsapp-web',
    providerMessageId: 'pm-1',
    phone: '201234567890',
    chatTitle: 'Ahmed',
    messageType: 'text',
    text: 'عايز احجز',
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
    ...overrides,
  };
}

function atomicResult(overrides: Record<string, unknown> = {}) {
  return {
    inboxId: 1,
    conversationId: 10,
    messageId: 100,
    duplicate: false,
    conversationCreated: true,
    clientLinked: false,
    clientAmbiguous: false,
    sqlRoundTrips: 1,
    ...overrides,
  };
}

describe('processInboxMessage Phase 2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    processInboxMessageAtomic.mockResolvedValue(atomicResult());
  });

  it('A — first message creates conversation, null client, completes inbox', async () => {
    const result = await processInboxMessage(inboxRow());
    expect(result.conversationCreated).toBe(true);
    expect(result.clientLinked).toBe(false);
    expect(result.duplicate).toBe(false);
    expect(processInboxMessageAtomic).toHaveBeenCalledTimes(1);
    expect(processInboxMessageAtomic).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('B — second message reuses conversation', async () => {
    processInboxMessageAtomic.mockResolvedValue(
      atomicResult({
        conversationId: 55,
        messageId: 101,
        conversationCreated: false,
      }),
    );

    const result = await processInboxMessage(inboxRow({ id: 2, providerMessageId: 'pm-2', text: 'تاني' }));
    expect(result.conversationId).toBe(55);
    expect(result.conversationCreated).toBe(false);
    expect(processInboxMessageAtomic).toHaveBeenCalledTimes(1);
  });

  it('C — identical text with different inbox ids creates two messages', async () => {
    await processInboxMessage(inboxRow({ id: 3, providerMessageId: 'pm-3a', text: 'تمام' }));
    processInboxMessageAtomic.mockResolvedValueOnce(
      atomicResult({ inboxId: 4, messageId: 102, conversationCreated: false }),
    );
    const second = await processInboxMessage(inboxRow({ id: 4, providerMessageId: 'pm-3b', text: 'تمام' }));
    expect(processInboxMessageAtomic).toHaveBeenCalledTimes(2);
    expect(second.messageId).toBe(102);
  });

  it('D — known customer links ClientID on new conversation', async () => {
    processInboxMessageAtomic.mockResolvedValue(
      atomicResult({ conversationId: 11, clientLinked: true, conversationCreated: true }),
    );
    const result = await processInboxMessage(inboxRow());
    expect(result.clientLinked).toBe(true);
  });

  it('E — unknown customer leaves ClientID null', async () => {
    const result = await processInboxMessage(inboxRow());
    expect(result.clientLinked).toBe(false);
  });

  it('F — ambiguous customer does not guess', async () => {
    processInboxMessageAtomic.mockResolvedValue(
      atomicResult({ clientAmbiguous: true, clientLinked: false }),
    );
    const result = await processInboxMessage(inboxRow());
    expect(result.clientAmbiguous).toBe(true);
    expect(result.clientLinked).toBe(false);
  });

  it('H — duplicate inbox processing returns existing bot message', async () => {
    processInboxMessageAtomic.mockResolvedValue(
      atomicResult({
        messageId: 200,
        duplicate: true,
        conversationCreated: false,
      }),
    );
    const result = await processInboxMessage(inboxRow());
    expect(result.duplicate).toBe(true);
    expect(result.messageId).toBe(200);
  });

  it('L — Arabic text is passed through to atomic processor', async () => {
    const arabic = 'مرحبا، أريد حجز موعد';
    await processInboxMessage(inboxRow({ text: arabic }));
    expect(processInboxMessageAtomic).toHaveBeenCalledWith(
      expect.objectContaining({ text: arabic }),
    );
  });

  it('M — group/ignored inbox is rejected', async () => {
    await expect(processInboxMessage(inboxRow({ isGroup: true, status: 'ignored' }))).rejects.toThrow(
      /not processable/,
    );
    expect(processInboxMessageAtomic).not.toHaveBeenCalled();
  });
});
