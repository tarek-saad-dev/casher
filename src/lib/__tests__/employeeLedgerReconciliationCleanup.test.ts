import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

let fakeCommit = vi.fn();
let fakeRollback = vi.fn();
let poolQueryResults: Array<{ recordset?: unknown[]; rowsAffected?: number[] }> = [];
let poolQueryIdx = 0;
let txQueryResults: Array<{ recordset?: unknown[]; rowsAffected?: number[] }> = [];
let txQueryIdx = 0;
const executedSql: string[] = [];

function resetMocks() {
  fakeCommit = vi.fn();
  fakeRollback = vi.fn();
  poolQueryResults = [];
  poolQueryIdx = 0;
  txQueryResults = [];
  txQueryIdx = 0;
  executedSql.length = 0;
}

function makeFakePool() {
  return {
    request: vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn(async (sql: string) => {
        executedSql.push(sql);
        const res = poolQueryResults[poolQueryIdx] ?? { recordset: [], rowsAffected: [0] };
        poolQueryIdx++;
        return res;
      }),
    })),
  };
}

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => makeFakePool()),
  sql: {
    Int: () => ({ type: 'int' }),
    Date: () => ({ type: 'date' }),
    NVarChar: (n: unknown) => ({ type: 'nvarchar', length: n }),
    Request: class FakeRequest {
      input() {
        return this;
      }
      async query(sql: string) {
        executedSql.push(sql);
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

vi.mock('@/lib/api-auth', () => ({
  requirePageAccess: vi.fn(async () => ({ ok: true, userId: 1 })),
  isAuthResult: vi.fn().mockReturnValue(true),
}));

describe('employeeLedgerReconciliationCleanupService helpers', () => {
  beforeEach(() => {
    resetMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extractCategoryNameHints parses parenthetical employee names', async () => {
    const { extractCategoryNameHints } = await import('@/lib/services/employeeLedgerReconciliationCleanupService');
    const hints = extractCategoryNameHints('سلفه(احمد الموس)');
    expect(hints.some((h) => h.includes('احمد'))).toBe(true);
  });
});

describe('upsertAdvanceCategoryMapping', () => {
  beforeEach(() => {
    resetMocks();
    vi.resetModules();
  });

  it('upserts mapping without touching TblCashMove', async () => {
    txQueryResults = [
      { recordset: [{ ExpINID: 10, CatName: 'سلفه(احمد)' }] },
      { recordset: [{ EmpID: 3, EmpName: 'أحمد الموس' }] },
      { recordset: [], rowsAffected: [0] },
      { recordset: [] },
      { recordset: [], rowsAffected: [1] },
    ];

    const { upsertAdvanceCategoryMapping } = await import('@/lib/services/employeeLedgerReconciliationCleanupService');
    const result = await upsertAdvanceCategoryMapping(10, 3);

    expect(result.success).toBe(true);
    expect(result.expInId).toBe(10);
    expect(result.empId).toBe(3);
    expect(result.created).toBe(true);
    expect(fakeCommit).toHaveBeenCalled();
    expect(executedSql.some((sql) => sql.includes('TblExpCatEmpMap'))).toBe(true);
    expect(executedSql.some((sql) => sql.includes('TblCashMove'))).toBe(false);
  });

  it('reactivates existing inactive mapping', async () => {
    txQueryResults = [
      { recordset: [{ ExpINID: 10, CatName: 'سلف' }] },
      { recordset: [{ EmpID: 3, EmpName: 'أحمد' }] },
      { recordset: [], rowsAffected: [0] },
      { recordset: [{ ID: 5, IsActive: false }] },
      { recordset: [], rowsAffected: [1] },
    ];

    const { upsertAdvanceCategoryMapping } = await import('@/lib/services/employeeLedgerReconciliationCleanupService');
    const result = await upsertAdvanceCategoryMapping(10, 3);

    expect(result.created).toBe(false);
    expect(result.reactivated).toBe(true);
  });
});

describe('voidReconciliationLedgerEntry', () => {
  beforeEach(() => {
    resetMocks();
    vi.resetModules();
  });

  it('sets IsVoided instead of deleting', async () => {
    poolQueryResults = [
      {
        recordset: [{
          ID: 23,
          EntryReason: 'advance',
          RefType: 'TblCashMove',
          CashMoveID: 35345,
          IsVoided: false,
        }],
      },
      { recordset: [], rowsAffected: [1] },
    ];

    const { voidReconciliationLedgerEntry } = await import('@/lib/services/employeeLedgerReconciliationCleanupService');
    const result = await voidReconciliationLedgerEntry(23, 'تصنيف غير تابع لموظف');

    expect(result.success).toBe(true);
    expect(result.ledgerEntryId).toBe(23);
    expect(executedSql.some((sql) => sql.includes('IsVoided = 1'))).toBe(true);
    expect(executedSql.some((sql) => sql.toLowerCase().includes('delete'))).toBe(false);
  });

  it('rejects non-advance entries', async () => {
    poolQueryResults = [
      {
        recordset: [{
          ID: 23,
          EntryReason: 'hourly_wage',
          RefType: 'TblCashMove',
          CashMoveID: 35345,
          IsVoided: false,
        }],
      },
    ];

    const { voidReconciliationLedgerEntry, EmployeeLedgerCleanupError } =
      await import('@/lib/services/employeeLedgerReconciliationCleanupService');

    await expect(voidReconciliationLedgerEntry(23, 'test'))
      .rejects.toBeInstanceOf(EmployeeLedgerCleanupError);
  });

  it('rejects already voided entries', async () => {
    poolQueryResults = [
      {
        recordset: [{
          ID: 23,
          EntryReason: 'advance',
          RefType: 'TblCashMove',
          CashMoveID: 35345,
          IsVoided: true,
        }],
      },
    ];

    const { voidReconciliationLedgerEntry, EmployeeLedgerCleanupError } =
      await import('@/lib/services/employeeLedgerReconciliationCleanupService');

    await expect(voidReconciliationLedgerEntry(23, 'test'))
      .rejects.toBeInstanceOf(EmployeeLedgerCleanupError);
  });

  it('rejects entries without CashMoveID', async () => {
    poolQueryResults = [
      {
        recordset: [{
          ID: 23,
          EntryReason: 'advance',
          RefType: 'TblCashMove',
          CashMoveID: null,
          IsVoided: false,
        }],
      },
    ];

    const { voidReconciliationLedgerEntry, EmployeeLedgerCleanupError } =
      await import('@/lib/services/employeeLedgerReconciliationCleanupService');

    await expect(voidReconciliationLedgerEntry(23, 'test'))
      .rejects.toBeInstanceOf(EmployeeLedgerCleanupError);
  });
});

describe('cleanup API routes', () => {
  beforeEach(() => {
    resetMocks();
    vi.resetModules();
  });

  it('POST fix-advance-mapping validates txnKind', async () => {
    const { POST } = await import('@/app/api/admin/hr/employee-ledger/reconciliation/fix-advance-mapping/route');
    const res = await POST(new NextRequest('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ expInId: 10, empId: 3, txnKind: 'payout' }),
    }));
    expect(res.status).toBe(400);
  });

  it('POST void-entry requires reason', async () => {
    const { POST } = await import('@/app/api/admin/hr/employee-ledger/void-entry/route');
    const res = await POST(new NextRequest('http://localhost', {
      method: 'POST',
      body: JSON.stringify({ ledgerEntryId: 23, reason: '   ' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('reconciliation excludes voided orphan entries', () => {
  beforeEach(() => {
    resetMocks();
    vi.resetModules();
  });

  it('orphan fetch query filters IsVoided = 0', async () => {
    const { analyzeAdvanceReconciliation } = await import('@/lib/services/employeeLedgerReconciliationService');
    const result = analyzeAdvanceReconciliation([], [], 0);
    expect(result.advanceDiagnosticRows).toHaveLength(0);

    const withOrphan = analyzeAdvanceReconciliation(
      [],
      [{
        ledgerEntryId: 23,
        empId: 7,
        empName: 'CUT',
        entryDate: '2026-07-05',
        amount: 10,
        refId: 35345,
        cashMoveId: 35345,
      }],
      10,
    );
    expect(withOrphan.advanceDiagnosticRows).toHaveLength(1);
  });
});
