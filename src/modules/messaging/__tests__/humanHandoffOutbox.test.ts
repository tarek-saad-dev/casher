import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboxMessageRow } from '@/modules/messaging/domain/outboxTypes';

const repo = vi.hoisted(() => {
  const rows: OutboxMessageRow[] = [];
  return {
    rows,
    reset(seed: OutboxMessageRow[] = []) {
      rows.splice(0, rows.length, ...seed.map((row) => ({ ...row })));
    },
    recoverStaleSending: vi.fn(async () => []),
    claimPendingBatch: vi.fn(async () => rows.filter((r) => r.status === 'pending')),
    markSent: vi.fn(),
    scheduleRetry: vi.fn(),
    markFailed: vi.fn(async ({ id, lastError }: { id: number; lastError: string }) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      row.status = 'failed';
      row.lastError = lastError;
      return row;
    }),
  };
});

const gate = vi.hoisted(() => ({
  evaluateOutboxSendGate: vi.fn(),
  stampOutboxCorrelationAfterSend: vi.fn(),
}));

vi.mock('@/modules/messaging/outbox/messageOutboxRepository', () => ({
  recoverStaleSending: () => repo.recoverStaleSending(),
  claimPendingBatch: () => repo.claimPendingBatch(),
  markSent: (...args: unknown[]) => repo.markSent(...args),
  scheduleRetry: (...args: unknown[]) => repo.scheduleRetry(...args),
  markFailed: (...args: unknown[]) => repo.markFailed(...args),
}));

vi.mock('@/modules/messaging/handoff/application/outboxSendGate', () => ({
  evaluateOutboxSendGate: (...args: unknown[]) => gate.evaluateOutboxSendGate(...args),
  stampOutboxCorrelationAfterSend: (...args: unknown[]) =>
    gate.stampOutboxCorrelationAfterSend(...args),
}));

import { processOutboxTick } from '@/modules/messaging/application/processOutboxTick';

function row(partial: Partial<OutboxMessageRow> & Pick<OutboxMessageRow, 'id' | 'idempotencyKey'>): OutboxMessageRow {
  return {
    channel: 'whatsapp',
    recipient: '201555000000',
    templateKey: '',
    content: 'stale bot reply',
    metadataJson: JSON.stringify({
      source: 'ai-receptionist',
      origin: 'BOT',
      conversationId: 1,
      expectedControlVersion: 1,
    }),
    status: 'pending',
    attemptCount: 0,
    maxAttempts: 5,
    nextAttemptAt: null,
    lockedAt: null,
    lockedBy: null,
    providerMessageId: null,
    lastError: null,
    branchId: null,
    createdByUserId: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    sentAt: null,
    failedAt: null,
    ...partial,
  };
}

describe('processOutboxTick handoff suppression', () => {
  beforeEach(() => {
    repo.reset([row({ id: 50, idempotencyKey: 'ai-turn:50' })]);
    vi.clearAllMocks();
    gate.evaluateOutboxSendGate.mockResolvedValue({
      allow: false,
      reason: 'control_mode_human',
      origin: 'BOT',
    });
  });

  it('queued AI outbound is marked failed without retry after human takeover', async () => {
    const send = vi.fn();
    const summary = await processOutboxTick({
      workerId: 'host:1',
      batchSize: 10,
      lockTtlMs: 300_000,
      send,
    });
    expect(summary.suppressed).toBe(1);
    expect(summary.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(repo.rows[0]?.status).toBe('failed');
    expect(repo.rows[0]?.lastError).toMatch(/^suppressed:/);
    expect(repo.scheduleRetry).not.toHaveBeenCalled();
  });
});
