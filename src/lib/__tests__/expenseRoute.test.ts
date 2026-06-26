import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ──── Hoisted mock state (safe to reassign in beforeEach) ────
let fakeAllocateInvID = vi.fn();
let fakeCommit = vi.fn();
let fakeRollback = vi.fn();
let fakeTransactionBegin = vi.fn();
let txQueryResults: any[] = [];
let txQueryIdx = 0;

// Mock server-only modules BEFORE importing route handlers
vi.mock('server-only', () => ({}));
vi.mock('@/lib/api-auth', () => ({
  requireRole: vi.fn().mockResolvedValue({ UserID: 1, UserName: 'Admin' }),
  isAuthResult: vi.fn().mockReturnValue(true),
}));

function makeFakeDb(results: { recordset: any[] }[]) {
  let idx = 0;
  return {
    request: vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn(async () => {
        const res = results[idx] ?? { recordset: [] };
        idx++;
        return res;
      }),
    })),
  };
}

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => makeFakeDb([])),
  allocateInvID: vi.fn(async (...args: any[]) => fakeAllocateInvID(...args)),
  sql: {
    Int: () => ({ type: 'int' }),
    Date: () => ({ type: 'date' }),
    Decimal: () => ({ type: 'decimal' }),
    NVarChar: (n: any) => ({ type: 'nvarchar', length: n }),
    MAX: -1,
    Request: class FakeRequest {
      private _inputs: any = {};
      input(name: string, _type: any, value: any) {
        this._inputs[name] = value;
        return this;
      }
      async query() {
        const res = txQueryResults[txQueryIdx] ?? { recordset: [], rowsAffected: [0] };
        txQueryIdx++;
        return res;
      }
    },
    Transaction: class FakeTx {
      async begin() { fakeTransactionBegin(); }
      async commit() { fakeCommit(); }
      async rollback() { fakeRollback(); }
    },
    ISOLATION_LEVEL: { SERIALIZABLE: 0 },
  },
}));

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => ({ UserID: 1, UserName: 'Admin', UserLevel: 1 })),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-request-id-123'),
}));

// Import route handlers AFTER mocks are established
import { POST as postExpense } from '@/app/api/expenses/route';
import { POST as postPastDateExpense } from '@/app/api/expenses/past-date/route';
import { getSession } from '@/lib/session';
import { getPool } from '@/lib/db';

function makeRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/expenses', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function makePastDateRequest(body: object): NextRequest {
  return new NextRequest('http://localhost/api/expenses/past-date', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Reset everything before each test so mock implementations don't leak
function resetMocks() {
  vi.clearAllMocks();
  fakeCommit = vi.fn();
  fakeRollback = vi.fn();
  fakeTransactionBegin = vi.fn();
  fakeAllocateInvID = vi.fn();
  txQueryResults = [];
  txQueryIdx = 0;
  (getSession as any).mockResolvedValue({ UserID: 1, UserName: 'Admin', UserLevel: 1 });
  (getPool as any).mockImplementation(async () => makeFakeDb([
    { recordset: [{ ID: 1, NewDay: '2025-01-15' }] },
    { recordset: [{ ID: 10, UserID: 1, ShiftID: 1 }] },
    { recordset: [{ ExpINID: 5, CatName: 'TestCat' }] },
  ]));
}

describe('POST /api/expenses', () => {
  beforeEach(resetMocks);

  it('returns 400 when expINID is missing', async () => {
    const res = await postExpense(makeRequest({ amount: 100, paymentMethodId: 1 }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('فئة');
  });

  it('returns 400 when amount is non-positive', async () => {
    const res = await postExpense(makeRequest({ expINID: 5, amount: 0, paymentMethodId: 1 }));
    expect(res.status).toBe(400);
  });

  it('returns 401 when no session', async () => {
    (getSession as any).mockResolvedValue(null);
    const res = await postExpense(makeRequest({ expINID: 5, amount: 100, paymentMethodId: 1 }));
    expect(res.status).toBe(401);
  });

  it('returns 503 when lock acquisition fails (TREASURY_BUSY)', async () => {
    fakeAllocateInvID.mockRejectedValue(Object.assign(
      new Error('الخزينة مشغولة'),
      { code: 'TREASURY_BUSY', statusCode: 503 }
    ));

    const res = await postExpense(makeRequest({ expINID: 5, amount: 100, paymentMethodId: 1 }));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe('TREASURY_BUSY');
    expect(json.requestId).toBeDefined();
  });

  it('returns 201 on successful expense creation', async () => {
    fakeAllocateInvID.mockResolvedValue(999);

    const res = await postExpense(makeRequest({ expINID: 5, amount: 100, paymentMethodId: 1 }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.invID).toBe(999);
    expect(json.amount).toBe(100);
    expect(fakeCommit).toHaveBeenCalled();
  });

  it('performs rollback on unexpected error after transaction begin', async () => {
    fakeAllocateInvID.mockRejectedValue(new Error('Unexpected DB error'));

    const res = await postExpense(makeRequest({ expINID: 5, amount: 100, paymentMethodId: 1 }));
    expect(res.status).toBe(500);
    expect(fakeRollback).toHaveBeenCalled();
  });
});

describe('POST /api/expenses/past-date', () => {
  beforeEach(() => {
    resetMocks();
    (getPool as any).mockImplementation(async () => makeFakeDb([
      { recordset: [{ ExpINID: 5, CatName: 'TestCat' }] },
    ]));
  });

  it('returns 400 for future date', async () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 1);
    const res = await postPastDateExpense(makePastDateRequest({
      invDate: futureDate.toISOString().split('T')[0],
      amount: 100,
      expINID: 5,
      paymentMethodId: 1,
    }));
    expect(res.status).toBe(400);
  });

  it('returns 503 on lock timeout (SQL error 1222)', async () => {
    (getPool as any).mockImplementation(async () => makeFakeDb([
      { recordset: [{ ExpINID: 5, CatName: 'TestCat' }] },
    ]));
    txQueryResults = [
      { recordset: [] }, // idempotency check empty
    ];
    fakeAllocateInvID.mockRejectedValue(Object.assign(
      new Error('Lock timeout'),
      { number: 1222 }
    ));

    const res = await postPastDateExpense(makePastDateRequest({
      invDate: '2024-01-01',
      amount: 100,
      expINID: 5,
      paymentMethodId: 1,
    }));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.code).toBe('LOCK_TIMEOUT');
  });

  it('performs rollback on unexpected error in past-date transaction', async () => {
    (getPool as any).mockImplementation(async () => makeFakeDb([
      { recordset: [{ ExpINID: 5, CatName: 'TestCat' }] },
    ]));
    txQueryResults = [{ recordset: [] }];
    fakeAllocateInvID.mockRejectedValue(new Error('DB crashed'));

    const res = await postPastDateExpense(makePastDateRequest({
      invDate: '2024-01-01',
      amount: 100,
      expINID: 5,
      paymentMethodId: 1,
    }));
    expect(res.status).toBe(500);
    expect(fakeRollback).toHaveBeenCalled();
  });
});
