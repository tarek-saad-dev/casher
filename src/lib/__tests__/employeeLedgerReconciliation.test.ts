import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

function makeQueryRouter(handlers: Array<(sql: string) => unknown>) {
  let idx = 0;
  return vi.fn(async (sql: string) => {
    const handler = handlers[idx];
    idx++;
    if (handler) return handler(sql);
    return { recordset: [], rowsAffected: [0] };
  });
}

function makePool(queryFn: ReturnType<typeof vi.fn>) {
  return {
    request: vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query: queryFn,
    })),
  };
}

function baseAdvanceRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    cashMoveId: 88,
    expInId: 42,
    invDate: '2026-07-10',
    amount: 150,
    categoryName: 'سلف(احمد)',
    notes: null,
    cashEmpId: null,
    mapEmpId: 3,
    empName: 'أحمد',
    activeMapCount: 1,
    ledgerEntryId: null,
    ledgerAmount: null,
    ...overrides,
  };
}

describe('employeeLedgerReconciliation helpers', () => {
  it('counts reconciliation issues including advance diagnostics', async () => {
    const { buildReconciliationIssueCount } = await import('@/lib/services/employeeLedgerReconciliationService');
    expect(buildReconciliationIssueCount({
      missingPayrollCredits: [{}, {}],
      orphanLedgerCredits: [{}],
      missingAdvanceDebits: [],
      unresolvedCashAdvances: [{}],
      advanceAmountMismatches: [{}],
      advanceDiagnosticRows: [],
      missingPayoutDebits: [{}, {}, {}],
      payrollLedgerCreditDiff: 0,
      advanceLedgerDiff: 290,
      payoutLedgerDiff: 0,
    })).toBe(8);
  });

  it('adds unexplained advance diff when no detail rows exist', async () => {
    const { buildReconciliationIssueCount } = await import('@/lib/services/employeeLedgerReconciliationService');
    expect(buildReconciliationIssueCount({
      missingPayrollCredits: [],
      orphanLedgerCredits: [],
      missingAdvanceDebits: [],
      unresolvedCashAdvances: [],
      advanceAmountMismatches: [],
      advanceDiagnosticRows: [],
      missingPayoutDebits: [],
      payrollLedgerCreditDiff: 0,
      advanceLedgerDiff: 290,
      payoutLedgerDiff: 0,
    })).toBe(1);
  });

  it('detects legacy payroll columns when both exist', async () => {
    const { cashMoveHasLegacyPayrollColumns } = await import('@/lib/services/employeeLedgerReconciliationService');
    const pool = makePool(vi.fn(async () => ({ recordset: [{ cnt: 2 }] })));
    await expect(cashMoveHasLegacyPayrollColumns(pool as never)).resolves.toBe(true);
  });
});

describe('analyzeAdvanceReconciliation', () => {
  it('deduplicates cash totals and detects missing ledger rows', async () => {
    const { analyzeAdvanceReconciliation } = await import('@/lib/services/employeeLedgerReconciliationService');
    const result = analyzeAdvanceReconciliation(
      [baseAdvanceRow()],
      [],
      0,
    );

    expect(result.advanceCashMoveTotal).toBe(150);
    expect(result.resolvedCashAdvanceTotal).toBe(150);
    expect(result.advanceLedgerDiff).toBe(150);
    expect(result.missingAdvanceDebits).toHaveLength(1);
    expect(result.missingAdvanceDebits[0].issueReason).toBe('ledger_entry_missing');
  });

  it('detects unresolved cash advances without employee mapping', async () => {
    const { analyzeAdvanceReconciliation } = await import('@/lib/services/employeeLedgerReconciliationService');
    const result = analyzeAdvanceReconciliation(
      [baseAdvanceRow({ mapEmpId: null, empName: null, activeMapCount: 0, expInId: 99, cashEmpId: 5 })],
      [],
      0,
    );

    expect(result.unresolvedCashAdvanceTotal).toBe(150);
    expect(result.unresolvedCashAdvances).toHaveLength(1);
    expect(result.unresolvedCashAdvances[0].issueReason).toBe('no_emp_id');
    expect(result.unresolvedCashAdvances[0].expInId).toBe(99);
    expect(result.unresolvedCashAdvances[0].cashEmpId).toBe(5);
    expect(result.unresolvedCashAdvances[0].hasLedgerEntry).toBe(false);
    expect(result.missingAdvanceDebits).toHaveLength(0);
  });

  it('detects amount mismatch when ledger exists but totals differ', async () => {
    const { analyzeAdvanceReconciliation } = await import('@/lib/services/employeeLedgerReconciliationService');
    const result = analyzeAdvanceReconciliation(
      [baseAdvanceRow({ amount: 150, ledgerEntryId: 9, ledgerAmount: 120 })],
      [],
      120,
    );

    expect(result.advanceLedgerDiff).toBe(30);
    expect(result.missingAdvanceDebits).toHaveLength(0);
    expect(result.advanceAmountMismatches).toHaveLength(1);
    expect(result.advanceAmountMismatches[0].cashAmount).toBe(150);
    expect(result.advanceAmountMismatches[0].ledgerAmount).toBe(120);
  });

  it('includes ledgerEntryId on orphan diagnostic rows', async () => {
    const { analyzeAdvanceReconciliation } = await import('@/lib/services/employeeLedgerReconciliationService');
    const result = analyzeAdvanceReconciliation(
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

    expect(result.advanceDiagnosticRows).toHaveLength(1);
    expect(result.advanceDiagnosticRows[0].ledgerEntryId).toBe(23);
    expect(result.advanceDiagnosticRows[0].issueReason).toBe('orphan_ledger_debit');
  });

  it('adds diagnostic row when advance diff is not explained by detail rows', async () => {
    const { analyzeAdvanceReconciliation } = await import('@/lib/services/employeeLedgerReconciliationService');
    const result = analyzeAdvanceReconciliation(
      [baseAdvanceRow({ amount: 150, ledgerEntryId: 9, ledgerAmount: 150 })],
      [],
      120,
    );

    expect(result.advanceLedgerDiff).toBe(30);
    expect(result.advanceDiagnosticRows.some((row) => row.issueReason === 'unexplained_difference')).toBe(true);
  });
});

describe('getEmployeeLedgerReconciliation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns healthy empty state when everything matches', async () => {
    const query = makeQueryRouter([
      () => ({ recordset: [{ cnt: 2 }] }),
      () => ({ recordset: [{ TotalAmount: 500 }] }),
      () => ({ recordset: [{ TotalAmount: 500 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{ TotalAmount: 50 }] }),
      () => ({ recordset: [{ TotalAmount: 50 }] }),
      () => ({ recordset: [{ IncomeTotal: 200, ExpenseTotal: 200 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
    ]);

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makePool(query)),
      sql: {
        Int: () => ({}),
        Date: () => ({}),
        NVarChar: () => ({}),
        Request: class {},
      },
    }));

    const { getEmployeeLedgerReconciliation } = await import('@/lib/services/employeeLedgerReconciliationService');
    const result = await getEmployeeLedgerReconciliation('2026-04');

    expect(result.summary.payrollGeneratedTotal).toBe(500);
    expect(result.summary.issueCount).toBe(0);
    expect(result.summary.advanceLedgerDiff).toBe(0);
    expect(result.missingAdvanceDebits).toHaveLength(0);
  });

  it('detects missing ledger credit for payroll row', async () => {
    const query = makeQueryRouter([
      () => ({ recordset: [{ cnt: 0 }] }),
      () => ({ recordset: [{ TotalAmount: 300 }] }),
      () => ({ recordset: [{ TotalAmount: 100 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [{
        payrollId: 10,
        empId: 3,
        empName: 'أحمد',
        workDate: '2026-04-15',
        dailyWage: 200,
      }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
    ]);

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makePool(query)),
      sql: {
        Int: () => ({}),
        Date: () => ({}),
        NVarChar: () => ({}),
        Request: class {},
      },
    }));

    const { getEmployeeLedgerReconciliation } = await import('@/lib/services/employeeLedgerReconciliationService');
    const result = await getEmployeeLedgerReconciliation('2026-04');

    expect(result.summary.payrollLedgerCreditDiff).toBe(200);
    expect(result.summary.issueCount).toBe(1);
  });

  it('detects missing advance debit for advance cash move', async () => {
    const query = makeQueryRouter([
      () => ({ recordset: [{ cnt: 2 }] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [baseAdvanceRow()] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [{ IncomeTotal: 0, ExpenseTotal: 0 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
    ]);

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makePool(query)),
      sql: {
        Int: () => ({}),
        Date: () => ({}),
        NVarChar: () => ({}),
        Request: class {},
      },
    }));

    const { getEmployeeLedgerReconciliation } = await import('@/lib/services/employeeLedgerReconciliationService');
    const result = await getEmployeeLedgerReconciliation('2026-04');

    expect(result.summary.advanceCashMoveTotal).toBe(150);
    expect(result.summary.advanceLedgerDiff).toBe(150);
    expect(result.missingAdvanceDebits).toHaveLength(1);
    expect(result.summary.issueCount).toBeGreaterThan(0);
  });

  it('reports open issues when advance totals differ but all cash rows already have ledger entries', async () => {
    const query = makeQueryRouter([
      () => ({ recordset: [{ cnt: 2 }] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [baseAdvanceRow({ amount: 150, ledgerEntryId: 9, ledgerAmount: 120 })] }),
      () => ({ recordset: [{ TotalAmount: 120 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [{ IncomeTotal: 0, ExpenseTotal: 0 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
    ]);

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makePool(query)),
      sql: {
        Int: () => ({}),
        Date: () => ({}),
        NVarChar: () => ({}),
        Request: class {},
      },
    }));

    const { getEmployeeLedgerReconciliation } = await import('@/lib/services/employeeLedgerReconciliationService');
    const result = await getEmployeeLedgerReconciliation('2026-07');

    expect(result.summary.advanceLedgerDiff).toBe(30);
    expect(result.missingAdvanceDebits).toHaveLength(0);
    expect(result.advanceAmountMismatches).toHaveLength(1);
    expect(result.summary.issueCount).toBeGreaterThan(0);
  });

  it('reports legacy mirror grouped rows', async () => {
    const query = makeQueryRouter([
      () => ({ recordset: [{ cnt: 2 }] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [{ TotalAmount: 0 }] }),
      () => ({ recordset: [{ IncomeTotal: 120, ExpenseTotal: 120 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{
        invDate: '2026-04-12',
        empId: 3,
        empName: 'أحمد',
        incomeMirrorTotal: 120,
        expenseMirrorTotal: 120,
        totalRows: 2,
      }] }),
    ]);

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makePool(query)),
      sql: {
        Int: () => ({}),
        Date: () => ({}),
        NVarChar: () => ({}),
        Request: class {},
      },
    }));

    const { getEmployeeLedgerReconciliation } = await import('@/lib/services/employeeLedgerReconciliationService');
    const result = await getEmployeeLedgerReconciliation('2026-04');

    expect(result.legacyMirrorRows).toHaveLength(1);
    expect(result.legacyMirrorRows[0].rowCount).toBe(2);
  });
});

describe('GET /api/admin/hr/employee-ledger/reconciliation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 with healthy empty summary for month=2026-07', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      requirePageAccess: vi.fn(async () => ({ ok: true, userId: 1 })),
      isAuthResult: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('@/lib/services/employeeLedgerReconciliationService', () => ({
      getEmployeeLedgerReconciliation: vi.fn(async () => ({
        summary: {
          month: '2026-07',
          empId: null,
          payrollGeneratedTotal: 0,
          ledgerSalaryCreditsTotal: 0,
          payrollLedgerCreditDiff: 0,
          resolvedCashAdvanceTotal: 0,
          unresolvedCashAdvanceTotal: 0,
          advanceCashMoveTotal: 0,
          ledgerAdvanceDebitsTotal: 0,
          advanceLedgerDiff: 0,
          unresolvedCashAdvanceCount: 0,
          payoutCashMoveTotal: 0,
          ledgerPayoutDebitsTotal: 0,
          payoutLedgerDiff: 0,
          legacyPayrollIncomeMirrorTotal: 0,
          legacyPayrollExpenseMirrorTotal: 0,
          legacyColumnsAvailable: true,
          issueCount: 0,
        },
        missingPayrollCredits: [],
        orphanLedgerCredits: [],
        missingAdvanceDebits: [],
        unresolvedCashAdvances: [],
        advanceAmountMismatches: [],
        advanceDiagnosticRows: [],
        missingPayoutDebits: [],
        legacyMirrorRows: [],
      })),
    }));

    const { GET } = await import('@/app/api/admin/hr/employee-ledger/reconciliation/route');
    const res = await GET(new NextRequest('http://localhost/api/admin/hr/employee-ledger/reconciliation?month=2026-07'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.summary.issueCount).toBe(0);
  });
});
