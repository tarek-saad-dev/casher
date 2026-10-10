import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OutboxEnqueueRecord } from '@/modules/messaging/outbox/messageOutboxRepository';
import { TenantContextError } from '@/platform/tenant/tenantContext';
import { TENANT_A, TENANT_B, inTenant } from './support/messagingTenantTestKit';

type RawRow = {
  ID: number;
  TenantId: string | null;
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
  const queries: Array<{ text: string; params: Record<string, unknown> }> = [];
  let nextId = 1;

  let claimLock: Promise<void> = Promise.resolve();

  const tenantKey = (tenantId: unknown, key: unknown) => `${String(tenantId)}|${String(key)}`;

  function reset() {
    byId.clear();
    byKey.clear();
    queries.length = 0;
    nextId = 1;
    claimLock = Promise.resolve();
  }

  function requireTenant(params: Record<string, unknown>): string {
    if (typeof params.tenantId !== 'string' || !params.tenantId) {
      throw new Error('fake SQL: statement is missing @tenantId');
    }
    return params.tenantId;
  }

  function seed(row: Partial<RawRow> & { IdempotencyKey: string; TenantId: string | null }): RawRow {
    const now = new Date();
    const full: RawRow = {
      ID: nextId++,
      Channel: 'whatsapp',
      Recipient: '01557994946',
      TemplateKey: null,
      Content: 'seeded',
      MetadataJson: null,
      Status: 'pending',
      AttemptCount: 0,
      MaxAttempts: 5,
      NextAttemptAt: now,
      LockedAt: null,
      LockedBy: null,
      ProviderMessageID: null,
      LastError: null,
      BranchID: null,
      CreatedByUserID: null,
      CreatedAt: now,
      UpdatedAt: null,
      SentAt: null,
      FailedAt: null,
      ...row,
    };
    byKey.set(tenantKey(full.TenantId, full.IdempotencyKey), full);
    byId.set(full.ID, full);
    return full;
  }

  async function insert(params: Record<string, unknown>): Promise<{ recordset: RawRow[] }> {
    const tenantId = requireTenant(params);
    const key = String(params.idempotencyKey);
    const unique = tenantKey(tenantId, key);
    const violation = () =>
      Object.assign(
        new Error("Violation of UNIQUE KEY constraint 'UX_TblMessageOutbox_Tenant_IdempotencyKey'."),
        { number: 2627 },
      );
    await Promise.resolve();
    if (byKey.has(unique)) throw violation();
    await new Promise((resolve) => setTimeout(resolve, 15));
    if (byKey.has(unique)) throw violation();
    const now = new Date();
    const row: RawRow = {
      ID: nextId++,
      TenantId: tenantId,
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
    byKey.set(unique, row);
    byId.set(row.ID, row);
    return { recordset: [{ ...row }] };
  }

  function list(params: Record<string, unknown>): { recordset: RawRow[] } {
    const tenantId = requireTenant(params);
    const fetchLimit = Number(params.fetchLimit ?? 50);
    const cursorAt = params.cursorCreatedAt as Date | null;
    const cursorId = params.cursorId == null ? null : Number(params.cursorId);
    const rows = [...byId.values()].filter((row) => {
      if (row.TenantId !== tenantId) return false;
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
          if (row.TenantId == null) return false;
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
    params: Record<string, unknown>,
    patch: (row: RawRow) => void,
    predicate?: (row: RawRow) => boolean,
  ): { recordset: RawRow[] } {
    const tenantId = requireTenant(params);
    const row = byId.get(Number(params.id));
    if (!row || row.TenantId !== tenantId || (predicate && !predicate(row))) return { recordset: [] };
    patch(row);
    return { recordset: [{ ...row }] };
  }

  function recoverStale(params: Record<string, unknown>): { recordset: RawRow[] } {
    const ttl = Number(params.lockTtlMs ?? 300000);
    const cutoff = Date.now() - ttl;
    const recovered: RawRow[] = [];
    for (const row of byId.values()) {
      if (row.TenantId == null) continue;
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
        queries.push({ text, params: { ...params } });
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
          return updateById(params, (row) => {
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
          return updateById(params, (row) => {
            row.Status = 'pending';
            row.NextAttemptAt = params.nextAttemptAt as Date;
            row.UpdatedAt = new Date();
            row.LockedAt = null;
            row.LockedBy = null;
            row.LastError = String(params.lastError ?? '');
          }, (row) => row.Status === 'sending');
        }
        if (/\[Status\] = N'failed'/i.test(text)) {
          return updateById(params, (row) => {
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
          const row = byKey.get(tenantKey(requireTenant(params), params.idempotencyKey ?? ''));
          return { recordset: row ? [{ ...row }] : [] };
        }
        if (/\[ID\]\s*=\s*@id/i.test(text)) {
          const tenantId = requireTenant(params);
          const row = byId.get(Number(params.id));
          return { recordset: row && row.TenantId === tenantId ? [{ ...row }] : [] };
        }
        if (/ORDER BY \[CreatedAt\] DESC,\s*\[ID\] DESC/i.test(text)) {
          return list(params);
        }
        throw new Error(`Unexpected SQL in test fake: ${text.slice(0, 120)}`);
      },
    };
  }

  return { reset, request, seed, byId, byKey, queries };
});

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({ request: () => db.request() })),
  sql: {
    MAX: 65535,
    Int: {},
    BigInt: {},
    DateTime2: {},
    UniqueIdentifier: {},
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

const inA = <T>(fn: () => Promise<T>) => inTenant(TENANT_A, fn);
const inB = <T>(fn: () => Promise<T>) => inTenant(TENANT_B, fn);

describe('messageOutboxRepository', () => {
  beforeEach(() => {
    db.reset();
  });

  it('inserts a pending snapshot row and looks it up by id / idempotency key', async () => {
    const { row, duplicate } = await inA(() => enqueue(SAMPLE));
    expect(duplicate).toBe(false);
    expect(row.tenantId).toBe(TENANT_A);
    expect(row.status).toBe('pending');
    expect(row.attemptCount).toBe(0);
    expect(row.providerMessageId).toBeNull();
    expect(row.content).toBe('[OUTBOX-5A-TEST] rendered snapshot');
    expect(row.templateKey).toBe('sale.customer_receipt');
    expect(row.metadataJson).toBe(JSON.stringify({ invoiceId: 40004 }));

    const byId = await inA(() => getById(row.id));
    const byKey = await inA(() => getByIdempotencyKey(SAMPLE.idempotencyKey));
    expect(byId?.id).toBe(row.id);
    expect(byKey?.id).toBe(row.id);
    expect(db.byId.size).toBe(1);
  });

  it('returns the existing row when the same IdempotencyKey is inserted twice', async () => {
    const first = await inA(() => enqueue(SAMPLE));
    const second = await inA(() =>
      enqueue({
        ...SAMPLE,
        content: 'must not replace the snapshot',
      }),
    );
    expect(second.duplicate).toBe(true);
    expect(second.row.id).toBe(first.row.id);
    expect(second.row.content).toBe(first.row.content);
    expect(db.byKey.size).toBe(1);
    expect(db.byId.size).toBe(1);
  });

  it('does not create duplicates under concurrent inserts of the same IdempotencyKey', async () => {
    const [a, b] = await Promise.all([inA(() => enqueue(SAMPLE)), inA(() => enqueue(SAMPLE))]);
    expect(a.row.id).toBe(b.row.id);
    expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
    expect(db.byId.size).toBe(1);
    expect(db.byKey.size).toBe(1);
  });

  it('lists newest-first, bounded, with branch and status filters', async () => {
    const older = await inA(() => enqueue({ ...SAMPLE, idempotencyKey: 'k:1', content: 'one', branchId: 1 }));
    await new Promise((r) => setTimeout(r, 5));
    const newerSameSecond = await inA(() =>
      enqueue({
        ...SAMPLE,
        idempotencyKey: 'k:2',
        content: 'two',
        branchId: 1,
      }),
    );
    const otherBranch = await inA(() =>
      enqueue({
        ...SAMPLE,
        idempotencyKey: 'k:3',
        content: 'three',
        branchId: 2,
      }),
    );

    const all = await inA(() => list({ fetchLimit: 2 }));
    expect(all).toHaveLength(2);
    expect(all[0]!.id).toBe(otherBranch.row.id);
    expect(all[1]!.id).toBe(newerSameSecond.row.id);

    const branch1 = await inA(() => list({ fetchLimit: 10, branchId: 1 }));
    expect(branch1.map((row) => row.id)).toEqual([newerSameSecond.row.id, older.row.id]);

    const pending = await inA(() => list({ fetchLimit: 10, status: 'pending', channel: 'whatsapp' }));
    expect(pending).toHaveLength(3);

    const page2 = await inA(() =>
      list({
        fetchLimit: 10,
        cursorCreatedAt: new Date(all[1]!.createdAt),
        cursorId: all[1]!.id,
      }),
    );
    expect(page2.map((row) => row.id)).toEqual([older.row.id]);
  });

  it('claims pending rows atomically and skips a future NextAttemptAt', async () => {
    const now = Date.now();
    await inA(() => enqueue({ ...SAMPLE, idempotencyKey: 'ready' }));
    await inA(() => enqueue({ ...SAMPLE, idempotencyKey: 'later' }));
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
    expect(a.concat(b)[0]?.tenantId).toBe(TENANT_A);
    expect(later.Status).toBe('pending');
  });

  it('marks sent, retries, fails, and recovers stale sending without changing the key', async () => {
    const { row: sentSeed } = await inA(() => enqueue({ ...SAMPLE, idempotencyKey: 'lifecycle' }));
    const [claimed] = await claimPendingBatch({ batchSize: 1, lockedBy: 'w1' });
    expect(claimed.id).toBe(sentSeed.id);
    const sent = await inA(() => markSent({ id: claimed.id, providerMessageId: 'wa-abc' }));
    expect(sent?.status).toBe('sent');
    expect(sent?.providerMessageId).toBe('wa-abc');
    expect(sent?.lockedAt).toBeNull();

    const second = await inA(() => enqueue({ ...SAMPLE, idempotencyKey: 'retry-me' }));
    const [sending] = await claimPendingBatch({ batchSize: 1, lockedBy: 'w1' });
    const retried = await inA(() =>
      scheduleRetry({
        id: sending.id,
        nextAttemptAt: new Date(Date.now() + 10_000),
        lastError: 'timeout',
      }),
    );
    expect(retried?.status).toBe('pending');
    expect(retried?.lastError).toBe('timeout');

    const failed = await inA(() => markFailed({ id: second.row.id, lastError: 'conflict' }));
    expect(failed?.status).toBe('failed');

    const staleKey = 'stale-key';
    const stale = await inA(() => enqueue({ ...SAMPLE, idempotencyKey: staleKey }));
    const raw = db.byId.get(stale.row.id)!;
    raw.Status = 'sending';
    raw.LockedAt = new Date(Date.now() - 400_000);
    raw.LockedBy = 'dead';
    const recovered = await recoverStaleSending({ lockTtlMs: 300_000 });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.status).toBe('pending');
    expect(recovered[0]?.idempotencyKey).toBe(staleKey);
    expect(recovered[0]?.tenantId).toBe(TENANT_A);
    expect(db.byId.get(stale.row.id)?.IdempotencyKey).toBe(staleKey);
  });

  it('throws TenantContextError for tenant-bound calls without a scope', async () => {
    await expect(enqueue(SAMPLE)).rejects.toBeInstanceOf(TenantContextError);
    await expect(getById(1)).rejects.toBeInstanceOf(TenantContextError);
    await expect(getByIdempotencyKey('k')).rejects.toBeInstanceOf(TenantContextError);
    await expect(markSent({ id: 1, providerMessageId: 'wa' })).rejects.toBeInstanceOf(TenantContextError);
    await expect(
      scheduleRetry({ id: 1, nextAttemptAt: new Date(), lastError: 'x' }),
    ).rejects.toBeInstanceOf(TenantContextError);
    await expect(markFailed({ id: 1, lastError: 'x' })).rejects.toBeInstanceOf(TenantContextError);
    await expect(list({ fetchLimit: 10 })).rejects.toBeInstanceOf(TenantContextError);
    expect(db.queries).toHaveLength(0);
    expect(db.byId.size).toBe(0);
  });

  it('binds @tenantId and filters/stamps TenantId in every tenant-bound statement', async () => {
    const { row } = await inA(() => enqueue(SAMPLE));
    await inA(() => getById(row.id));
    await inA(() => getByIdempotencyKey(SAMPLE.idempotencyKey));
    await inA(() => list({ fetchLimit: 10 }));
    await claimPendingBatch({ batchSize: 1, lockedBy: 'w1' });
    await inA(() => markSent({ id: row.id, providerMessageId: 'wa-1' }));
    await inA(() => scheduleRetry({ id: row.id, nextAttemptAt: new Date(), lastError: 'x' }));
    await inA(() => markFailed({ id: row.id, lastError: 'x' }));

    const bound = db.queries.filter((q) => !/UPDLOCK/i.test(q.text));
    expect(bound.length).toBeGreaterThanOrEqual(7);
    for (const q of bound) {
      expect(q.params.tenantId).toBe(TENANT_A);
      expect(q.text).toMatch(/@tenantId/);
    }
    const insert = bound.find((q) => /INSERT INTO/i.test(q.text))!;
    expect(insert.text).toMatch(/\[TenantId\],/);
    for (const q of bound.filter((q) => !/INSERT INTO/i.test(q.text))) {
      expect(q.text).toMatch(/\[TenantId\] = @tenantId/);
    }
  });

  it('cross-tenant workers span tenants but never touch rows without TenantId', async () => {
    db.seed({ TenantId: null, IdempotencyKey: 'orphan' });
    db.seed({
      TenantId: null,
      IdempotencyKey: 'orphan-stale',
      Status: 'sending',
      LockedAt: new Date(Date.now() - 400_000),
      LockedBy: 'dead',
    });
    await inA(() => enqueue({ ...SAMPLE, idempotencyKey: 'a-1' }));
    await inB(() => enqueue({ ...SAMPLE, idempotencyKey: 'b-1' }));

    const claimed = await claimPendingBatch({ batchSize: 10, lockedBy: 'w' });
    expect(claimed.map((r) => r.tenantId).sort()).toEqual([TENANT_A, TENANT_B].sort());

    const recovered = await recoverStaleSending({ lockTtlMs: 300_000 });
    expect(recovered).toEqual([]);

    const claimText = db.queries.find((q) => /UPDLOCK/i.test(q.text))!.text;
    expect(claimText).toMatch(/\[TenantId\] IS NOT NULL/);
    const recoverText = db.queries.find((q) => /-@lockTtlMs/i.test(q.text))!.text;
    expect(recoverText).toMatch(/\[TenantId\] IS NOT NULL/);
  });

  it('isolates tenants: same IdempotencyKey per tenant, no cross-tenant reads or updates', async () => {
    const a = await inA(() => enqueue(SAMPLE));
    const b = await inB(() => enqueue(SAMPLE));
    expect(b.duplicate).toBe(false);
    expect(b.row.id).not.toBe(a.row.id);
    expect(b.row.tenantId).toBe(TENANT_B);

    expect(await inB(() => getById(a.row.id))).toBeNull();
    expect((await inB(() => getByIdempotencyKey(SAMPLE.idempotencyKey)))?.id).toBe(b.row.id);
    expect((await inB(() => list({ fetchLimit: 10 }))).map((r) => r.id)).toEqual([b.row.id]);
    expect(await inB(() => markFailed({ id: a.row.id, lastError: 'x' }))).toBeNull();
    expect(db.byId.get(a.row.id)?.Status).toBe('pending');
  });
});
