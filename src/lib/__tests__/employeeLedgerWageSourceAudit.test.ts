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

describe('employeeLedgerWageSourceAudit helpers', () => {
  it('suggests TblEmpDailyPayroll when generated payroll total exists', async () => {
    const { resolveWageSourceSuggestion } = await import('@/lib/services/employeeLedgerWageSourceAuditService');
    expect(resolveWageSourceSuggestion({
      dailyPayrollGeneratedTotal: 100,
      cashWageExpenseTotal: 50,
    })).toBe('TblEmpDailyPayroll');
  });

  it('suggests LegacyCashMove when only cash wage expenses exist', async () => {
    const { resolveWageSourceSuggestion } = await import('@/lib/services/employeeLedgerWageSourceAuditService');
    expect(resolveWageSourceSuggestion({
      dailyPayrollGeneratedTotal: 0,
      cashWageExpenseTotal: 200,
    })).toBe('LegacyCashMove');
  });

  it('suggests NoneFound when no sources exist', async () => {
    const { resolveWageSourceSuggestion } = await import('@/lib/services/employeeLedgerWageSourceAuditService');
    expect(resolveWageSourceSuggestion({
      dailyPayrollGeneratedTotal: 0,
      cashWageExpenseTotal: 0,
    })).toBe('NoneFound');
  });
});

describe('getEmployeeLedgerWageSourceAudit', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finds generated payroll totals by status without writing data', async () => {
    const executedSql: string[] = [];
    const query = vi.fn(async (sql: string) => {
      executedSql.push(sql);
      const idx = executedSql.length - 1;
      const handlers = [
        () => ({ recordset: [{ cnt: 2 }] }),
        () => ({ recordset: [{ payrollStatus: 'Generated', totalRows: 2, dailyWageTotal: 300 }] }),
        () => ({ recordset: [{ empId: 3, empName: 'أحمد', totalRows: 2, dailyWageTotal: 300 }] }),
        () => ({ recordset: [{ totalRows: 2, dailyWageTotal: 300 }] }),
        () => ({ recordset: [] }),
        () => ({ recordset: [] }),
        () => ({ recordset: [] }),
      ];
      const handler = handlers[idx];
      return handler ? handler() : { recordset: [] };
    });

    vi.doMock('@/lib/db', () => ({
      getPool: vi.fn(async () => makePool(query)),
      sql: {
        Int: () => ({}),
        Date: () => ({}),
        NVarChar: () => ({}),
        Request: class {},
      },
    }));

    const { getEmployeeLedgerWageSourceAudit } = await import('@/lib/services/employeeLedgerWageSourceAuditService');
    const result = await getEmployeeLedgerWageSourceAudit('2026-07');

    expect(result.readOnly).toBe(true);
    expect(result.dailyPayrollGeneratedTotal).toBe(300);
    expect(result.dailyPayroll.byStatus).toEqual([
      { status: 'Generated', rowCount: 2, dailyWageTotal: 300 },
    ]);
    expect(result.suggestedSource).toBe('TblEmpDailyPayroll');
    expect(executedSql.some((sql) => sql.includes('GROUP BY p.Status'))).toBe(true);
    expect(executedSql.join('\n')).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it('finds likely wage expense cash rows', async () => {
    const query = makeQueryRouter([
      () => ({ recordset: [{ cnt: 2 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{ totalRows: 0, dailyWageTotal: 0 }] }),
      () => ({ recordset: [{
        cashMoveId: 501,
        invDate: '2026-07-10',
        amount: 150,
        categoryName: 'يوميات الموظفين',
        empId: 3,
        empName: 'أحمد',
        notes: 'يومية موظف',
        paymentMethod: 'كاش',
        isPayrollDeduction: 1,
        matchReason: 'legacy_payroll_deduction_flag',
      }] }),
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

    const { getEmployeeLedgerWageSourceAudit } = await import('@/lib/services/employeeLedgerWageSourceAuditService');
    const result = await getEmployeeLedgerWageSourceAudit('2026-07');

    expect(result.cashWageExpenseTotal).toBe(150);
    expect(result.cashWageExpenses).toHaveLength(1);
    expect(result.cashWageExpenses[0].cashMoveId).toBe(501);
    expect(result.suggestedSource).toBe('LegacyCashMove');
  });

  it('finds possible income mirror rows and matches nearby wage expense', async () => {
    const query = makeQueryRouter([
      () => ({ recordset: [{ cnt: 2 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{ totalRows: 0, dailyWageTotal: 0 }] }),
      () => ({ recordset: [{
        cashMoveId: 501,
        invDate: '2026-07-10',
        amount: 150,
        categoryName: 'يوميات الموظفين',
        empId: 3,
        empName: 'أحمد',
        notes: null,
        paymentMethod: 'كاش',
        isPayrollDeduction: 1,
        matchReason: 'legacy_payroll_deduction_flag',
      }] }),
      () => ({ recordset: [{
        cashMoveId: 502,
        invDate: '2026-07-10',
        amount: 150,
        categoryName: 'إيراد أحمد',
        empId: 3,
        empName: 'أحمد',
        notes: null,
        paymentMethod: 'كاش',
        isEmployeePayrollIncome: 1,
        mappedTxnKind: 'revenue',
        matchReason: 'legacy_payroll_income_flag',
      }] }),
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

    const { getEmployeeLedgerWageSourceAudit } = await import('@/lib/services/employeeLedgerWageSourceAuditService');
    const result = await getEmployeeLedgerWageSourceAudit('2026-07');

    expect(result.possibleIncomeMirrorTotal).toBe(150);
    expect(result.incomeMirrors).toHaveLength(1);
    expect(result.incomeMirrors[0].matchedExpenseCashMoveId).toBe(501);
  });

  it('returns healthy empty summary without errors', async () => {
    const query = makeQueryRouter([
      () => ({ recordset: [{ cnt: 2 }] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [] }),
      () => ({ recordset: [{ totalRows: 0, dailyWageTotal: 0 }] }),
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

    const { getEmployeeLedgerWageSourceAudit } = await import('@/lib/services/employeeLedgerWageSourceAuditService');
    const result = await getEmployeeLedgerWageSourceAudit('2026-07');

    expect(result.suggestedSource).toBe('NoneFound');
    expect(result.ledgerSalaryCreditTotal).toBe(0);
    expect(result.dailyPayroll.totalRowCount).toBe(0);
  });
});

describe('GET /api/admin/hr/employee-ledger/wage-source-audit', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 200 for month=2026-07', async () => {
    vi.doMock('@/lib/api-auth', () => ({
      requirePageAccess: vi.fn(async () => ({ ok: true, userId: 1 })),
      isAuthResult: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('@/lib/services/employeeLedgerWageSourceAuditService', () => ({
      getEmployeeLedgerWageSourceAudit: vi.fn(async () => ({
        month: '2026-07',
        empId: null,
        readOnly: true,
        dailyPayrollGeneratedTotal: 0,
        cashWageExpenseTotal: 0,
        possibleIncomeMirrorTotal: 0,
        ledgerSalaryCreditTotal: 0,
        suggestedSource: 'NoneFound',
        dailyPayroll: {
          totalRowCount: 0,
          dailyWageTotal: 0,
          generatedStatusTotal: 0,
          byStatus: [],
          byEmployee: [],
        },
        cashWageExpenses: [],
        incomeMirrors: [],
        ledgerSalaryCredits: { totalAmount: 0, entryCount: 0, byEmployee: [] },
      })),
    }));

    const { GET } = await import('@/app/api/admin/hr/employee-ledger/wage-source-audit/route');
    const res = await GET(new NextRequest('http://localhost/api/admin/hr/employee-ledger/wage-source-audit?month=2026-07'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.month).toBe('2026-07');
    expect(data.readOnly).toBe(true);
    expect(data.suggestedSource).toBe('NoneFound');
  });
});
