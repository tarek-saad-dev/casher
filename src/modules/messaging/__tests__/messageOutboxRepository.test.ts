import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboxEnqueueRecord } from '@/modules/messaging/outbox/messageOutboxRepository';

type RawRow = {
  ID: number;
  Channel: string;
  Recipient: string;
  TemplateKey: string | null;
  Content: string;
  MetadataJson: string | null;
  IdempotencyKey: string;
  Status: string;
  AttemptCount: number;
  MaxAttempts: number;
  NextAttemptAt: Date | null;
  LockedAt: Date | null;
  LockedBy: string | null;
  ProviderMessageID: string | null;
  LastError: string | null;
  BranchID: number | null;
  CreatedByUserID: number | null;
  CreatedAt: Date;
  UpdatedAt: Date | null;
  SentAt: Date | null;
  FailedAt: Date | null;
};

const db = vi.hoisted(() => {
  const byId = new Map<number, RawRow>();
  const byKey = new Map<string, RawRow>();
  let nextId = 1;

  let claimLock: Promise<void> = Promise.resolve();

  function reset() {
    byId.clear();
    byKey.clear();
    nextId = 1;
    claimLock = Promise.resolve();
  }

  async function insert(params: Record<string, unknown>): Promise<{ recordset: RawRow[] }> {
    const key = String(params.idempotencyKey);
    await Promise.resolve();
    if (byKey.has(key)) {
      throw Object.assign(new Error("Violation of UNIQUE KEY constraint 'UQ_TblMessageOutbox_IdempotencyKey'."), {
        number: 2627,
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
    if (byKey.has(key)) {
      throw Object.assign(new Error("Violation of UNIQUE KEY constraint 'UQ_TblMessageOutbox_IdempotencyKey'."), {
        number: 2627,
      });
    }
    const now = new Date();
    const row: RawRow = {
      ID: nextId++,
      Channel: String(params.channel),
      Recipient: String(params.recipient),
      TemplateKey: (params.templateKey as string | null) ?? null,
      Content: String(params.content),
      MetadataJson: (params.metadataJson as string | null) ?? null,
      IdempotencyKey: key,
      Status: 'pending',
      AttemptCount: 0,
      MaxAttempts: Number(params.maxAttempts ?? 5),
      NextAttemptAt: now,
      LockedAt: null,
      LockedBy: null,
      ProviderMessageID: null,
      LastError: null,
      BranchID: (params.branchId as number | null) ?? null,
      CreatedByUserID: (params.createdByUserId as number | null) ?? null,
      CreatedAt: now,
      UpdatedAt: null,
      SentAt: null,
      FailedAt: null,
    };
    byKey.set(key, row);
    byId.set(row.ID, row);
    return { recordset: [{ ...row }] };
  }

  function list(params: Record<string, unknown>): { recordset: RawRow[] } {
    const fetchLimit = Number(params.fetchLimit ?? 50);
    const cursorAt = params.cursorCreatedAt as Date | null;
    const cursorId = params.cursorId == null ? null : Number(params.cursorId);
    const rows = [...byId.values()].filter((row) => {
      if (params.branchId != null && row.BranchID !== params.branchId) return false;
      if (params.status != null && row.Status !== params.status) return false;
      if (params.channel != null && row.Channel !== params.channel) return false;
      if (cursorAt) {
        if (row.CreatedAt > cursorAt) return false;
        if (row.CreatedAt.getTime() === cursorAt.getTime() && cursorId != null && row.ID >= cursorId) {
          return false;
        }
      }
      return true;
    });
    rows.sort((a, b) => {
      const byTime = b.CreatedAt.getTime() - a.CreatedAt.getTime();
      return byTime !== 0 ? byTime : b.ID - a.ID;
    });
    return { recordset: rows.slice(0, fetchLimit).map((row) => ({ ...row })) };
  }

  async function claimPending(params: Record<string, unknown>): Promise<{ recordset: RawRow[] }> {
    const prev = claimLock;
    let release!: () => void;
    claimLock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      const batchSize = Number(params.batchSize ?? 10);
      const lockedBy = String(params.lockedBy);
      const now = Date.now();
      const eligible = [...byId.values()]
        .filter((row) => {
          if (row.Status !== 'pending') return false;
          if (row.AttemptCount >= row.MaxAttempts) return false;
          if (row.NextAttemptAt && row.NextAttemptAt.getTime() > now) return false;
          return true;
        })
        .sort((a, b) => {
          const byTime = a.CreatedAt.getTime() - b.CreatedAt.getTime();
          return byTime !== 0 ? byTime : a.ID - b.ID;
        })
        .slice(0, batchSize);
      const nowDate = new Date();
      for (const row of eligible) {
        row.Status = 'sending';
        row.LockedAt = nowDate;
        row.LockedBy = lockedBy;
        row.AttemptCount += 1;
        row.NextAttemptAt = null;
        row.UpdatedAt = nowDate;
      }
      return { recordset: eligible.map((row) => ({ ...row })) };
    } finally {
      release();
    }
  }

  function updateById(
    id: number,
    patch: (row: RawRow) => void,
    predicate?: (row: RawRow) => boolean,
  ): { recordset: RawRow[] } {
    const row = byId.get(id);
    if (!row || (predicate && !predicate(row))) return { recordset: [] };
    patch(row);
    return { recordset: [{ ...row }] };
  }

  function recoverStale(params: Record<string, unknown>): { recordset: RawRow[] } {
    const ttl = Number(params.lockTtlMs ?? 300000);
    const cutoff = Date.now() - ttl;
    const recovered: RawRow[] = [];
    for (const row of byId.values()) {
      if (row.Status !== 'sending' || !row.LockedAt) continue;
      if (row.LockedAt.getTime() >= cutoff) continue;
      row.Status = 'pending';
      row.LockedAt = null;
      row.LockedBy = null;
      row.UpdatedAt = new Date();
      row.NextAttemptAt = new Date();
      row.LastError = 'stale_lock_recovered';
      recovered.push({ ...row });
    }
    return { recordset: recovered };
  }

  function request() {
    const params: Record<string, unknown> = {};
    return {
      input(name: string, _type: unknown, value: unknown) {
        params[name] = value;
        return this;
      },
      async query(text: string) {
        if (/INSERT INTO \[dbo\]\.\[TblMessageOutbox\]/i.test(text)) {
          return insert(params);
        }
        if (/UPDLOCK,\s*READPAST,\s*ROWLOCK/i.test(text)) {
          return claimPending(params);
        }
        if (/DATEADD\(MILLISECOND,\s*-@lockTtlMs/i.test(text)) {
          return recoverStale(params);
        }
        if (/\[Status\] = N'sent'/i.test(text) && /\[ProviderMessageID\]/i.test(text)) {
          return updateById(Number(params.id), (row) => {
            row.Status = 'sent';
            row.ProviderMessageID = String(params.providerMessageId);
            row.SentAt = new Date();
            row.UpdatedAt = new Date();
            row.LockedAt = null;
            row.LockedBy = null;
            row.LastError = null;
            row.NextAttemptAt = null;
          }, (row) => row.Status === 'sending');
        }
        if (/\[NextAttemptAt\] = @nextAttemptAt/i.test(text)) {
          return updateById(Number(params.id), (row) => {
            row.Status = 'pending';
            row.NextAttemptAt = params.nextAttemptAt as Date;
            row.UpdatedAt = new Date();
            row.LockedAt = null;
            row.LockedBy = null;
            row.LastError = String(params.lastError ?? '');
          }, (row) => row.Status === 'sending');
        }
        if (/\[Status\] = N'failed'/i.test(text)) {
          return updateById(Number(params.id), (row) => {
            row.Status = 'failed';
            row.FailedAt = new Date();
            row.UpdatedAt = new Date();
            row.LockedAt = null;
            row.LockedBy = null;
            row.LastError = String(params.lastError ?? '');
            row.NextAttemptAt = null;
          });
        }
        if (/\[IdempotencyKey\]\s*=\s*@idempotencyKey/i.test(text)) {
          const row = byKey.get(String(params.idempotencyKey ?? ''));
          return { recordset: row ? [{ ...row }] : [] };
        }
        if (/\[ID\]\s*=\s*@id/i.test(text)) {
          const row = byId.get(Number(params.id));
          return { recordset: row ? [{ ...row }] : [] };
        }
        if (/ORDER BY \[CreatedAt\] DESC,\s*\[ID\] DESC/i.test(text)) {
          return list(params);
        }
        throw new Error(`Unexpected SQL in test fake: ${text.slice(0, 120)}`);
      },
    };
  }

  return { reset, request, byId, byKey };
});

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({ request: () => db.request() })),
  sql: {
    MAX: 65535,
    Int: {},
    BigInt: {},
    DateTime2: {},
    NVarChar: () => ({}),
    Transaction: class {
      async begin() {}
      async commit() {}
      async rollback() {}
    },
    Request: class {
      constructor(_tx?: unknown) {
        return db.request();
      }
    },
  },
}));

import {
  enqueue,
  getById,
  getByIdempotencyKey,
  list,
  claimPendingBatch,
  markSent,
  scheduleRetry,
  markFailed,
  recoverStaleSending,
} from '@/modules/messaging/outbox/messageOutboxRepository';

const SAMPLE: OutboxEnqueueRecord = {
  channel: 'whatsapp',
  recipient: '01557994946',
  content: '[OUTBOX-5A-TEST] rendered snapshot',
  templateKey: 'sale.customer_receipt',
  metadataJson: JSON.stringify({ invoiceId: 40004 }),
  idempotencyKey: 'outbox:phase5a:unit',
  branchId: 1,
  createdByUserId: 7,
};

describe('messageOutboxRepository', () => {
  beforeEach(() => {
    db.reset();
  });

  it('inserts a pending snapshot row and looks it up by id / idempotency key', async () => {
    const { row, duplicate } = await enqueue(SAMPLE);
    expect(duplicate).toBe(false);
    expect(row.status).toBe('pending');
    expect(row.attemptCount).toBe(0);
    expect(row.providerMessageId).toBeNull();
    expect(row.content).toBe('[OUTBOX-5A-TEST] rendered snapshot');
    expect(row.templateKey).toBe('sale.customer_receipt');
    expect(row.metadataJson).toBe(JSON.stringify({ invoiceId: 40004 }));

    const byId = await getById(row.id);
    const byKey = await getByIdempotencyKey(SAMPLE.idempotencyKey);
    expect(byId?.id).toBe(row.id);
    expect(byKey?.id).toBe(row.id);
    expect(db.byId.size).toBe(1);
  });

  it('returns the existing row when the same IdempotencyKey is inserted twice', async () => {
    const first = await enqueue(SAMPLE);
    const second = await enqueue({
      ...SAMPLE,
      content: 'must not replace the snapshot',
    });
    expect(second.duplicate).toBe(true);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.content).toBe(first.row.content);
    expect(db.byKey.size).toBe(1);
    expect(db.byId.size).toBe(1);
  });

  it('does not create duplicates under concurrent inserts of the same IdempotencyKey', async () => {
    const [a, b] = await Promise.all([enqueue(SAMPLE), enqueue(SAMPLE)]);
    expect(a.row.id).toBe(b.row.id);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(db.byId.size).toBe(1);
    expect(db.byKey.size).toBe(1);
  });

  it('lists newest-first, bounded, with branch and status filters', async () => {
    const older = await enqueue({ ...SAMPLE, idempotencyKey: 'k:1', content: 'one', branchId: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const newerSameSecond = await enqueue({
      ...SAMPLE,
      idempotencyKey: 'k:2',
      content: 'two',
      branchId: 1,
    });
    const otherBranch = await enqueue({
      ...SAMPLE,
      idempotencyKey: 'k:3',
      content: 'three',
      branchId: 2,
    });

    const all = await list({ fetchLimit: 2 });
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe(otherBranch.row.id);
    expect(all[1]!.id).toBe(newerSameSecond.row.id);

    const branch1 = await list({ fetchLimit: 10, branchId: 1 });
    expect(branch1.map((row) => row.id)).toEqual([newerSameSecond.row.id, older.row.id]);

    const pending = await list({ fetchLimit: 10, status: 'pending', channel: 'whatsapp' });
    expect(pending).toHaveLength(3);

    const page2 = await list({
      fetchLimit: 10,
      cursorCreatedAt: new Date(all[1]!.createdAt),
      cursorId: all[1]!.id,
    });
    expect(page2.map((row) => row.id)).toEqual([older.row.id]);
  });

  it('claims pending rows atomically and skips a future NextAttemptAt', async () => {
    const now = Date.now();
    await enqueue({ ...SAMPLE, idempotencyKey: 'ready' });
    await enqueue({ ...SAMPLE, idempotencyKey: 'later' });
    const later = [...db.byId.values()].find((row) => row.IdempotencyKey === 'later')!;
    later.NextAttemptAt = new Date(now + 60_000);

    const [a, b] = await Promise.all([
      claimPendingBatch({ batchSize: 10, lockedBy: 'worker-a' }),
      claimPendingBatch({ batchSize: 10, lockedBy: 'worker-b' }),
    ]);
    const claimedIds = [...a, ...b].map((row) => row.id);
    expect(claimedIds).toHaveLength(1);
    expect(new Set(claimedIds).size).toBe(1);
    expect(a.concat(b)[0]?.status).toBe('sending');
    expect(a.concat(b)[0]?.attemptCount).toBe(1);
    expect(later.Status).toBe('pending');
  });

  it('marks sent, retries, fails, and recovers stale sending without changing the key', async () => {
    const { row: sentSeed } = await enqueue({ ...SAMPLE, idempotencyKey: 'lifecycle' });
    const [claimed] = await claimPendingBatch({ batchSize: 1, lockedBy: 'w1' });
    expect(claimed.id).toBe(sentSeed.id);
    const sent = await markSent({ id: claimed.id, providerMessageId: 'wa-abc' });
    expect(sent?.status).toBe('sent');
    expect(sent?.providerMessageId).toBe('wa-abc');
    expect(sent?.lockedAt).toBeNull();

    const second = await enqueue({ ...SAMPLE, idempotencyKey: 'retry-me' });
    const [sending] = await claimPendingBatch({ batchSize: 1, lockedBy: 'w1' });
    const retried = await scheduleRetry({
      id: sending.id,
      nextAttemptAt: new Date(Date.now() + 10_000),
      lastError: 'timeout',
    });
    expect(retried?.status).toBe('pending');
    expect(retried?.lastError).toBe('timeout');

    const failed = await markFailed({ id: second.row.id, lastError: 'conflict' });
    expect(failed?.status).toBe('failed');

    const staleKey = 'stale-key';
    const stale = await enqueue({ ...SAMPLE, idempotencyKey: staleKey });
    const raw = db.byId.get(stale.row.id)!;
    raw.Status = 'sending';
    raw.LockedAt = new Date(Date.now() - 400_000);
    raw.LockedBy = 'dead';
    const recovered = await recoverStaleSending({ lockTtlMs: 300_000 });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.status).toBe('pending');
    expect(recovered[0]?.idempotencyKey).toBe(staleKey);
    expect(db.byId.get(stale.row.id)?.IdempotencyKey).toBe(staleKey);
  });
});
