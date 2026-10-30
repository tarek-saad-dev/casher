import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

const originalFlag = process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;

let fakeCommit = vi.fn();
let fakeRollback = vi.fn();
let txQueryResults: Array<{ recordset?: unknown[]; rowsAffected?: number[] }> = [];
let txQueryIdx = 0;
let poolQueryResults: Array<{ recordset?: unknown[] }> = [];
let poolQueryIdx = 0;

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({
    request: () => ({
      input() {
        return this;
      },
      async query() {
        const res = poolQueryResults[poolQueryIdx] ?? { recordset: [] };
        poolQueryIdx++;
        return res;
      },
    }),
  })),
  sql: {
    Int: () => ({ type: 'int' }),
    Date: () => ({ type: 'date' }),
    Decimal: () => ({ type: 'decimal' }),
    NVarChar: (n: unknown) => ({ type: 'nvarchar', length: n }),
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

describe('employeeLedgerAdditionalTargetService', () => {
  beforeEach(() => {
    vi.resetModules();
    fakeCommit = vi.fn();
    fakeRollback = vi.fn();
    txQueryResults = [];
    txQueryIdx = 0;
    poolQueryResults = [];
    poolQueryIdx = 0;
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'true';
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.EMP_LEDGER_DUAL_WRITE_ENABLED;
    else process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = originalFlag;
  });

  it('buildAdditionalTargetNote includes date and optional notes', async () => {
    const mod = await import('@/lib/services/employeeLedgerAdditionalTargetService');
    expect(mod.buildAdditionalTargetNote('2026-10-30')).toBe('تارجت إضافي بتاريخ 2026-10-30');
    expect(mod.buildAdditionalTargetNote('2026-10-30', 'بونص رمضان')).toBe(
      'تارجت إضافي بتاريخ 2026-10-30 — بونص رمضان',
    );
  });

  it('previewAdditionalTarget returns day and month totals', async () => {
    poolQueryResults = [
      { recordset: [{ EmpID: 21, EmpName: 'هدى' }] },
      { recordset: [{ BranchID: 1, BranchCode: 'GLEEM', BranchName: 'جليم' }] },
      { recordset: [{ Total: 150 }] }, // day all
      { recordset: [{ Total: 100 }] }, // day earned
      { recordset: [{ Total: 50 }] }, // day additional
      { recordset: [{ Total: 800 }] }, // month all
    ];

    const { previewAdditionalTarget } = await import(
      '@/lib/services/employeeLedgerAdditionalTargetService'
    );
    const preview = await previewAdditionalTarget({
      empId: 21,
      branchId: 1,
      entryDate: '2026-10-30',
    });

    expect(preview.empName).toBe('هدى');
    expect(preview.branchCode).toBe('GLEEM');
    expect(preview.dayTargetTotal).toBe(150);
    expect(preview.dayTargetEarned).toBe(100);
    expect(preview.dayAdditionalTarget).toBe(50);
    expect(preview.monthTargetTotal).toBe(800);
  });

  it('postAdditionalTarget inserts bonus credit and returns projected totals', async () => {
    poolQueryResults = [
      { recordset: [{ EmpID: 21, EmpName: 'هدى' }] },
      { recordset: [{ BranchID: 1, BranchCode: 'GLEEM', BranchName: 'جليم' }] },
      { recordset: [{ Total: 150 }] },
      { recordset: [{ Total: 100 }] },
      { recordset: [{ Total: 50 }] },
      { recordset: [{ Total: 800 }] },
    ];
    txQueryResults = [{ recordset: [{ ID: 999 }] }];

    const { postAdditionalTarget } = await import(
      '@/lib/services/employeeLedgerAdditionalTargetService'
    );
    const result = await postAdditionalTarget({
      empId: 21,
      branchId: 1,
      entryDate: '2026-10-30',
      amount: 200,
      notes: 'بونص',
      createdByUserId: 10,
    });

    expect(fakeCommit).toHaveBeenCalled();
    expect(result.ledgerEntryId).toBe(999);
    expect(result.amountAdded).toBe(200);
    expect(result.previousDayTargetTotal).toBe(150);
    expect(result.newDayTargetTotal).toBe(350);
    expect(result.monthTargetTotalAfter).toBe(1000);
  });

  it('postAdditionalTarget rejects when dual-write disabled', async () => {
    process.env.EMP_LEDGER_DUAL_WRITE_ENABLED = 'false';
    const { postAdditionalTarget, EmployeeLedgerAdditionalTargetError } = await import(
      '@/lib/services/employeeLedgerAdditionalTargetService'
    );
    await expect(
      postAdditionalTarget({
        empId: 21,
        branchId: 1,
        entryDate: '2026-10-30',
        amount: 100,
      }),
    ).rejects.toBeInstanceOf(EmployeeLedgerAdditionalTargetError);
  });
});
