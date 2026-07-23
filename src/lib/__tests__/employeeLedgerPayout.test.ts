import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const originalFlag = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;

let fakeCommit = vi.fn();
let fakeRollback = vi.fn();
let txQueryResults: Array<{ recordset?: unknown[]; rowsAffected?: number[] }> = [];
let txQueryIdx = 0;
let fakeAllocateInvID = vi.fn();

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
  allocateInvID: vi.fn(async (...args: unknown[]) => fakeAllocateInvID(...args)),
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
      async begin() {}
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

vi.mock('@/lib/api-auth', () => ({
  requirePageAccess: vi.fn(async () => ({
    ok: true,
    userId: 1,
    userName: 'Admin',
    userLevel: '1',
    roles: ['admin'],
    isSuperAdmin: false,
  })),
  isAuthResult: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/branch/context', () => ({
  requireBranchOperationAccess: vi.fn(async () => ({
    userId: 1,
    branchId: 1,
    branchCode: 'MAIN',
    branchName: 'Main Branch',
    shortName: 'Main',
    timeZone: 'Africa/Cairo',
    businessDayCutoffTime: '04:00',
    canOperate: true,
    canViewReports: true,
    canSwitch: true,
  })),
}));

vi.mock('@/lib/branch/operationalGates', () => ({
  resolveBranchDayForDate: vi.fn(async () => ({
    ok: true,
    day: { id: 1, branchId: 1, newDay: '2026-04-15', status: true },
  })),
}));

function resetMocks() {
  fakeCommit = vi.fn();
  fakeRollback = vi.fn();
  fakeAllocateInvID = vi.fn(async () => 9001);
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

describe('employeeLedgerPayoutService helpers', () => {
  beforeEach(() => {
    resetMocks();
    vi.resetModules();
  });

  it('creates payout expense category once and reuses it', async () => {
    const { ensurePayoutExpenseCategory, PAYOUT_EXPENSE_CATEGORY_NAME } =
      await import('@/lib/services/employeeLedgerPayoutService');
    const { sql } = await import('@/lib/db');
    txQueryResults = [
      { recordset: [] },
      { recordset: [{ ExpINID: 88 }] },
    ];
    const transaction = new sql.Transaction({} as never);

    const created = await ensurePayoutExpenseCategory(transaction);
    expect(created).toBe(88);
    expect(txQueryIdx).toBe(2);

    txQueryIdx = 0;
    txQueryResults = [{ recordset: [{ ExpINID: 88 }] }];
    const reused = await ensurePayoutExpenseCategory(transaction);
    expect(reused).toBe(88);
    expect(txQueryIdx).toBe(1);
    expect(PAYOUT_EXPENSE_CATEGORY_NAME).toBe('صرف مستحقات الموظفين');
  });

  it('inserts payout ledger debit entry', async () => {
    const { insertPayoutLedgerEntry, PAYOUT_LEDGER_NOTE } = await import('@/lib/services/employeeLedgerPayoutService');
    const { sql } = await import('@/lib/db');
    txQueryResults = [{ recordset: [{ ID: 501 }] }];
    const request = new sql.Request({} as never);

    const ledgerEntryId = await insertPayoutLedgerEntry(request, {
      empId: 3,
      cashMoveId: 200,
      entryDate: '2026-04-15',
      amount: 150,
      createdByUserId: 1,
    });

    expect(ledgerEntryId).toBe(501);
    expect(PAYOUT_LEDGER_NOTE).toBe('صرف مستحقات موظف من الخزنة');
  });
});

describe('executeEmployeePayout', () => {
  beforeEach(async () => {
    resetMocks();
    vi.resetModules();
    const { getPool } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ EmpID: 3, EmpName: 'أحمد' }] },
      { recordset: [{ PaymentID: 2 }] },
    ]));
  });

  it('rejects when feature flag is disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'false';
    const { executeEmployeePayout, EmployeeLedgerPayoutError } =
      await import('@/lib/services/employeeLedgerPayoutService');

    await expect(executeEmployeePayout({
      empId: 3,
      amount: 100,
      paymentMethodId: 2,
      payoutDate: '2026-04-15',
      branchId: 1,
      businessDayId: 1,
    })).rejects.toBeInstanceOf(EmployeeLedgerPayoutError);
  });

  it('rejects overpay by default', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    txQueryResults = [
      { recordset: [{ Balance: 50 }] },
    ];
    const { executeEmployeePayout, EmployeeLedgerPayoutError } =
      await import('@/lib/services/employeeLedgerPayoutService');

    await expect(executeEmployeePayout({
      empId: 3,
      amount: 100,
      paymentMethodId: 2,
      payoutDate: '2026-04-15',
      branchId: 1,
      businessDayId: 1,
    })).rejects.toThrow('المبلغ أكبر من رصيد الموظف الحالي');
    expect(fakeRollback).toHaveBeenCalled();
  });

  it('rejects missing payment method', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { getPool } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ EmpID: 3, EmpName: 'أحمد' }] },
      { recordset: [] },
    ]));
    const { executeEmployeePayout, EmployeeLedgerPayoutError } =
      await import('@/lib/services/employeeLedgerPayoutService');

    await expect(executeEmployeePayout({
      empId: 3,
      amount: 50,
      paymentMethodId: 99,
      payoutDate: '2026-04-15',
      branchId: 1,
      businessDayId: 1,
    })).rejects.toBeInstanceOf(EmployeeLedgerPayoutError);
  });

  it('creates cash move and ledger debit in one transaction and reduces balance', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    txQueryResults = [
      { recordset: [{ Balance: 300 }] },
      { recordset: [{ ExpINID: 77 }] },
      { recordset: [{ ID: 401 }] },
      { recordset: [{ ID: 901 }] },
    ];
    const { executeEmployeePayout } = await import('@/lib/services/employeeLedgerPayoutService');

    const result = await executeEmployeePayout({
      empId: 3,
      amount: 150,
      paymentMethodId: 2,
      payoutDate: '2026-04-15',
      notes: 'اختبار',
      createdByUserId: 1,
      branchId: 1,
      businessDayId: 1,
    });

    expect(result.success).toBe(true);
    expect(result.cashMoveId).toBe(401);
    expect(result.ledgerEntryId).toBe(901);
    expect(result.previousBalance).toBe(300);
    expect(result.payoutAmount).toBe(150);
    expect(result.newBalance).toBe(150);
    expect(result.ledgerDualWrite).toBe(true);
    expect(fakeCommit).toHaveBeenCalled();
    expect(fakeAllocateInvID).toHaveBeenCalled();
  });

  it('rolls back transaction when ledger insert fails', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { sql } = await import('@/lib/db');
    let queryCount = 0;

    (sql as unknown as { Request: new () => { input: () => unknown; query: () => Promise<unknown> } }).Request = class {
      input() {
        return this;
      }
      async query() {
        queryCount++;
        if (queryCount === 4) {
          throw new Error('ledger insert failed');
        }
        const res = txQueryResults[txQueryIdx] ?? { recordset: [], rowsAffected: [0] };
        txQueryIdx++;
        return res;
      }
    };

    txQueryResults = [
      { recordset: [{ Balance: 300 }] },
      { recordset: [{ ExpINID: 77 }] },
      { recordset: [{ ID: 401 }] },
    ];

    const { executeEmployeePayout, EmployeeLedgerPayoutError } =
      await import('@/lib/services/employeeLedgerPayoutService');

    await expect(executeEmployeePayout({
      empId: 3,
      amount: 150,
      paymentMethodId: 2,
      payoutDate: '2026-04-15',
      branchId: 1,
      businessDayId: 1,
    })).rejects.toBeInstanceOf(EmployeeLedgerPayoutError);
    expect(fakeRollback).toHaveBeenCalled();
    expect(fakeCommit).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/hr/employee-ledger/payout', () => {
  beforeEach(async () => {
    resetMocks();
    vi.resetModules();
  });

  it('returns 503 when feature flag is disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'false';
    const { getPool } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ EmpID: 3, EmpName: 'أحمد' }] },
      { recordset: [{ PaymentID: 2 }] },
    ]));

    const { POST } = await import('@/app/api/admin/hr/employee-ledger/payout/route');
    const res = await POST(new NextRequest('http://localhost/api/admin/hr/employee-ledger/payout', {
      method: 'POST',
      body: JSON.stringify({
        empId: 3,
        amount: 100,
        paymentMethodId: 2,
        payoutDate: '2026-04-15',
      }),
    }));
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toContain('EMP_LEDGER_DUAL_WRITE_ENABLED');
  });
});
