import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('server-only', () => ({}));

type QueryResult = { recordset?: unknown[]; rowsAffected?: number[] };

let queryPlan: QueryResult[] = [];
let queryIndex = 0;
const queryTexts: string[] = [];
let committed = false;
let rolledBack = false;

function resetState() {
  queryPlan = [];
  queryIndex = 0;
  queryTexts.length = 0;
  committed = false;
  rolledBack = false;
}

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({
    request: vi.fn(() => ({
      input: vi.fn().mockReturnThis(),
      query: vi.fn(async (sql: string) => {
        queryTexts.push(sql);
        const res = queryPlan[queryIndex] ?? { recordset: [], rowsAffected: [0] };
        queryIndex++;
        return res;
      }),
    })),
  })),
  sql: {
    Int: () => ({}),
    Date: () => ({}),
    Decimal: () => ({}),
    NVarChar: () => ({}),
    Request: class {
      input() { return this; }
      async query(sql: string) {
        queryTexts.push(sql);
        const res = queryPlan[queryIndex] ?? { recordset: [], rowsAffected: [0] };
        queryIndex++;
        return res;
      }
    },
    Transaction: class {
      async begin() {}
      async commit() { committed = true; }
      async rollback() { rolledBack = true; }
    },
    ISOLATION_LEVEL: { SERIALIZABLE: 0 },
  },
}));

vi.mock('@/lib/api-auth', () => ({
  requirePageAccess: vi.fn(async () => ({ ok: true, userId: 1 })),
  isAuthResult: vi.fn().mockReturnValue(true),
}));

describe('employee ledger sync service', () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  it('dryRun does not write rows', async () => {
    queryPlan = [
      { recordset: [{ payrollId: 1, empId: 3, empName: 'A', workDate: '2026-07-01', attendanceId: 10, dailyWage: 100 }] },
      { recordset: [] },
      { recordset: [] },
      { recordset: [] },
    ];
    const { runEmployeeLedgerHistoricalSync } = await import('@/lib/services/employeeLedgerSyncService');
    const res = await runEmployeeLedgerHistoricalSync({ month: '2026-07', dryRun: true });
    expect(res.success).toBe(true);
    expect(res.counts.payrollCreditsToInsert).toBe(1);
    expect(queryTexts.some((q) => q.includes('INSERT INTO dbo.TblEmpLedgerEntry'))).toBe(false);
  });

  it('generated payroll rows create hourly_wage inserts', async () => {
    queryPlan = [
      { recordset: [{ payrollId: 1, empId: 3, empName: 'A', workDate: '2026-07-01', attendanceId: 10, dailyWage: 100 }] },
      { recordset: [] },
    ];
    const { runEmployeeLedgerHistoricalSync } = await import('@/lib/services/employeeLedgerSyncService');
    const res = await runEmployeeLedgerHistoricalSync({ month: '2026-07', dryRun: false, syncAdvanceDebits: false });
    expect(res.counts.payrollCreditsToInsert).toBe(1);
    expect(committed).toBe(true);
  });

  it('advance cash moves create advance debits', async () => {
    queryPlan = [
      { recordset: [{ cashMoveId: 10, empId: 3, empName: 'A', invDate: '2026-07-02', amount: 50 }] },
      { recordset: [] },
    ];
    const { runEmployeeLedgerHistoricalSync } = await import('@/lib/services/employeeLedgerSyncService');
    const res = await runEmployeeLedgerHistoricalSync({ month: '2026-07', dryRun: false, syncPayrollCredits: false });
    expect(res.counts.advanceDebitsToInsert).toBe(1);
    expect(committed).toBe(true);
  });

  it('normal expenses and balancing income mirrors are ignored by advance filter', async () => {
    queryPlan = [
      { recordset: [] },
      { recordset: [] },
      { recordset: [] },
      { recordset: [] },
    ];
    const { runEmployeeLedgerHistoricalSync } = await import('@/lib/services/employeeLedgerSyncService');
    const res = await runEmployeeLedgerHistoricalSync({ month: '2026-07', dryRun: true, syncPayrollCredits: false });
    expect(res.counts.advanceDebitsToInsert).toBe(0);
  });

  it('running sync twice does not duplicate actions', async () => {
    queryPlan = [
      { recordset: [{ payrollId: 1, empId: 3, empName: 'A', workDate: '2026-07-01', attendanceId: 10, dailyWage: 100 }] },
      { recordset: [{ ID: 1, EmpID: 3, EntryDate: '2026-07-01', Amount: 100, PayrollMonth: '2026-07', AttendanceID: 10, CashMoveID: null, Notes: 'مزامنة استحقاق يومية من البيانات السابقة', IsVoided: 0, RefID: 1 }] },
      { recordset: [] },
      { recordset: [] },
    ];
    const { runEmployeeLedgerHistoricalSync } = await import('@/lib/services/employeeLedgerSyncService');
    const res = await runEmployeeLedgerHistoricalSync({ month: '2026-07', dryRun: true, syncAdvanceDebits: false });
    expect(res.counts.payrollCreditsToInsert).toBe(0);
    expect(res.counts.payrollCreditsToUpdate).toBe(0);
    expect(res.counts.skipped).toBeGreaterThan(0);
  });

  it('empId filter is applied', async () => {
    queryPlan = [
      { recordset: [] },
      { recordset: [] },
    ];
    const { runEmployeeLedgerHistoricalSync } = await import('@/lib/services/employeeLedgerSyncService');
    await runEmployeeLedgerHistoricalSync({ month: '2026-07', dryRun: true, empId: 5, syncAdvanceDebits: false });
    expect(queryTexts.some((q) => q.includes('AND p.EmpID = @empId'))).toBe(true);
  });

  it('transaction rolls back on failure', async () => {
    queryPlan = [
      { recordset: [{ payrollId: 1, empId: 3, empName: 'A', workDate: '2026-07-01', attendanceId: 10, dailyWage: 100 }] },
      { recordset: [] },
    ];
    const { sql } = await import('@/lib/db');
    (sql as any).Request = class {
      input() { return this; }
      async query(sqlText: string) {
        queryTexts.push(sqlText);
        if (sqlText.includes('INSERT INTO dbo.TblEmpLedgerEntry')) {
          throw new Error('insert failed');
        }
        const res = queryPlan[queryIndex] ?? { recordset: [], rowsAffected: [0] };
        queryIndex++;
        return res;
      }
    };
    const { runEmployeeLedgerHistoricalSync } = await import('@/lib/services/employeeLedgerSyncService');
    await expect(runEmployeeLedgerHistoricalSync({ month: '2026-07', dryRun: false, syncAdvanceDebits: false }))
      .rejects
      .toThrow('insert failed');
    expect(rolledBack).toBe(true);
  });
});

describe('POST /api/admin/hr/employee-ledger/sync', () => {
  beforeEach(() => {
    resetState();
    vi.resetModules();
  });

  it('returns sync result', async () => {
    vi.doMock('@/lib/services/employeeLedgerSyncService', () => ({
      runEmployeeLedgerHistoricalSync: vi.fn(async () => ({
        success: true,
        dryRun: true,
        month: '2026-07',
        empId: null,
        syncPayrollCredits: true,
        syncAdvanceDebits: true,
        counts: { payrollCreditsToInsert: 1, payrollCreditsToUpdate: 0, payrollCreditsToVoid: 0, advanceDebitsToInsert: 0, advanceDebitsToUpdate: 0, skipped: 0, errors: 0 },
        previewRows: [],
        errors: [],
      })),
    }));
    const { POST } = await import('@/app/api/admin/hr/employee-ledger/sync/route');
    const res = await POST(new NextRequest('http://localhost/api/admin/hr/employee-ledger/sync', {
      method: 'POST',
      body: JSON.stringify({ month: '2026-07' }),
    }));
    expect(res.status).toBe(200);
  });
});

