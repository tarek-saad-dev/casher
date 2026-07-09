import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const originalFlag = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;

let fakeCommit = vi.fn();
let fakeRollback = vi.fn();
let fakeTransactionBegin = vi.fn();
let txQueryResults: Array<{ recordset?: unknown[]; rowsAffected?: number[] }> = [];
let txQueryIdx = 0;

function makeFakeDb(results: { recordset: unknown[] }[]) {
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
  allocateInvID: vi.fn(async () => 1001),
  sql: {
    Int: () => ({ type: 'int' }),
    Date: () => ({ type: 'date' }),
    Decimal: () => ({ type: 'decimal' }),
    NVarChar: (n: unknown) => ({ type: 'nvarchar', length: n }),
    MAX: -1,
    Request: class FakeRequest {
      input() {
        return this;
      }
      async query() {
        const res = txQueryResults[txQueryIdx] ?? { recordset: [], rowsAffected: [0] };
        txQueryIdx++;
        return res;
      }
    },
    Transaction: class FakeTx {
      async begin() {
        fakeTransactionBegin();
      }
      async commit() {
        fakeCommit();
      }
      async rollback() {
        fakeRollback();
      }
    },
    ISOLATION_LEVEL: { SERIALIZABLE: 0 },
  },
}));

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(async () => ({ UserID: 1, UserName: 'Admin', UserLevel: 1 })),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'advance-test-request-id'),
}));

function resetTxMocks() {
  fakeCommit = vi.fn();
  fakeRollback = vi.fn();
  fakeTransactionBegin = vi.fn();
  txQueryResults = [];
  txQueryIdx = 0;
}

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
  } else {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = originalFlag;
  }
  vi.resetModules();
});

describe('advance ledger dual-write helpers', () => {
  it('builds Arabic advance note', async () => {
    const { buildAdvanceLedgerNote } = await import('@/lib/services/employeeLedgerDualWrite');
    expect(buildAdvanceLedgerNote()).toBe('سلفة موظف من الخزنة');
  });

  it('inserts advance debit when no active row exists', async () => {
    const { upsertAdvanceLedgerEntry } = await import('@/lib/services/employeeLedgerDualWrite');
    let requestIndex = 0;
    const pool = {
      request: vi.fn(() => ({
        input: vi.fn().mockReturnThis(),
        query: vi.fn(async () => {
          const current = requestIndex++;
          return { rowsAffected: [current === 0 ? 0 : 1] };
        }),
      })),
    };

    const outcome = await upsertAdvanceLedgerEntry(pool as never, {
      empId: 7,
      cashMoveId: 501,
      entryDate: '2026-04-15',
      amount: 300,
      createdByUserId: 1,
    });

    expect(outcome).toBe('inserted');
    expect(pool.request).toHaveBeenCalledTimes(2);
  });

  it('updates advance debit when active row exists', async () => {
    const { upsertAdvanceLedgerEntry } = await import('@/lib/services/employeeLedgerDualWrite');

    const pool = {
      request: vi.fn(() => ({
        input: vi.fn().mockReturnThis(),
        query: vi.fn(async () => ({ rowsAffected: [1] })),
      })),
    };

    const outcome = await upsertAdvanceLedgerEntry(pool as never, {
      empId: 7,
      cashMoveId: 501,
      entryDate: '2026-04-15',
      amount: 350,
    });

    expect(outcome).toBe('updated');
    expect(pool.request).toHaveBeenCalledTimes(1);
  });
});

describe('maybeSyncAdvanceLedgerForExpenseCashMove', () => {
  beforeEach(() => {
    resetTxMocks();
    vi.resetModules();
  });

  it('skips ledger write when feature flag is disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'false';
    const { maybeSyncAdvanceLedgerForExpenseCashMove } = await import('@/lib/services/employeeLedgerDualWrite');
    const pool = { request: vi.fn() };
    const transaction = {} as never;

    const result = await maybeSyncAdvanceLedgerForExpenseCashMove(pool, transaction, {
      cashMoveId: 10,
      expINID: 99,
      entryDate: '2026-04-15',
      amount: 100,
    });

    expect(result).toEqual({ ledgerDualWrite: false });
    expect(pool.request).not.toHaveBeenCalled();
  });

  it('skips ledger write for normal operating expense category', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { maybeSyncAdvanceLedgerForExpenseCashMove } = await import('@/lib/services/employeeLedgerDualWrite');
    const { sql } = await import('@/lib/db');
    txQueryResults = [{ recordset: [] }];
    const transaction = new sql.Transaction({} as never);

    const result = await maybeSyncAdvanceLedgerForExpenseCashMove({ request: vi.fn() } as never, transaction, {
      cashMoveId: 10,
      expINID: 5,
      entryDate: '2026-04-15',
      amount: 100,
    });

    expect(result).toEqual({ ledgerDualWrite: false });
  });

  it('creates ledger debit for advance-mapped expense category', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { maybeSyncAdvanceLedgerForExpenseCashMove } = await import('@/lib/services/employeeLedgerDualWrite');
    const { sql } = await import('@/lib/db');
    txQueryResults = [
      { recordset: [{ mapEmpId: 3, resolvedEmpId: 3, empName: 'أحمد' }] },
      { rowsAffected: [0] },
      { rowsAffected: [1] },
    ];
    const transaction = new sql.Transaction({} as never);

    const result = await maybeSyncAdvanceLedgerForExpenseCashMove({ request: vi.fn() }, transaction, {
      cashMoveId: 88,
      expINID: 42,
      entryDate: '2026-04-15',
      amount: 250,
    });

    expect(result.ledgerDualWrite).toBe(true);
    expect(result.outcome).toBe('inserted');
  });

  it('throws when advance mapping exists but employee cannot be resolved', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { maybeSyncAdvanceLedgerForExpenseCashMove, EmployeeLedgerDualWriteError } =
      await import('@/lib/services/employeeLedgerDualWrite');
    const { sql } = await import('@/lib/db');
    txQueryResults = [
      { recordset: [{ mapEmpId: 3, resolvedEmpId: null, empName: null }] },
    ];
    const transaction = new sql.Transaction({} as never);

    await expect(maybeSyncAdvanceLedgerForExpenseCashMove({ request: vi.fn() }, transaction, {
      cashMoveId: 88,
      expINID: 42,
      entryDate: '2026-04-15',
      amount: 250,
    })).rejects.toBeInstanceOf(EmployeeLedgerDualWriteError);
  });

  it('updates existing ledger entry on repeated sync instead of duplicating', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { maybeSyncAdvanceLedgerForExpenseCashMove } = await import('@/lib/services/employeeLedgerDualWrite');
    const { sql } = await import('@/lib/db');
    txQueryResults = [
      { recordset: [{ mapEmpId: 3, resolvedEmpId: 3, empName: 'أحمد' }] },
      { rowsAffected: [1] },
    ];
    const transaction = new sql.Transaction({} as never);

    const result = await maybeSyncAdvanceLedgerForExpenseCashMove({ request: vi.fn() }, transaction, {
      cashMoveId: 88,
      expINID: 42,
      entryDate: '2026-04-16',
      amount: 275,
    });

    expect(result.ledgerDualWrite).toBe(true);
    expect(result.outcome).toBe('updated');
  });
});

describe('syncAdvanceLedgerForDeductionCashMove', () => {
  beforeEach(() => {
    resetTxMocks();
    vi.resetModules();
  });

  it('skips ledger write when feature flag is disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'false';
    const { syncAdvanceLedgerForDeductionCashMove } = await import('@/lib/services/employeeLedgerDualWrite');
    const pool = { request: vi.fn() };
    const transaction = {} as never;

    const result = await syncAdvanceLedgerForDeductionCashMove(pool, transaction, {
      empId: 3,
      cashMoveId: 200,
      entryDate: '2026-04-15',
      amount: 100,
    });

    expect(result).toEqual({ ledgerDualWrite: false });
  });

  it('creates one ledger debit for deduction expense cash move', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { syncAdvanceLedgerForDeductionCashMove } = await import('@/lib/services/employeeLedgerDualWrite');
    const { sql } = await import('@/lib/db');
    txQueryResults = [
      { rowsAffected: [0] },
      { rowsAffected: [1] },
    ];
    const transaction = new sql.Transaction({} as never);

    const result = await syncAdvanceLedgerForDeductionCashMove({ request: vi.fn() }, transaction, {
      empId: 3,
      cashMoveId: 200,
      entryDate: '2026-04-15',
      amount: 100,
    });

    expect(result.ledgerDualWrite).toBe(true);
    expect(result.outcome).toBe('inserted');
    expect(txQueryIdx).toBe(2);
  });
});

describe('POST /api/expenses advance dual-write', () => {
  beforeEach(async () => {
    resetTxMocks();
    vi.resetModules();
    const { getPool } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ ID: 1, NewDay: '2026-04-15' }] },
      { recordset: [{ ID: 10, UserID: 1, ShiftID: 1 }] },
      { recordset: [{ ExpINID: 5, CatName: 'TestCat' }] },
    ]));
  });

  it('returns ledgerDualWrite false for normal expense when flag is disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'false';
    txQueryResults = [
      { recordset: [] },
      { recordset: [{ ID: 501 }] },
    ];

    const { POST } = await import('@/app/api/expenses/route');
    const res = await POST(new NextRequest('http://localhost/api/expenses', {
      method: 'POST',
      body: JSON.stringify({ expINID: 5, amount: 100, paymentMethodId: 1 }),
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.ledgerDualWrite).toBe(false);
    expect(fakeCommit).toHaveBeenCalled();
  });

  it('returns ledgerDualWrite true for advance expense when flag is enabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { getPool } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ ID: 1, NewDay: '2026-04-15' }] },
      { recordset: [{ ID: 10, UserID: 1, ShiftID: 1 }] },
      { recordset: [{ ExpINID: 42, CatName: 'سلفة' }] },
    ]));
    txQueryResults = [
      { recordset: [] },
      { recordset: [{ ID: 777 }] },
      { recordset: [{ mapEmpId: 3, resolvedEmpId: 3, empName: 'أحمد' }] },
      { rowsAffected: [0] },
      { rowsAffected: [1] },
    ];

    const { POST } = await import('@/app/api/expenses/route');
    const res = await POST(new NextRequest('http://localhost/api/expenses', {
      method: 'POST',
      body: JSON.stringify({ expINID: 42, amount: 100, paymentMethodId: 1 }),
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.ledgerDualWrite).toBe(true);
    expect(data.ledgerSync).toBe('inserted');
    expect(data.cashMoveId).toBe(777);
  });

  it('rolls back and returns 503 when advance mapping is unresolved and flag is enabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { getPool } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ ID: 1, NewDay: '2026-04-15' }] },
      { recordset: [{ ID: 10, UserID: 1, ShiftID: 1 }] },
      { recordset: [{ ExpINID: 42, CatName: 'سلفة' }] },
    ]));
    txQueryResults = [
      { recordset: [] },
      { recordset: [{ ID: 777 }] },
      { recordset: [{ mapEmpId: 3, resolvedEmpId: null, empName: null }] },
    ];

    const { POST } = await import('@/app/api/expenses/route');
    const res = await POST(new NextRequest('http://localhost/api/expenses', {
      method: 'POST',
      body: JSON.stringify({ expINID: 42, amount: 100, paymentMethodId: 1 }),
    }));
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toContain('دفتر الموظف');
    expect(fakeRollback).toHaveBeenCalled();
    expect(fakeCommit).not.toHaveBeenCalled();
  });
});

describe('POST /api/deductions advance dual-write', () => {
  beforeEach(async () => {
    resetTxMocks();
    vi.resetModules();
    const { getPool } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ ID: 1, NewDay: '2026-04-15' }] },
      { recordset: [{ ID: 10, UserID: 1, ShiftID: 1 }] },
      {
        recordset: [{
          EmpID: 3,
          EmpName: 'أحمد',
          AdvanceExpINID: 42,
          AdvanceCatName: 'سلفة',
        }],
      },
      { recordset: [{ ExpINID: 99 }] },
    ]));
  });

  it('returns ledgerDualWrite false when flag is disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'false';
    txQueryResults = [
      { recordset: [{ ID: 201 }] },
      { recordset: [] },
    ];

    const { POST } = await import('@/app/api/deductions/route');
    const res = await POST(new NextRequest('http://localhost/api/deductions', {
      method: 'POST',
      body: JSON.stringify({ employeeId: 3, amount: 150, paymentMethodId: 1 }),
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.ledgerDualWrite).toBe(false);
    expect(data.deductionCashMoveId).toBe(201);
  });

  it('creates one ledger debit linked to deduction expense cash move only', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    txQueryResults = [
      { recordset: [{ ID: 301 }] },
      { rowsAffected: [0] },
      { rowsAffected: [1] },
      { rowsAffected: [1] },
    ];

    const { POST } = await import('@/app/api/deductions/route');
    const res = await POST(new NextRequest('http://localhost/api/deductions', {
      method: 'POST',
      body: JSON.stringify({ employeeId: 3, amount: 150, paymentMethodId: 1 }),
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.ledgerDualWrite).toBe(true);
    expect(data.ledgerSync).toBe('inserted');
    expect(data.deductionCashMoveId).toBe(301);
    expect(fakeCommit).toHaveBeenCalled();
  });
});
