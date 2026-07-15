import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const listDailyTargetsForLedgerScope = vi.fn();
const listTargetLedgerEntriesForScope = vi.fn();
const listOrphanTargetLedgerEntries = vi.fn();
const syncEmployeeDailyTargetLedgerEntry = vi.fn();

const fakeBegin = vi.fn();
const fakeCommit = vi.fn();
const fakeRollback = vi.fn();

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({})),
  sql: {
    Transaction: class FakeTx {
      async begin() {
        fakeBegin();
      }
      async commit() {
        fakeCommit();
      }
      async rollback() {
        fakeRollback();
      }
    },
  },
}));

vi.mock('@/lib/payroll/employee-target/employee-daily-target-ledger.repository', () => ({
  listDailyTargetsForLedgerScope: (...a: unknown[]) => listDailyTargetsForLedgerScope(...a),
  listTargetLedgerEntriesForScope: (...a: unknown[]) => listTargetLedgerEntriesForScope(...a),
  listOrphanTargetLedgerEntries: (...a: unknown[]) => listOrphanTargetLedgerEntries(...a),
  getDailyTargetById: vi.fn(),
  getTargetPlanMeta: vi.fn(),
  listTiersSnapshotForPlan: vi.fn(),
}));

vi.mock('@/lib/payroll/employee-target/employee-daily-target-ledger-sync.service', () => ({
  syncEmployeeDailyTargetLedgerEntry: (...a: unknown[]) => syncEmployeeDailyTargetLedgerEntry(...a),
  EmployeeDailyTargetLedgerConflictError: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'EmployeeDailyTargetLedgerConflictError';
    }
  },
}));

import { reconcileEmployeeDailyTargetLedger } from '@/lib/payroll/employee-target/employee-daily-target-ledger-query.service';
import { buildDailyTargetLedgerNote } from '@/lib/payroll/employee-target/employee-daily-target-ledger.constants';

function daily(overrides: Record<string, unknown> = {}) {
  return {
    id: 25,
    empId: 12,
    workDate: '2026-07-15',
    targetPlanId: 1,
    netSalesAfterDiscount: 5000,
    targetAmount: 100,
    calculationBreakdownJson: '{}',
    calculationVersion: 'v1',
    status: 'generated' as const,
    generatedByUserId: 1,
    generatedAt: 'now',
    updatedAt: null,
    ...overrides,
  };
}

function ledger(overrides: Record<string, unknown> = {}) {
  return {
    id: 99,
    empId: 12,
    entryDate: '2026-07-15',
    entryDirection: 'credit',
    entryReason: 'target',
    amount: 100,
    payrollMonth: '2026-07',
    refType: 'TblEmpDailyTarget',
    refId: 25,
    cashMoveId: null,
    notes: buildDailyTargetLedgerNote('2026-07-15'),
    isVoided: false,
    createdByUserId: 1,
    createdAt: 'now',
    updatedAt: null,
    ...overrides,
  };
}

describe('reconcileEmployeeDailyTargetLedger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listOrphanTargetLedgerEntries.mockResolvedValue([]);
  });

  it('marks matched', async () => {
    listDailyTargetsForLedgerScope.mockResolvedValue([daily()]);
    listTargetLedgerEntriesForScope.mockResolvedValue([ledger()]);

    const r = await reconcileEmployeeDailyTargetLedger(
      { workDate: '2026-07-15', dryRun: true },
      1,
    );

    expect(r.totals.matched).toBe(1);
    expect(r.totals.missing).toBe(0);
    expect(fakeBegin).not.toHaveBeenCalled();
  });

  it('detects missing ledger', async () => {
    listDailyTargetsForLedgerScope.mockResolvedValue([daily()]);
    listTargetLedgerEntriesForScope.mockResolvedValue([]);

    const r = await reconcileEmployeeDailyTargetLedger(
      { workDate: '2026-07-15', dryRun: true },
      1,
    );
    expect(r.rows[0]?.status).toBe('missing_ledger_entry');
    expect(r.totals.repairable).toBe(1);
  });

  it('detects amount mismatch', async () => {
    listDailyTargetsForLedgerScope.mockResolvedValue([daily({ targetAmount: 80 })]);
    listTargetLedgerEntriesForScope.mockResolvedValue([ledger({ amount: 100 })]);

    const r = await reconcileEmployeeDailyTargetLedger(
      { workDate: '2026-07-15', dryRun: true },
      1,
    );
    expect(r.rows[0]?.status).toBe('amount_mismatch');
  });

  it('detects wrong employee / date / direction / duplicate / zero extra / orphan', async () => {
    listDailyTargetsForLedgerScope.mockResolvedValue([
      daily({ id: 1, targetAmount: 100 }),
      daily({ id: 2, targetAmount: 100, empId: 12 }),
      daily({ id: 3, targetAmount: 100 }),
      daily({ id: 4, targetAmount: 100 }),
      daily({ id: 5, targetAmount: 0 }),
    ]);
    listTargetLedgerEntriesForScope.mockResolvedValue([
      ledger({ id: 1, refId: 1, empId: 99 }),
      ledger({ id: 2, refId: 2, entryDate: '2026-07-01' }),
      ledger({ id: 3, refId: 3, entryDirection: 'debit' }),
      ledger({ id: 4, refId: 4 }),
      ledger({ id: 5, refId: 4, amount: 50 }),
      ledger({ id: 6, refId: 5, amount: 10 }),
    ]);
    listOrphanTargetLedgerEntries.mockResolvedValue([
      ledger({ id: 900, refId: 999 }),
    ]);

    const r = await reconcileEmployeeDailyTargetLedger(
      { workDate: '2026-07-15', dryRun: true },
      1,
    );
    const statuses = r.rows.map((x) => x.status);
    expect(statuses).toContain('employee_mismatch');
    expect(statuses).toContain('date_mismatch');
    expect(statuses).toContain('wrong_direction');
    expect(statuses).toContain('duplicate_ledger_entries');
    expect(statuses).toContain('extra_ledger_entry_for_zero_target');
    expect(statuses).toContain('orphan_target_ledger_entry');
  });

  it('repair inserts missing and does not silent-fix duplicates', async () => {
    listDailyTargetsForLedgerScope.mockResolvedValue([
      daily({ id: 10, targetAmount: 50 }),
      daily({ id: 11, targetAmount: 50 }),
    ]);
    listTargetLedgerEntriesForScope.mockResolvedValue([
      ledger({ id: 1, refId: 11 }),
      ledger({ id: 2, refId: 11, amount: 40 }),
    ]);
    syncEmployeeDailyTargetLedgerEntry.mockResolvedValue({
      action: 'inserted',
      ledgerEntryId: 55,
      amount: 50,
    });

    const r = await reconcileEmployeeDailyTargetLedger(
      { workDate: '2026-07-15', dryRun: false },
      1,
    );

    expect(fakeBegin).toHaveBeenCalled();
    expect(fakeCommit).toHaveBeenCalled();
    expect(syncEmployeeDailyTargetLedgerEntry).toHaveBeenCalledTimes(1);
    expect(r.repair.inserted).toBe(1);
    expect(r.repair.skippedConflicts).toBeGreaterThanOrEqual(1);
  });

  it('repair deletes zero-target extras', async () => {
    listDailyTargetsForLedgerScope.mockResolvedValue([daily({ targetAmount: 0 })]);
    listTargetLedgerEntriesForScope.mockResolvedValue([ledger({ amount: 40 })]);
    syncEmployeeDailyTargetLedgerEntry.mockResolvedValue({
      action: 'deleted',
      ledgerEntryId: null,
      amount: 0,
    });

    const r = await reconcileEmployeeDailyTargetLedger(
      { workDate: '2026-07-15', dryRun: false },
      1,
    );
    expect(r.repair.deleted).toBe(1);
  });
});
