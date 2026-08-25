import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageOutboxError } from '@/modules/messaging/domain/outboxTypes';
import type { OutboxEnqueueRecord, OutboxMessageRow } from '@/modules/messaging/outbox/messageOutboxRepository';
import { serializeOutboxMetadata } from '@/modules/messaging/outbox/serializeMetadata';

const repo = vi.hoisted(() => {
  const calls: OutboxEnqueueRecord[] = [];
  let nextId = 1;
  const byKey = new Map<string, OutboxMessageRow>();

  function reset() {
    calls.length = 0;
    nextId = 1;
    byKey.clear();
  }

  function toRow(record: OutboxEnqueueRecord, id: number): OutboxMessageRow {
    return {
      id,
      channel: record.channel,
      recipient: record.recipient,
      templateKey: record.templateKey,
      content: record.content,
      metadataJson: record.metadataJson,
      idempotencyKey: record.idempotencyKey,
      status: 'pending',
      attemptCount: 0,
      maxAttempts: 5,
      nextAttemptAt: new Date().toISOString(),
      lockedAt: null,
      lockedBy: null,
      providerMessageId: null,
      lastError: null,
      branchId: record.branchId,
      createdByUserId: record.createdByUserId,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      sentAt: null,
      failedAt: null,
    };
  }

  return {
    calls,
    reset,
    enqueue: vi.fn(async (record: OutboxEnqueueRecord) => {
      calls.push(record);
      const existing = byKey.get(record.idempotencyKey);
      if (existing) return { row: existing, duplicate: true };
      const row = toRow(record, nextId++);
      byKey.set(record.idempotencyKey, row);
      return { row, duplicate: false };
    }),
    getById: vi.fn(async (id: number) => {
      return [...byKey.values()].find((row) => row.id === id) ?? null;
    }),
    getByIdempotencyKey: vi.fn(async (key: string) => byKey.get(key) ?? null),
  };
});

vi.mock('@/modules/messaging/outbox/messageOutboxRepository', () => ({
  enqueue: (record: OutboxEnqueueRecord) => repo.enqueue(record),
  getById: (id: number) => repo.getById(id),
  getByIdempotencyKey: (key: string) => repo.getByIdempotencyKey(key),
}));

import { enqueueMessage } from '@/modules/messaging/application/enqueueMessage';

const BASE = {
  channel: 'whatsapp' as const,
  recipient: { phone: '01557994946' },
  content: { text: 'أستاذ طارق\nنورت Cut Salon' },
  idempotencyKey: 'sale:1:40004:customer_receipt',
};

describe('serializeOutboxMetadata', () => {
  it('stores undefined metadata as NULL and serializes objects', () => {
    expect(serializeOutboxMetadata(undefined)).toBeNull();
    expect(serializeOutboxMetadata(null)).toBeNull();
    expect(serializeOutboxMetadata({})).toBe('{}');
    expect(serializeOutboxMetadata({ invoiceId: 40004, source: 'sale.customer_receipt' })).toBe(
      JSON.stringify({ invoiceId: 40004, source: 'sale.customer_receipt' }),
    );
  });

  it('rejects secrets, tokens, cookies, and credentials', () => {
    expect(() => serializeOutboxMetadata({ password: 'x' })).toThrow(MessageOutboxError);
    expect(() => serializeOutboxMetadata({ authToken: 'x' })).toThrow(MessageOutboxError);
    expect(() => serializeOutboxMetadata({ cookie: 'sid' })).toThrow(MessageOutboxError);
    expect(() => serializeOutboxMetadata({ nested: { db_password: 'x' } })).toThrow(MessageOutboxError);
  });

  it('rejects circular metadata', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => serializeOutboxMetadata(circular)).toThrow(MessageOutboxError);
  });
});

describe('enqueueMessage', () => {
  beforeEach(() => {
    repo.reset();
    repo.enqueue.mockClear();
  });

  it('creates a pending row and keeps rendered content literally', async () => {
    const result = await enqueueMessage({
      ...BASE,
      templateKey: 'sale.customer_receipt',
      metadata: { invoiceId: 40004 },
      context: { branchId: 1, userId: 7 },
    });

    expect(result).toEqual({
      queued: true,
      messageId: 1,
      status: 'pending',
      duplicate: false,
    });
    expect(repo.calls[0]).toMatchObject({
      channel: 'whatsapp',
      recipient: '01557994946',
      content: 'أستاذ طارق\nنورت Cut Salon',
      templateKey: 'sale.customer_receipt',
      metadataJson: JSON.stringify({ invoiceId: 40004 }),
      idempotencyKey: 'sale:1:40004:customer_receipt',
      branchId: 1,
      createdByUserId: 7,
    });
    expect(repo.calls[0]).not.toHaveProperty('status');
    expect(repo.calls[0]).not.toHaveProperty('attemptCount');
    expect(repo.calls[0]).not.toHaveProperty('providerMessageId');
  });

  it('allows omitting TemplateKey', async () => {
    await enqueueMessage(BASE);
    expect(repo.calls[0].templateKey).toBeNull();
  });

  it('returns duplicate=true for the same IdempotencyKey', async () => {
    const first = await enqueueMessage(BASE);
    const second = await enqueueMessage({
      ...BASE,
      content: { text: 'different text must not create a second row' },
    });
    expect(first.duplicate).toBe(false);
    expect(second).toEqual({
      queued: true,
      messageId: first.messageId,
      status: 'pending',
      duplicate: true,
    });
    expect(repo.enqueue).toHaveBeenCalledTimes(2);
  });

  it('rejects empty recipient, content, idempotency key, and unsupported channel', async () => {
    await expect(
      enqueueMessage({ ...BASE, recipient: { phone: '   ' } }),
    ).rejects.toMatchObject({ code: 'EMPTY_RECIPIENT' });
    await expect(
      enqueueMessage({ ...BASE, content: { text: '' } }),
    ).rejects.toMatchObject({ code: 'EMPTY_CONTENT' });
    await expect(
      enqueueMessage({ ...BASE, idempotencyKey: '  ' }),
    ).rejects.toMatchObject({ code: 'EMPTY_IDEMPOTENCY_KEY' });
    await expect(
      enqueueMessage({ ...BASE, channel: 'sms' as 'whatsapp' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CHANNEL' });
    expect(repo.enqueue).not.toHaveBeenCalled();
  });

  it('does not accept caller-owned status, attempts, or provider fields', async () => {
    const sneaky = {
      ...BASE,
      status: 'sent',
      attemptCount: 99,
      maxAttempts: 1,
      providerMessageId: 'wa-forged',
      providerMessageID: 'wa-forged',
    };
    const result = await enqueueMessage(sneaky as typeof BASE);
    expect(result.status).toBe('pending');
    expect(repo.calls[0]).toEqual({
      channel: 'whatsapp',
      recipient: '01557994946',
      content: BASE.content.text,
      templateKey: null,
      metadataJson: null,
      idempotencyKey: BASE.idempotencyKey,
      branchId: null,
      createdByUserId: null,
    });
  });

  it('rejects invalid metadata before touching the repository', async () => {
    await expect(
      enqueueMessage({ ...BASE, metadata: { accessToken: 'secret' } }),
    ).rejects.toMatchObject({ code: 'INVALID_METADATA' });
    expect(repo.enqueue).not.toHaveBeenCalled();
  });
});
