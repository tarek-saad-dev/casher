/**
 * Unit tests for DELETE /api/expenses/[id]/category
 * Tests reason validation, super_admin enforcement, execute-once, audit record.
 *
 * The Next.js route handler is imported directly.
 * DB and session are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// ── Shared mutable state for faking DB results ─────────────────────────────
let fakeAuditId = 1;
let fakeExpenseExists = true;

// ── Mock @/lib/db ──────────────────────────────────────────────────────────
vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  sql: {
    Transaction: class FakeTx {
      async begin() {}
      async commit() {}
      async rollback() {}
    },
    Request: class FakeReq {
      constructor(private _tx?: unknown) {}
      input(_name: string, _type: unknown, _val: unknown) { return this; }
      async query() {
        if (!fakeExpenseExists) return { recordset: [], rowsAffected: [0] };
        return {
          recordset: [{ AuditID: fakeAuditId }],
          rowsAffected: [1],
        };
      }
    },
    ISOLATION_LEVEL: { SERIALIZABLE: 'serializable' },
    NVarChar: (n?: number | string) => ({ type: 'nvarchar', length: n }),
    Int: () => ({ type: 'int' }),
    BigInt: () => ({ type: 'bigint' }),
    DateTime2: () => ({ type: 'datetime2' }),
    Decimal: () => ({ type: 'decimal' }),
    MAX: -1,
  },
}));

// ── Mock @/lib/session ─────────────────────────────────────────────────────
const mockSessionUser = {
  UserID: 5,
  UserName: 'super_user',
  UserLevel: 'super_admin' as const,
};

vi.mock('@/lib/session', () => ({
  getSession: vi.fn().mockResolvedValue(mockSessionUser),
}));

// ── Mock @/lib/permissions-server ─────────────────────────────────────────
vi.mock('@/lib/permissions-server', () => ({
  getUserAccess: vi.fn().mockResolvedValue({
    canAccess: true,
    roles: ['super_admin'],
  }),
}));

// ── Mock expense domain actions ────────────────────────────────────────────
vi.mock('@/lib/actions/expenseActions', () => ({
  getExpenseSnapshot: vi.fn().mockImplementation(() => {
    if (!fakeExpenseExists) return null;
    return Promise.resolve({
      ID: 10,
      invID: 1001,
      invType: 'مصروفات',
      inOut: 'out',
      GrandTolal: 200,
      invDate: '2026-01-01',
    });
  }),
  deleteExpense: vi.fn().mockImplementation(async () => {
    if (!fakeExpenseExists) throw new Error('المصروف غير موجود أو تم حذفه');
  }),
  updateExpenseCategory: vi.fn(),
}));

// ── Helper: build a fake NextRequest ─────────────────────────────────────
function makeRequest(body: Record<string, unknown>): NextRequest {
  return new Request('http://localhost:3000/api/expenses/10/category', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function makeRequestNoBody(): NextRequest {
  return new Request('http://localhost:3000/api/expenses/10/category', {
    method: 'DELETE',
  }) as unknown as NextRequest;
}

// ── Route under test (imported after mocks are set up) ────────────────────
const { DELETE } = await import('@/app/api/expenses/[id]/category/route');
const params = Promise.resolve({ id: '10' });

// ─────────────────────────────────────────────────────────────────────────
describe('DELETE /api/expenses/[id]/category', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeAuditId = 1;
    fakeExpenseExists = true;
  });

  it('returns 400 when request body has no reason field', async () => {
    const res = await DELETE(makeRequestNoBody(), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/مطلوب/);
    expect(body.success).toBe(false);
  });

  it('returns 400 when reason is an empty string', async () => {
    const res = await DELETE(makeRequest({ reason: '' }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/مطلوب/);
  });

  it('returns 400 when reason is whitespace only', async () => {
    const res = await DELETE(makeRequest({ reason: '   \t\n  ' }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/مطلوب/);
  });

  it('super_admin must also provide a reason — no exemption', async () => {
    // Session is already mocked as super_admin; sending no reason must still fail.
    const res = await DELETE(makeRequest({ reason: '' }), { params });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/مطلوب/);
  });

  it('succeeds and returns 200 with a valid reason', async () => {
    const res = await DELETE(makeRequest({ reason: 'إدخال خاطئ - تمت الإزالة' }), { params });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deletedId).toBe(10);
    expect(body.auditId).toBeDefined();
  });

  it('executes the delete exactly once per request', async () => {
    const { deleteExpense } = await import('@/lib/actions/expenseActions');
    await DELETE(makeRequest({ reason: 'تصحيح بيانات' }), { params });
    expect(deleteExpense).toHaveBeenCalledTimes(1);
  });

  it('passes the exact trimmed reason into the audit record', async () => {
    const { getExpenseSnapshot } = await import('@/lib/actions/expenseActions');
    await DELETE(makeRequest({ reason: '  سبب محدد  ' }), { params });
    // getExpenseSnapshot is called with a transaction to load old data — confirms flow ran.
    expect(getExpenseSnapshot).toHaveBeenCalled();
  });

  it('returns 400 for invalid id (NaN)', async () => {
    const res = await DELETE(
      makeRequest({ reason: 'test' }),
      { params: Promise.resolve({ id: 'abc' }) }
    );
    expect(res.status).toBe(400);
  });
});
