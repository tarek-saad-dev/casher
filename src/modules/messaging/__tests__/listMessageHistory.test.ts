import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  MESSAGE_HISTORY_DEFAULT_LIMIT,
  MESSAGE_HISTORY_MAX_LIMIT,
  type OutboxMessageRow,
} from '@/modules/messaging/domain/outboxTypes';
import { encodeMessageHistoryCursor } from '@/modules/messaging/outbox/historyCursor';

const repo = vi.hoisted(() => {
  const rows: OutboxMessageRow[] = [];
  const listCalls: Array<Record<string, unknown>> = [];

  function reset(seed: OutboxMessageRow[] = []) {
    rows.splice(0, rows.length, ...seed);
    listCalls.length = 0;
  }

  return {
    rows,
    listCalls,
    reset,
    list: vi.fn(async (filters: {
      branchId?: number | null;
      status?: string | null;
      channel?: string | null;
      cursorCreatedAt?: Date | null;
      cursorId?: number | null;
      fetchLimit: number;
    }) => {
      listCalls.push({ ...filters });
      const filtered = rows.filter((row) => {
        if (filters.branchId != null && row.branchId !== filters.branchId) return false;
        if (filters.status != null && row.status !== filters.status) return false;
        if (filters.channel != null && row.channel !== filters.channel) return false;
        if (filters.cursorCreatedAt) {
          const created = new Date(row.createdAt);
          if (created > filters.cursorCreatedAt) return false;
          if (created.getTime() === filters.cursorCreatedAt.getTime() && filters.cursorId != null && row.id >= filters.cursorId) {
            return false;
          }
        }
        return true;
      });
      filtered.sort((a, b) => {
        const byTime = Date.parse(b.createdAt) - Date.parse(a.createdAt);
        return byTime !== 0 ? byTime : b.id - a.id;
      });
      return filtered.slice(0, filters.fetchLimit);
    }),
  };
});

vi.mock('@/modules/messaging/outbox/messageOutboxRepository', () => ({
  list: (filters: never) => repo.list(filters),
}));

import { listMessageHistory } from '@/modules/messaging/application/listMessageHistory';

function row(partial: Partial<OutboxMessageRow> & Pick<OutboxMessageRow, 'id' | 'createdAt'>): OutboxMessageRow {
  return {
    channel: 'whatsapp',
    recipient: '01500000000',
    templateKey: null,
    content: `[msg-${partial.id}]`,
    metadataJson: null,
    idempotencyKey: `key:${partial.id}`,
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
    updatedAt: null,
    sentAt: null,
    failedAt: null,
    ...partial,
  };
}

describe('listMessageHistory', () => {
  beforeEach(() => {
    repo.reset([
      row({ id: 1, createdAt: '2026-08-25T10:00:00.000Z', branchId: 1, status: 'sent' }),
      row({ id: 2, createdAt: '2026-08-25T11:00:00.000Z', branchId: 1, status: 'pending' }),
      row({ id: 3, createdAt: '2026-08-25T12:00:00.000Z', branchId: 2, status: 'pending' }),
      row({ id: 4, createdAt: '2026-08-25T12:00:00.000Z', branchId: 1, status: 'failed' }),
    ]);
  });

  it('returns newest-first (CreatedAt DESC, ID DESC)', async () => {
    const result = await listMessageHistory({ limit: 10 });
    expect(result.items.map((item) => item.messageId)).toEqual([4, 3, 2, 1]);
  });

  it('is bounded with a default limit and a hard maximum', async () => {
    const many = Array.from({ length: 130 }, (_, i) =>
      row({
        id: i + 1,
        createdAt: new Date(Date.UTC(2026, 7, 25, 0, 0, i)).toISOString(),
      }),
    );
    repo.reset(many);

    const def = await listMessageHistory({});
    expect(repo.listCalls[0]?.fetchLimit).toBe(MESSAGE_HISTORY_DEFAULT_LIMIT + 1);
    expect(def.items.length).toBe(MESSAGE_HISTORY_DEFAULT_LIMIT);
    expect(def.nextCursor).toBeTruthy();

    const maxed = await listMessageHistory({ limit: 10_000 });
    expect(repo.listCalls[1]?.fetchLimit).toBe(MESSAGE_HISTORY_MAX_LIMIT + 1);
    expect(maxed.items.length).toBe(MESSAGE_HISTORY_MAX_LIMIT);
  });

  it('filters by branch and status', async () => {
    const branch = await listMessageHistory({ branchId: 2 });
    expect(branch.items.map((item) => item.messageId)).toEqual([3]);

    const pending = await listMessageHistory({ status: 'pending' });
    expect(pending.items.map((item) => item.messageId)).toEqual([3, 2]);
  });

  it('paginates with a stable cursor', async () => {
    const first = await listMessageHistory({ limit: 2 });
    expect(first.items.map((item) => item.messageId)).toEqual([4, 3]);
    expect(first.nextCursor).toBe(encodeMessageHistoryCursor(first.items[1]!.createdAt, first.items[1]!.messageId));

    const second = await listMessageHistory({ limit: 2, cursor: first.nextCursor! });
    expect(second.items.map((item) => item.messageId)).toEqual([2, 1]);
    expect(second.nextCursor).toBeNull();
  });

  it('rejects invalid status/channel filters', async () => {
    await expect(listMessageHistory({ status: 'queued' as 'pending' })).rejects.toMatchObject({
      code: 'INVALID_FILTER',
    });
    await expect(listMessageHistory({ channel: 'sms' })).rejects.toMatchObject({
      code: 'INVALID_FILTER',
    });
  });
});
