import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const mock = vi.hoisted(() => ({
  calls: [] as Array<{ text: string; params: Record<string, unknown> }>,
  results: [] as Array<{ recordset: Record<string, unknown>[]; rowsAffected?: number[] }>,
}));
vi.mock('@/lib/db', () => ({
  sql: {
    Int: 'INT', UniqueIdentifier: 'UUID', VarChar: () => 'VARCHAR',
    Request: class {
      params: Record<string, unknown> = {};
      input(name: string, _type: unknown, value: unknown) {
        this.params[name] = value; return this;
      }
      async query(text: string) {
        mock.calls.push({ text, params: { ...this.params } });
        return mock.results.shift() ?? { recordset: [] };
      }
    },
  },
}));
import {
  createSaleIdempotencyIntent,
  lookupCommittedSaleReplay,
  reserveSaleRequest, completeSaleRequest,
} from '@/lib/sales/saleRequestIdempotency.service';

const tenantId = '01234567-89ab-4cde-8fab-0123456789ab';
const requestId = '2ca6be48-092e-4d1e-9e31-98464bd4f991';
const raw = { clientId: 45, items: [{ proId: 9, sPrice: 100, qty: 1 }],
  paymentAllocations: [{ paymentMethodId: 1, amount: 50 }], referralCode: 'CUT-ABCDEF0123456789ABCDEF01' };
const session = { tenantId, userId: 7, branchId: 2 };
const tx = {} as import('mssql').Transaction;
const db = {} as import('mssql').ConnectionPool;
const ready = { recordset: [{ Ready: 1 }] };
function intent() {
  const res = createSaleIdempotencyIntent({
    ...session, rawRequestId: requestId, payload: { ...raw, requestId },
  });
  if (!res) throw Error('missing intent');
  return res;
}
function committed(i = intent()) {
  return { UserID: i.userId, BranchID: i.branchId,
    PayloadHash: i.fingerprint, Status: 'COMMITTED', InvID: 7001, InvType: 'مبيعات' };
}
beforeEach(() => {
  process.env.POS_SALE_IDEMPOTENCY_ENABLED = 'true';
  mock.results = []; mock.calls = [];
});
afterEach(() => delete process.env.POS_SALE_IDEMPOTENCY_ENABLED);

describe('durable POS sale request idempotency (#246)', () => {
  it('OFF by default preserves legacy request, but declines an unprotected explicit retry key', () => {
    delete process.env.POS_SALE_IDEMPOTENCY_ENABLED;
    expect(createSaleIdempotencyIntent({
      ...session, payload: raw, rawRequestId: undefined,
    })).toBeNull();
    expect(() => intent()).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_DISABLED', status: 503 }),
    );
  });

  it('requires a safe UUID v4 when enabled; never falls back to an unprotected POST', () => {
    for (const id of [undefined, 'abc', '1;DELETE', 45, '00000000-0000-0000-0000-000000000000']) {
      expect(() => createSaleIdempotencyIntent({
        ...session, rawRequestId: id, payload: raw,
      })).toThrowError(expect.objectContaining({ status: 400 }));
    }
  });

  it('hashes authenticated tenant, actor, branch and original entire body excluding requestId', () => {
    const a = intent();
    expect(a.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(createSaleIdempotencyIntent({
      ...session, rawRequestId: requestId,
      payload: { requestId, ...raw },
    })?.fingerprint).toBe(a.fingerprint);
    expect(createSaleIdempotencyIntent({
      ...session, rawRequestId: requestId,
      payload: { ...raw, items: [{ proId: 9, sPrice: 200, qty: 1 }] },
    })?.fingerprint).not.toBe(a.fingerprint);
    expect(createSaleIdempotencyIntent({
      ...session, branchId: 3, rawRequestId: requestId, payload: raw,
    })?.fingerprint).not.toBe(a.fingerprint);
  });

  it('never reads request ledger unless schema exists', async () => {
    mock.results = [{ recordset: [{ Ready: 0 }] }];
    await expect(lookupCommittedSaleReplay(db, intent())).rejects.toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_SCHEMA_UNAVAILABLE', status: 503 }),
    );
    expect(mock.calls).toHaveLength(1);
  });

  it('first clean POST has no replay and creates nothing until writer reservation', async () => {
    mock.results = [ready, { recordset: [] }];
    expect(await lookupCommittedSaleReplay(db, intent())).toBeNull();
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls.some(c => c.text.includes('INSERT INTO'))).toBe(false);
  });

  it('early retry returns the original paid invoice and checks tenant/branch under authenticated session', async () => {
    const i = intent();
    mock.results = [ready, { recordset: [committed(i)] }, { recordset: [{ invID: 7001 }] }];
    expect(await lookupCommittedSaleReplay(db, i)).toEqual({
      invID: 7001, invType: 'مبيعات', replayed: true,
    });
    expect(mock.calls[1]?.params).toMatchObject({ tenantId, requestId });
    expect(mock.calls[2]?.params).toMatchObject({ tenantId, branchId: 2, invId: 7001 });
    expect(mock.calls[2]?.text).toContain('l.TenantId = @tenantId');
    expect(mock.calls[2]?.text).toContain('h.Payment >= h.GrandTotal');
    expect(mock.calls.every(c => !/INSERT INTO|UPDATE dbo|DELETE FROM/.test(c.text))).toBe(true);
  });

  it('same key changed payload, actor or branch returns audited 409 (NO invoice)', async () => {
    const i = intent();
    for (const changed of [
      { ...committed(i), PayloadHash: 'a'.repeat(64) },
      { ...committed(i), UserID: 666 },
      { ...committed(i), BranchID: 3 },
    ]) {
      mock.calls = []; mock.results = [ready, { recordset: [changed] }];
      await expect(lookupCommittedSaleReplay(db, i)).rejects.toThrowError(
        expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT', status: 409 }),
      );
      expect(mock.calls.some(c => c.text.includes('TblinvServHead'))).toBe(false);
    }
  });

  it('refuses a previously refunded, deleted or no-longer-paid invoice as replay', async () => {
    const i = intent();
    mock.results = [ready, { recordset: [committed(i)] }, { recordset: [] }];
    await expect(lookupCommittedSaleReplay(db, i)).rejects.toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_INCONSISTENT', status: 409 }),
    );
  });

  it('locks UNIQUE tenant key before inserting new PENDING reservation under SERIALIZABLE', async () => {
    const i = intent();
    mock.results = [ready, { recordset: [] }, { recordset: [], rowsAffected: [1] }];
    expect(await reserveSaleRequest(tx, i)).toEqual({ kind: 'new', intent: i });
    expect(mock.calls[1]?.text).toContain('WITH (UPDLOCK, HOLDLOCK)');
    expect(mock.calls[2]?.text).toContain('INSERT INTO dbo.TblPosSaleRequest');
    expect(mock.calls[2]?.params).toMatchObject({
      tenantId, requestId, userId: 7, branchId: 2, fingerprint: i.fingerprint,
    });
  });

  it('a concurrent retry sees COMMITTED and returns original invoice before new sale writer runs', async () => {
    const i = intent();
    mock.results = [ready, { recordset: [committed(i)] }, { recordset: [{ invID: 7001 }] }];
    expect(await reserveSaleRequest(tx, i)).toEqual({
      kind: 'replay', result: { invID: 7001, invType: 'مبيعات', replayed: true },
    });
    expect(mock.calls.some(c => c.text.includes('INSERT INTO'))).toBe(false);
  });

  it('failed original transaction rolls back its PENDING record; COMMITTED only after full sale', async () => {
    const i = intent();
    mock.results = [{ recordset: [], rowsAffected: [1] }];
    await completeSaleRequest(tx, { kind: 'new', intent: i },
      { invID: 7001, invType: 'مبيعات' });
    expect(mock.calls[0]?.text).toContain("SET Status = N'COMMITTED'");
    expect(mock.calls[0]?.text).toContain("Status = N'PENDING'");
    expect(mock.calls[0]?.params).toMatchObject({
      tenantId, requestId, fingerprint: i.fingerprint, invId: 7001,
    });
  });

  it('if request completion touches zero rows, transaction MUST reject and roll back invoice', async () => {
    const i = intent();
    mock.results = [{ recordset: [], rowsAffected: [0] }];
    await expect(completeSaleRequest(tx, { kind: 'new', intent: i },
      { invID: 7001, invType: 'مبيعات' })).rejects.toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_INCONSISTENT', status: 409 }),
    );
  });

  it('rejects stale committed-PENDING or corrupted original invoice identities', async () => {
    const i = intent();
    mock.results = [ready, { recordset: [{ ...committed(i), Status: 'PENDING', InvID: null }] }];
    await expect(reserveSaleRequest(tx, i)).rejects.toThrowError(
      expect.objectContaining({ status: 409 }),
    );
  });
});
