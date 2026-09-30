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

vi.mock('@/lib/hr/employee-hr-advance', () => ({
  ensureEmployeeAdvanceMapping: vi.fn(async () => ({ expINID: 55, catName: 'سلفه ( أحمد )' })),
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
    branchCode: 'GLEEM',
    branchName: 'جليم',
    shortName: 'جليم',
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

describe('employeeLedgerDuesSettlementService helpers', () => {
  beforeEach(() => {
    resetMocks();
    vi.resetModules();
  });

  it('builds final-advance settlement notes', async () => {
    const {
      buildDuesSettlementLedgerNote,
      buildDuesSettlementCashMoveNotes,
    } = await import('@/lib/services/employeeLedgerDuesSettlementService');

    expect(buildDuesSettlementLedgerNote('2026-04')).toBe(
      'سلفة أخيرة للشهر 2026-04 — صرف مستحقات',
    );
    expect(buildDuesSettlementCashMoveNotes('أحمد', '2026-04', 'abc-123')).toContain(
      'سلفة أخيرة للشهر 2026-04 — صرف مستحقات',
    );
    expect(buildDuesSettlementCashMoveNotes('أحمد', '2026-04', 'abc-12345')).toContain(
      '[settle-id:abc-12345]',
    );
  });
});

describe('executeEmployeeDuesSettlement', () => {
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
    const { executeEmployeeDuesSettlement, EmployeeLedgerDuesSettlementError } =
      await import('@/lib/services/employeeLedgerDuesSettlementService');

    await expect(executeEmployeeDuesSettlement({
      empId: 3,
      amount: 500,
      expectedBalance: 500,
      payrollMonth: '2026-04',
      paymentMethodId: 2,
      payoutDate: '2026-04-15',
      branchId: 1,
      businessDayId: 1,
    })).rejects.toBeInstanceOf(EmployeeLedgerDuesSettlementError);
  });

  it('rejects zero or negative monthly balance', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    txQueryResults = [
      { recordset: [] },
      { recordset: [{ Balance: 0 }] },
    ];
    const { executeEmployeeDuesSettlement } =
      await import('@/lib/services/employeeLedgerDuesSettlementService');

    await expect(executeEmployeeDuesSettlement({
      empId: 3,
      amount: 100,
      expectedBalance: 100,
      payrollMonth: '2026-04',
      paymentMethodId: 2,
      payoutDate: '2026-04-15',
      branchId: 1,
      businessDayId: 1,
    })).rejects.toThrow('لا يوجد مستحقات موجبة');
    expect(fakeRollback).toHaveBeenCalled();
  });

  it('rejects stale client balance vs server monthly balance', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    txQueryResults = [
      { recordset: [{ Balance: 400 }] },
    ];
    const { executeEmployeeDuesSettlement } =
      await import('@/lib/services/employeeLedgerDuesSettlementService');

    await expect(executeEmployeeDuesSettlement({
      empId: 3,
      amount: 500,
      expectedBalance: 500,
      payrollMonth: '2026-04',
      paymentMethodId: 2,
      payoutDate: '2026-04-15',
      branchId: 1,
      businessDayId: 1,
    })).rejects.toThrow('تغيّر رصيد الشهر');
    expect(fakeRollback).toHaveBeenCalled();
  });

  it('creates advance cash-out and ledger debit for full monthly balance 500 -> 0', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    txQueryResults = [
      { recordset: [] },
      { recordset: [{ Balance: 500 }] },
      { recordset: [{ ID: 401 }] },
      { recordset: [{ ID: 901 }] },
    ];
    const { executeEmployeeDuesSettlement } =
      await import('@/lib/services/employeeLedgerDuesSettlementService');
    const { ensureEmployeeAdvanceMapping } = await import('@/lib/hr/employee-hr-advance');

    const result = await executeEmployeeDuesSettlement({
      empId: 3,
      amount: 500,
      expectedBalance: 500,
      payrollMonth: '2026-04',
      paymentMethodId: 2,
      payoutDate: '2026-04-15',
      idempotencyKey: 'test-settle-key-001',
      createdByUserId: 1,
      branchId: 1,
      businessDayId: 1,
    });

    expect(result.success).toBe(true);
    expect(result.cashMoveId).toBe(401);
    expect(result.ledgerEntryId).toBe(901);
    expect(result.previousMonthlyBalance).toBe(500);
    expect(result.settlementAmount).toBe(500);
    expect(result.newMonthlyBalance).toBe(0);
    expect(result.payrollMonth).toBe('2026-04');
    expect(ensureEmployeeAdvanceMapping).toHaveBeenCalled();
    expect(fakeCommit).toHaveBeenCalled();
    expect(fakeAllocateInvID).toHaveBeenCalled();
  });

  it('returns idempotent replay when settlement key already exists', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    txQueryResults = [
      { recordset: [{ LedgerEntryID: 901, CashMoveID: 401 }] },
      { recordset: [{ Balance: 0 }] },
    ];
    const { executeEmployeeDuesSettlement } =
      await import('@/lib/services/employeeLedgerDuesSettlementService');

    const result = await executeEmployeeDuesSettlement({
      empId: 3,
      amount: 500,
      expectedBalance: 500,
      payrollMonth: '2026-04',
      paymentMethodId: 2,
      payoutDate: '2026-04-15',
      idempotencyKey: 'test-settle-key-001',
      branchId: 1,
      businessDayId: 1,
    });

    expect(result.idempotentReplay).toBe(true);
    expect(result.cashMoveId).toBe(401);
    expect(result.ledgerEntryId).toBe(901);
    expect(fakeCommit).toHaveBeenCalled();
    expect(fakeAllocateInvID).not.toHaveBeenCalled();
  });

  it('rolls back when cash move insert fails', async () => {
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
          throw new Error('cash insert failed');
        }
        const res = txQueryResults[txQueryIdx] ?? { recordset: [], rowsAffected: [0] };
        txQueryIdx++;
        return res;
      }
    };

    txQueryResults = [
      { recordset: [] },
      { recordset: [{ Balance: 500 }] },
    ];

    const { executeEmployeeDuesSettlement, EmployeeLedgerDuesSettlementError } =
      await import('@/lib/services/employeeLedgerDuesSettlementService');

    await expect(executeEmployeeDuesSettlement({
      empId: 3,
      amount: 500,
      expectedBalance: 500,
      payrollMonth: '2026-04',
      paymentMethodId: 2,
      payoutDate: '2026-04-15',
      branchId: 1,
      businessDayId: 1,
    })).rejects.toBeInstanceOf(EmployeeLedgerDuesSettlementError);
    expect(fakeRollback).toHaveBeenCalled();
    expect(fakeCommit).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/hr/employee-ledger/payout (dues settlement)', () => {
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
        amount: 500,
        expectedBalance: 500,
        payrollMonth: '2026-04',
        confirmedLedgerBranchId: 1,
        paymentMethodId: 2,
        payoutDate: '2026-04-15',
      }),
    }));
    const data = await res.json();

    expect(res.status).toBe(503);
    expect(data.error).toContain('EMP_LEDGER_DUAL_WRITE_ENABLED');
  });

  it('rejects a ledger filter branch that is not the session operating branch', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    const { allocateInvID } = await import('@/lib/db');
    allocateInvID.mockClear();
    const { POST } = await import('@/app/api/admin/hr/employee-ledger/payout/route');
    const res = await POST(new NextRequest('http://localhost/api/admin/hr/employee-ledger/payout', {
      method: 'POST',
      body: JSON.stringify({
        empId: 3,
        amount: 500,
        expectedBalance: 500,
        payrollMonth: '2026-04',
        confirmedLedgerBranchId: 3,
        paymentMethodId: 2,
        payoutDate: '2026-04-15',
      }),
    }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(String(data.error)).toMatch(/التشغيلي/);
    expect(allocateInvID).not.toHaveBeenCalled();
  });
});

describe('getEmployeeMonthlyBranchBalance', () => {
  beforeEach(async () => {
    resetMocks();
    vi.resetModules();
  });

  it('computes scoped monthly balance for employee and branch', async () => {
    const { getPool } = await import('@/lib/db');
    (getPool as ReturnType<typeof vi.fn>).mockImplementation(async () => makeFakeDb([
      { recordset: [{ Balance: 250 }] },
    ]));
    const { getEmployeeMonthlyBranchBalance } = await import('@/lib/services/employeeLedgerService');

    const balance = await getEmployeeMonthlyBranchBalance(3, 1, '2026-04');
    expect(balance).toBe(250);
  });
});
