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

function resetTxMocks() {
  fakeCommit = vi.fn();
  fakeRollback = vi.fn();
  fakeTransactionBegin = vi.fn();
  txQueryResults = [];
  txQueryIdx = 0;
}

function mockWriteGate() {
  vi.doMock('@/lib/branch/operationalGates', () => ({
    lockOperationalWrite: vi.fn(async () => ({
      day: { id: 1, branchId: 1, newDay: '2026-07-14', status: true },
      shift: {
        id: 9,
        branchId: 1,
        businessDayId: 1,
        newDay: '2026-07-14',
        userId: 1,
        shiftId: 1,
        status: true,
      },
    })),
    resolveBranchDayAndShiftForWrite: vi.fn(async () => ({
      ok: true,
      branch: {
        userId: 1,
        branchId: 1,
        branchCode: 'GLEEM',
        branchName: 'جليم',
        shortName: 'جليم',
        timeZone: 'Africa/Cairo',
        businessDayCutoffTime: '04:00:00',
        canOperate: true,
        canViewReports: true,
        canSwitch: true,
      },
      day: { id: 1, branchId: 1, newDay: '2026-07-14', status: true },
      shift: {
        id: 9,
        branchId: 1,
        businessDayId: 1,
        newDay: '2026-07-14',
        userId: 1,
        shiftId: 1,
        startDate: '2026-07-14',
        startTime: '10:00 AM',
        endDate: null,
        endTime: null,
        status: true,
      },
    })),
    branchErrorResponse: vi.fn(() => null),
  }));
}

afterEach(() => {
  if (originalFlag === undefined) {
    delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
  } else {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = originalFlag;
  }
  vi.resetModules();
});

describe('syncEmployeeFundingFromCashMove', () => {
  beforeEach(() => {
    resetTxMocks();
    vi.resetModules();
  });

  it('skips when dual-write flag is disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'false';
    const { syncEmployeeFundingFromCashMove } = await import(
      '@/lib/services/employeeLedgerFundingSyncService'
    );
    const { sql } = await import('@/lib/db');
    const transaction = new sql.Transaction({} as never);

    const result = await syncEmployeeFundingFromCashMove(transaction, 10);
    expect(result).toEqual({ outcome: 'skipped_flag_off', ledgerDualWrite: false });
  });

  it('inserts funding for revenue-mapped income cash move', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { syncEmployeeFundingFromCashMove } = await import(
      '@/lib/services/employeeLedgerFundingSyncService'
    );
    const { sql } = await import('@/lib/db');
    txQueryResults = [
      // load cash move
      {
        recordset: [{
          ID: 88,
          invType: 'ايرادات',
          inOut: 'in',
          ExpINID: 42,
          GrandTolal: 500,
          invDate: '2026-07-06',
          IsEmployeePayrollIncome: 0,
          CategoryName: 'طارق',
        }],
      },
      // resolve revenue map
      { recordset: [{ mapEmpId: 22, resolvedEmpId: 22, empName: 'طارق' }] },
      // attach emp
      { rowsAffected: [1] },
      // update miss
      { rowsAffected: [0] },
      // revive miss
      { rowsAffected: [0] },
      // branch id
      { recordset: [{ BranchID: 1 }] },
      // insert
      { rowsAffected: [1] },
    ];
    const transaction = new sql.Transaction({} as never);

    const result = await syncEmployeeFundingFromCashMove(transaction, 88, {
      createdByUserId: 1,
    });

    expect(result.ledgerDualWrite).toBe(true);
    expect(result.outcome).toBe('inserted');
    expect(result.empId).toBe(22);
    expect(result.amount).toBe(500);
  });

  it('deletes funding when category is no longer revenue-mapped', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { syncEmployeeFundingFromCashMove } = await import(
      '@/lib/services/employeeLedgerFundingSyncService'
    );
    const { sql } = await import('@/lib/db');
    txQueryResults = [
      {
        recordset: [{
          ID: 88,
          invType: 'ايرادات',
          inOut: 'in',
          ExpINID: 99,
          GrandTolal: 200,
          invDate: '2026-07-06',
          IsEmployeePayrollIncome: 0,
          CategoryName: 'إيراد عام',
        }],
      },
      { recordset: [] }, // not_revenue
      { rowsAffected: [1] }, // delete
    ];
    const transaction = new sql.Transaction({} as never);

    const result = await syncEmployeeFundingFromCashMove(transaction, 88);
    expect(result.outcome).toBe('deleted');
    expect(result.ledgerDualWrite).toBe(true);
  });

  it('skips payroll income mirrors', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { syncEmployeeFundingFromCashMove } = await import(
      '@/lib/services/employeeLedgerFundingSyncService'
    );
    const { sql } = await import('@/lib/db');
    txQueryResults = [
      {
        recordset: [{
          ID: 88,
          invType: 'ايرادات',
          inOut: 'in',
          ExpINID: 42,
          GrandTolal: 200,
          invDate: '2026-07-06',
          IsEmployeePayrollIncome: 1,
          CategoryName: 'طارق',
        }],
      },
      { rowsAffected: [0] },
    ];
    const transaction = new sql.Transaction({} as never);

    const result = await syncEmployeeFundingFromCashMove(transaction, 88);
    expect(result.outcome).toBe('skipped_payroll_mirror');
  });

  it('fail-closes when سد-style category has no EmpMap and no name match', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { syncEmployeeFundingFromCashMove, isEmployeeFundingLikeCategoryName } = await import(
      '@/lib/services/employeeLedgerFundingSyncService'
    );
    expect(isEmployeeFundingLikeCategoryName('سد ذياد')).toBe(true);

    const { sql } = await import('@/lib/db');
    const { EmployeeLedgerDualWriteError } = await import(
      '@/lib/services/employeeLedgerDualWrite'
    );
    txQueryResults = [
      {
        recordset: [{
          ID: 88,
          invType: 'ايرادات',
          inOut: 'in',
          ExpINID: 30,
          GrandTolal: 4000,
          invDate: '2026-07-01',
          IsEmployeePayrollIncome: 0,
          CategoryName: 'سد ذياد',
        }],
      },
      { recordset: [] }, // no revenue EmpMap
      { recordset: [] }, // no employee name hint
    ];
    const transaction = new sql.Transaction({} as never);

    await expect(syncEmployeeFundingFromCashMove(transaction, 88)).rejects.toBeInstanceOf(
      EmployeeLedgerDualWriteError,
    );
  });

  it('resolves سد ذياد via employee name hint when EmpMap missing', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { syncEmployeeFundingFromCashMove } = await import(
      '@/lib/services/employeeLedgerFundingSyncService'
    );
    const { sql } = await import('@/lib/db');
    txQueryResults = [
      {
        recordset: [{
          ID: 88,
          invType: 'ايرادات',
          inOut: 'in',
          ExpINID: 30,
          GrandTolal: 4000,
          invDate: '2026-07-01',
          IsEmployeePayrollIncome: 0,
          CategoryName: 'سد ذياد',
        }],
      },
      { recordset: [] }, // no EmpMap
      { recordset: [{ EmpID: 7, EmpName: 'ذياد' }] }, // name hint
      { rowsAffected: [1] }, // attach emp
      { rowsAffected: [0] }, // update miss
      { rowsAffected: [0] }, // revive miss
      { recordset: [{ BranchID: 1 }] }, // branch
      { rowsAffected: [1] }, // insert funding
    ];
    const transaction = new sql.Transaction({} as never);

    const result = await syncEmployeeFundingFromCashMove(transaction, 88, {
      createdByUserId: 1,
    });
    expect(result.ledgerDualWrite).toBe(true);
    expect(result.outcome).toBe('inserted');
    expect(result.empId).toBe(7);
    expect(result.amount).toBe(4000);
  });
});

describe('POST /api/incomes funding dual-write', () => {
  beforeEach(async () => {
    resetTxMocks();
    vi.resetModules();
    mockWriteGate();
    const { getPool } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([]));
  });

  it('returns ledgerDualWrite false for normal income when flag is disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'false';
    txQueryResults = [
      { recordset: [{ '': 1 }] },
      { recordset: [{ '': 1 }] },
      { recordset: [{ ID: 501, invID: 1001, invDate: '2026-07-14', invTime: '12:00', ExpINID: 5, Amount: 100, Notes: null, ShiftMoveID: 9, PaymentMethodID: 1 }] },
    ];

    const { POST } = await import('@/app/api/incomes/route');
    const res = await POST(new NextRequest('http://localhost/api/incomes', {
      method: 'POST',
      body: JSON.stringify({
        invDate: '2026-07-14',
        amount: 100,
        expInId: 5,
        paymentMethodId: 1,
      }),
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.ledgerDualWrite).toBe(false);
    expect(data.ledgerSync).toBe('skipped_flag_off');
    expect(fakeCommit).toHaveBeenCalled();
  });

  it('returns ledgerDualWrite true when income category is revenue-mapped', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    txQueryResults = [
      { recordset: [{ '': 1 }] },
      { recordset: [{ '': 1 }] },
      { recordset: [{ ID: 501, invID: 1001, invDate: '2026-07-14', invTime: '12:00', ExpINID: 5, Amount: 100, Notes: null, ShiftMoveID: 9, PaymentMethodID: 1 }] },
      // syncEmployeeFundingFromCashMove
      {
        recordset: [{
          ID: 501,
          invType: 'ايرادات',
          inOut: 'in',
          ExpINID: 5,
          GrandTolal: 100,
          invDate: '2026-07-14',
          IsEmployeePayrollIncome: 0,
          CategoryName: 'طارق',
        }],
      },
      { recordset: [{ mapEmpId: 22, resolvedEmpId: 22, empName: 'طارق' }] },
      { rowsAffected: [1] },
      { rowsAffected: [0] },
      { rowsAffected: [0] },
      { recordset: [{ BranchID: 1 }] },
      { rowsAffected: [1] },
    ];

    const { POST } = await import('@/app/api/incomes/route');
    const res = await POST(new NextRequest('http://localhost/api/incomes', {
      method: 'POST',
      body: JSON.stringify({
        invDate: '2026-07-14',
        amount: 100,
        expInId: 5,
        paymentMethodId: 1,
      }),
    }));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.ledgerDualWrite).toBe(true);
    expect(data.ledgerSync).toBe('inserted');
    expect(fakeCommit).toHaveBeenCalled();
  });
});
