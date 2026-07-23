import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const ORIG_DUAL = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
const ORIG_DISABLE = process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH;

let fakeCommit = vi.fn();
let fakeRollback = vi.fn();
let txQueryResults: Array<{ recordset?: unknown[]; rowsAffected?: number[] }> = [];
let txQueryIdx = 0;
let poolQueryResults: Array<{ recordset: unknown[] }> = [];
let poolQueryIdx = 0;

function makeFakeDb() {
  poolQueryIdx = 0;
  return {
    request: vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn(async () => {
        const res = poolQueryResults[poolQueryIdx] ?? { recordset: [] };
        poolQueryIdx++;
        return res;
      }),
    })),
  };
}

const fakeGetPool = vi.fn(async () => makeFakeDb());

vi.mock('@/lib/db', () => ({
  getPool: () => fakeGetPool(),
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
  },
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
    day: { id: 1, branchId: 1, newDay: '2026-07-12', status: true },
  })),
}));

function resetMocks() {
  fakeCommit = vi.fn();
  fakeRollback = vi.fn();
  txQueryResults = [];
  txQueryIdx = 0;
  poolQueryResults = [];
  poolQueryIdx = 0;
  fakeGetPool.mockClear();
}

function pendingPayrollSetup() {
  poolQueryResults = [
    { recordset: [{ ExpINID: 99 }] },
    {
      recordset: [{
        ID: 1,
        EmpID: 7,
        EmpName: 'محمد',
        DailyWage: 400,
        Notes: null,
      }],
    },
    { recordset: [] },
    {
      recordset: [{
        EmpID: 7,
        EmpName: 'محمد',
        RevenueExpINID: 10,
        RevenueCatName: 'إيراد',
      }],
    },
    { recordset: [{ maxInvID: 1000 }] },
  ];
  txQueryResults = [
    { recordset: [] },
    { recordset: [{ ID: 5001 }] },
    { recordset: [] },
    { recordset: [{ ID: 5002 }] },
    { recordset: [], rowsAffected: [1] },
  ];
}

afterEach(() => {
  if (ORIG_DUAL === undefined) delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
  else process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = ORIG_DUAL;
  if (ORIG_DISABLE === undefined) delete process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH;
  else process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH = ORIG_DISABLE;
  resetMocks();
});

describe('POST /api/payroll/daily/post-to-cash', () => {
  beforeEach(() => {
    resetMocks();
    vi.resetModules();
  });

  async function loadPostHandler() {
    const mod = await import('@/app/api/payroll/daily/post-to-cash/route');
    return mod.POST;
  }

  it('rejects before DB when legacy post-to-cash is disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH = 'true';

    const POST = await loadPostHandler();
    const res = await POST(
      new NextRequest('http://localhost/api/payroll/daily/post-to-cash', {
        method: 'POST',
        body: JSON.stringify({ workDate: '2026-07-12' }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.success).toBe(false);
    expect(data.legacyPostToCashDisabled).toBe(true);
    expect(data.message).toContain('تم إيقاف ترحيل اليوميات القديم');
    expect(data.redirectTab).toBe('employee-ledger');
    expect(fakeGetPool).not.toHaveBeenCalled();
    expect(fakeCommit).not.toHaveBeenCalled();
  });

  it('proceeds when flags are off', async () => {
    delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
    delete process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH;
    pendingPayrollSetup();

    const POST = await loadPostHandler();
    const res = await POST(
      new NextRequest('http://localhost/api/payroll/daily/post-to-cash', {
        method: 'POST',
        body: JSON.stringify({ workDate: '2026-07-12' }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.postedCount).toBe(1);
    expect(fakeGetPool).toHaveBeenCalled();
    expect(fakeCommit).toHaveBeenCalled();
    expect(data.warning).toBeUndefined();
  });

  it('proceeds with warning when dual-write on but disable flag off', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    delete process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH;
    pendingPayrollSetup();

    const POST = await loadPostHandler();
    const res = await POST(
      new NextRequest('http://localhost/api/payroll/daily/post-to-cash', {
        method: 'POST',
        body: JSON.stringify({ workDate: '2026-07-12' }),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.warning).toContain('تحذير');
    expect(fakeCommit).toHaveBeenCalled();
  });

  it('does not commit when blocked', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
    process.env.EMP_LEDGER_DISABLE_LEGACY_POST_TO_CASH = 'true';

    const POST = await loadPostHandler();
    await POST(
      new NextRequest('http://localhost/api/payroll/daily/post-to-cash', {
        method: 'POST',
        body: JSON.stringify({ workDate: '2026-07-12' }),
      }),
    );

    expect(fakeCommit).not.toHaveBeenCalled();
    expect(fakeRollback).not.toHaveBeenCalled();
  });
});
