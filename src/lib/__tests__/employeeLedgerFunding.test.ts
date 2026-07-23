import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

const originalFlag = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;

let fakeCommit = vi.fn();
let fakeRollback = vi.fn();
let txQueryResults: Array<{ recordset?: unknown[]; rowsAffected?: number[] }> = [];
let txQueryIdx = 0;
let fakeAllocateInvID = vi.fn();
const executedSql: string[] = [];

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
      async query(sqlText?: string) {
        if (typeof sqlText === 'string') executedSql.push(sqlText);
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
    day: { id: 1, branchId: 1, newDay: '2026-07-10', status: true },
  })),
}));

function resetMocks() {
  fakeCommit = vi.fn();
  fakeRollback = vi.fn();
  fakeAllocateInvID = vi.fn(async () => 8001);
  txQueryResults = [];
  txQueryIdx = 0;
  executedSql.length = 0;
}

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
  } else {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = originalFlag;
  }
  vi.resetModules();
});

describe('employeeLedgerFundingService', () => {
  beforeEach(() => {
    resetMocks();
    vi.resetModules();
  });

  it('creates income cash-in and ledger credit, increasing balance', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { getPool } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ EmpID: 3, EmpName: 'أحمد' }] },
      { recordset: [{ PaymentID: 2 }] },
    ]));
    txQueryResults = [
      { recordset: [{ Balance: 200 }] },
      { recordset: [{ ExpINID: 55 }] },
      { recordset: [{ ID: 501 }] },
      { recordset: [{ ID: 901 }] },
    ];

    const { executeEmployeeFunding } = await import('@/lib/services/employeeLedgerFundingService');
    const result = await executeEmployeeFunding({
      empId: 3,
      amount: 300,
      paymentMethodId: 2,
      date: '2026-07-10',
      notes: 'اختبار',
      createdByUserId: 1,
      branchId: 1,
      businessDayId: 1,
    });

    expect(result.success).toBe(true);
    expect(result.cashMoveId).toBe(501);
    expect(result.ledgerEntryId).toBe(901);
    expect(result.employeeName).toBe('أحمد');
    expect(result.amount).toBe(300);
    expect(result.previousBalance).toBe(200);
    expect(result.newBalance).toBe(500);
    expect(fakeCommit).toHaveBeenCalled();
    expect(fakeAllocateInvID).toHaveBeenCalledWith(expect.anything(), 'TblCashMove', 'ايرادات', 5000);
    expect(executedSql.some((sql) => sql.includes('@inOut') || sql.includes('inOut'))).toBe(true);
    expect(executedSql.some((sql) => sql.includes("N'credit'"))).toBe(true);
    expect(executedSql.some((sql) => sql.includes('@EntryReason') || sql.includes('EntryReason'))).toBe(true);
    expect(executedSql.some((sql) => sql.includes('مبيعات'))).toBe(false);
  });

  it('rolls back when ledger insert fails', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { getPool, sql } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ EmpID: 3, EmpName: 'أحمد' }] },
      { recordset: [{ PaymentID: 2 }] },
    ]));

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
      { recordset: [{ Balance: 0 }] },
      { recordset: [{ ExpINID: 55 }] },
      { recordset: [{ ID: 501 }] },
    ];

    const { executeEmployeeFunding, EmployeeLedgerFundingError } =
      await import('@/lib/services/employeeLedgerFundingService');

    await expect(executeEmployeeFunding({
      empId: 3,
      amount: 100,
      paymentMethodId: 2,
      date: '2026-07-10',
      branchId: 1,
      businessDayId: 1,
    })).rejects.toBeInstanceOf(EmployeeLedgerFundingError);
    expect(fakeRollback).toHaveBeenCalled();
    expect(fakeCommit).not.toHaveBeenCalled();
  });

  it('rejects when feature flag is disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'false';
    const { executeEmployeeFunding, EmployeeLedgerFundingError } =
      await import('@/lib/services/employeeLedgerFundingService');

    await expect(executeEmployeeFunding({
      empId: 3,
      amount: 100,
      paymentMethodId: 2,
      date: '2026-07-10',
      branchId: 1,
      businessDayId: 1,
    })).rejects.toBeInstanceOf(EmployeeLedgerFundingError);
  });

  it('funding increases balance available for payout', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    txQueryResults = [
      { recordset: [{ Balance: 0 }] },
      { recordset: [{ ExpINID: 55 }] },
      { recordset: [{ ID: 501 }] },
      { recordset: [{ ID: 901 }] },
    ];
    const { getPool } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ EmpID: 3, EmpName: 'أحمد' }] },
      { recordset: [{ PaymentID: 2 }] },
    ]));

    const { executeEmployeeFunding } = await import('@/lib/services/employeeLedgerFundingService');
    const funding = await executeEmployeeFunding({
      empId: 3,
      amount: 500,
      paymentMethodId: 2,
      date: '2026-07-10',
      branchId: 1,
      businessDayId: 1,
    });

    expect(funding.newBalance).toBe(500);

    txQueryIdx = 0;
    txQueryResults = [
      { recordset: [{ Balance: 500 }] },
      { recordset: [{ ExpINID: 77 }] },
      { recordset: [{ ID: 601 }] },
      { recordset: [{ ID: 902 }] },
    ];
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ EmpID: 3, EmpName: 'أحمد' }] },
      { recordset: [{ PaymentID: 2 }] },
    ]));

    const { executeEmployeePayout } = await import('@/lib/services/employeeLedgerPayoutService');
    const payout = await executeEmployeePayout({
      empId: 3,
      amount: 200,
      paymentMethodId: 2,
      payoutDate: '2026-07-11',
      branchId: 1,
      businessDayId: 1,
    });

    expect(payout.previousBalance).toBe(500);
    expect(payout.newBalance).toBe(300);
  });
});

describe('TreasurySummaryService employee funding exclusion', () => {
  it('excludes employee funding category from incomeIncoming query', async () => {
    const { getFinancialSummary } = await import('@/lib/services/TreasurySummaryService');
    const { getPool } = await import('@/lib/db');
    let capturedSql = '';
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => ({
      request: () => ({
        input: vi.fn().mockReturnThis(),
        query: vi.fn(async (sqlText: string) => {
          capturedSql = sqlText;
          return {
            recordset: [{
              TotalIncoming: 1000,
              TotalOutgoing: 200,
              SalesIncoming: 800,
              IncomeIncoming: 100,
              TransactionsCount: 5,
            }],
          };
        }),
      }),
    }));

    await getFinancialSummary({ fromDate: '2026-07-01', toDate: '2026-07-31' });
    expect(capturedSql).toContain('@employeeFundingCategory');
    expect(capturedSql).toContain('ISNULL(cat.CatName');
  });
});

describe('POST /api/admin/hr/employee-ledger/employee-funding', () => {
  beforeEach(() => {
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

    const { POST } = await import('@/app/api/admin/hr/employee-ledger/employee-funding/route');
    const res = await POST(new NextRequest('http://localhost/api/admin/hr/employee-ledger/employee-funding', {
      method: 'POST',
      body: JSON.stringify({
        empId: 3,
        amount: 100,
        paymentMethodId: 2,
        date: '2026-07-10',
      }),
    }));
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toContain('EMP_LEDGER_DUAL_WRITE_ENABLED');
  });
});
