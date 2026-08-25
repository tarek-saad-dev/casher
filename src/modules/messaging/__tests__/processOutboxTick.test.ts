import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboxMessageRow } from '@/modules/messaging/domain/outboxTypes';
import type { GenericWhatsAppSendResult } from '@/lib/integrations/whatsapp';

const repo = vi.hoisted(() => {
  const rows: OutboxMessageRow[] = [];
  let claimLock: Promise<void> = Promise.resolve();

  function reset(seed: OutboxMessageRow[] = []) {
    rows.splice(0, rows.length, ...seed.map((row) => ({ ...row })));
    claimLock = Promise.resolve();
  }

  function find(id: number) {
    return rows.find((row) => row.id === id);
  }

  return {
    rows,
    reset,
    recoverStaleSending: vi.fn(async ({ lockTtlMs }: { lockTtlMs: number }) => {
      const cutoff = Date.now() - lockTtlMs;
      const recovered: OutboxMessageRow[] = [];
      for (const row of rows) {
        if (row.status !== 'sending' || !row.lockedAt) continue;
        if (Date.parse(row.lockedAt) >= cutoff) continue;
        row.status = 'pending';
        row.lockedAt = null;
        row.lockedBy = null;
        row.nextAttemptAt = new Date().toISOString();
        row.lastError = 'stale_lock_recovered';
        recovered.push({ ...row });
      }
      return recovered;
    }),
    claimPendingBatch: vi.fn(async ({ batchSize, lockedBy }: { batchSize: number; lockedBy: string }) => {
      const prev = claimLock;
      let release!: () => void;
      claimLock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prev;
      try {
        const now = Date.now();
        const eligible = rows.filter((row) => {
          if (row.status !== 'pending') return false;
          if (row.attemptCount >= row.maxAttempts) return false;
          if (row.nextAttemptAt && Date.parse(row.nextAttemptAt) > now) return false;
          return true;
        });
        const taken = eligible.slice(0, batchSize);
        const claimed: OutboxMessageRow[] = [];
        for (const row of taken) {
          row.status = 'sending';
          row.lockedAt = new Date().toISOString();
          row.lockedBy = lockedBy;
          row.attemptCount += 1;
          row.nextAttemptAt = null;
          claimed.push({ ...row });
        }
        return claimed;
      } finally {
        release();
      }
    }),
    markSent: vi.fn(async ({ id, providerMessageId }: { id: number; providerMessageId: string }) => {
      const row = find(id);
      if (!row || row.status !== 'sending') return null;
      row.status = 'sent';
      row.providerMessageId = providerMessageId;
      row.sentAt = new Date().toISOString();
      row.lockedAt = null;
      row.lockedBy = null;
      row.lastError = null;
      row.nextAttemptAt = null;
      return { ...row };
    }),
    scheduleRetry: vi.fn(async ({
      id,
      nextAttemptAt,
      lastError,
    }: {
      id: number;
      nextAttemptAt: Date;
      lastError: string;
    }) => {
      const row = find(id);
      if (!row || row.status !== 'sending') return null;
      row.status = 'pending';
      row.nextAttemptAt = nextAttemptAt.toISOString();
      row.lastError = lastError;
      row.lockedAt = null;
      row.lockedBy = null;
      return { ...row };
    }),
    markFailed: vi.fn(async ({ id, lastError }: { id: number; lastError: string }) => {
      const row = find(id);
      if (!row) return null;
      row.status = 'failed';
      row.failedAt = new Date().toISOString();
      row.lastError = lastError;
      row.lockedAt = null;
      row.lockedBy = null;
      return { ...row };
    }),
  };
});

vi.mock('@/modules/messaging/outbox/messageOutboxRepository', () => ({
  recoverStaleSending: (input: { lockTtlMs: number }) => repo.recoverStaleSending(input),
  claimPendingBatch: (input: { batchSize: number; lockedBy: string }) => repo.claimPendingBatch(input),
  markSent: (input: { id: number; providerMessageId: string }) => repo.markSent(input),
  scheduleRetry: (input: { id: number; nextAttemptAt: Date; lastError: string }) =>
    repo.scheduleRetry(input),
  markFailed: (input: { id: number; lastError: string }) => repo.markFailed(input),
}));

import { processOutboxTick } from '@/modules/messaging/application/processOutboxTick';

function row(partial: Partial<OutboxMessageRow> & Pick<OutboxMessageRow, 'id' | 'idempotencyKey'>): OutboxMessageRow {
  return {
    channel: 'whatsapp',
    recipient: '01557994946',
    templateKey: 'sale.customer_receipt',
    content: '[OUTBOX-WORKER-5C1]',
    metadataJson: JSON.stringify({ source: 'phase5c1' }),
    status: 'pending',
    attemptCount: 0,
    maxAttempts: 5,
    nextAttemptAt: null,
    lockedAt: null,
    lockedBy: null,
    providerMessageId: null,
    lastError: null,
    branchId: 1,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    sentAt: null,
    failedAt: null,
    ...partial,
  };
}

describe('processOutboxTick', () => {
  beforeEach(() => {
    repo.reset([row({ id: 1, idempotencyKey: 'outbox:phase5c1:unit' })]);
    vi.clearAllMocks();
  });

  it('sends the stored snapshot with idempotencyKey and no type, then marks sent', async () => {
    const send = vi.fn(async (input: {
      phone: string;
      message: string;
      metadata?: Record<string, unknown>;
      idempotencyKey?: string;
    }): Promise<GenericWhatsAppSendResult> => {
      expect(input).toEqual({
        phone: '01557994946',
        message: '[OUTBOX-WORKER-5C1]',
        metadata: { source: 'phase5c1' },
        idempotencyKey: 'outbox:phase5c1:unit',
      });
      expect(input).not.toHaveProperty('type');
      return { sent: true, skipped: false, status: 'sent', messageId: 'wa-live-1' };
    });

    const summary = await processOutboxTick({
      workerId: 'host:1',
      batchSize: 10,
      lockTtlMs: 300_000,
      send,
    });

    expect(summary).toMatchObject({ claimed: 1, sent: 1, retried: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(repo.rows[0]?.status).toBe('sent');
    expect(repo.rows[0]?.providerMessageId).toBe('wa-live-1');
    expect(repo.rows[0]?.lockedAt).toBeNull();
  });

  it('treats idempotent replay as sent with the original messageId', async () => {
    const send = vi.fn(async (): Promise<GenericWhatsAppSendResult> => ({
      sent: true,
      skipped: false,
      status: 'sent',
      messageId: 'wa-original',
    }));

    await processOutboxTick({ workerId: 'host:1', batchSize: 10, lockTtlMs: 300_000, send });
    expect(repo.rows[0]?.providerMessageId).toBe('wa-original');
    expect(repo.rows[0]?.status).toBe('sent');
  });

  it('does not let concurrent workers claim the same row', async () => {
    const send = vi.fn(async (): Promise<GenericWhatsAppSendResult> => {
      await new Promise((r) => setTimeout(r, 20));
      return { sent: true, skipped: false, status: 'sent', messageId: 'wa-one' };
    });

    const [a, b] = await Promise.all([
      processOutboxTick({ workerId: 'host:a', batchSize: 10, lockTtlMs: 300_000, send }),
      processOutboxTick({ workerId: 'host:b', batchSize: 10, lockTtlMs: 300_000, send }),
    ]);

    expect(a.claimed + b.claimed).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(repo.rows.filter((r) => r.status === 'sent')).toHaveLength(1);
  });

  it('does not claim a row whose NextAttemptAt is in the future', async () => {
    repo.reset([
      row({
        id: 2,
        idempotencyKey: 'future',
        nextAttemptAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ]);
    const send = vi.fn();
    const summary = await processOutboxTick({
      workerId: 'host:1',
      batchSize: 10,
      lockTtlMs: 300_000,
      send,
    });
    expect(summary.claimed).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(repo.rows[0]?.status).toBe('pending');
  });

  it('schedules retry on timeout and IN_PROGRESS', async () => {
    const send = vi.fn(async (): Promise<GenericWhatsAppSendResult> => ({
      sent: false,
      skipped: false,
      reason: 'timeout',
    }));
    await processOutboxTick({ workerId: 'host:1', batchSize: 10, lockTtlMs: 300_000, send });
    expect(repo.rows[0]?.status).toBe('pending');
    expect(repo.rows[0]?.nextAttemptAt).toBeTruthy();
    expect(Date.parse(repo.rows[0]!.nextAttemptAt!)).toBeGreaterThan(Date.now() - 1000);

    repo.reset([row({ id: 3, idempotencyKey: 'in-progress' })]);
    send.mockResolvedValue({
      sent: false,
      skipped: false,
      reason: 'remote_error',
      httpStatus: 409,
      code: 'IDEMPOTENCY_IN_PROGRESS',
    });
    await processOutboxTick({ workerId: 'host:1', batchSize: 10, lockTtlMs: 300_000, send });
    expect(repo.rows[0]?.status).toBe('pending');
  });

  it('fails CONFLICT, DELIVERY_STATUS_UNKNOWN, and MaxAttempts', async () => {
    const send = vi.fn(async (): Promise<GenericWhatsAppSendResult> => ({
      sent: false,
      skipped: false,
      reason: 'remote_error',
      httpStatus: 409,
      code: 'IDEMPOTENCY_CONFLICT',
    }));
    await processOutboxTick({ workerId: 'host:1', batchSize: 10, lockTtlMs: 300_000, send });
    expect(repo.rows[0]?.status).toBe('failed');

    repo.reset([row({ id: 4, idempotencyKey: 'unknown' })]);
    send.mockResolvedValue({
      sent: false,
      skipped: false,
      reason: 'whatsapp_not_ready',
      httpStatus: 503,
      code: 'DELIVERY_STATUS_UNKNOWN',
    });
    await processOutboxTick({ workerId: 'host:1', batchSize: 10, lockTtlMs: 300_000, send });
    expect(repo.rows[0]?.status).toBe('failed');

    repo.reset([row({ id: 5, idempotencyKey: 'max', attemptCount: 4, maxAttempts: 5 })]);
    send.mockResolvedValue({ sent: false, skipped: false, reason: 'timeout' });
    await processOutboxTick({ workerId: 'host:1', batchSize: 10, lockTtlMs: 300_000, send });
    expect(repo.rows[0]?.attemptCount).toBe(5);
    expect(repo.rows[0]?.status).toBe('failed');
  });

  it('recovers stale sending rows to pending without changing IdempotencyKey', async () => {
    const key = 'outbox:phase5c1:stale';
    repo.reset([
      row({
        id: 9,
        idempotencyKey: key,
        status: 'sending',
        attemptCount: 1,
        lockedBy: 'dead-worker',
        lockedAt: new Date(Date.now() - 400_000).toISOString(),
      }),
    ]);
    const send = vi.fn(async (): Promise<GenericWhatsAppSendResult> => ({
      sent: true,
      skipped: false,
      status: 'sent',
      messageId: 'wa-recovered',
    }));

    const summary = await processOutboxTick({
      workerId: 'host:new',
      batchSize: 10,
      lockTtlMs: 300_000,
      send,
    });

    expect(summary.recovered).toBe(1);
    expect(repo.rows[0]?.idempotencyKey).toBe(key);
    expect(repo.rows[0]?.status).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
  });
});
