import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  resolveUniqueEffectivePlans,
  EmployeeDailyTargetDomainError,
} from '@/lib/payroll/employee-target/effective-plan-resolve';
import { deriveTargetDisplayStatus } from '@/lib/payroll/employee-target/employee-daily-target.schemas';
import { buildCalculationBreakdownJson } from '@/lib/payroll/employee-target/calculation-breakdown-json';
import { calculateDailyTarget } from '@/lib/payroll/employee-target';
import { mergeDailyPayrollAndTargetRows } from '@/lib/payroll/employee-target/merge-daily-payroll-target-rows';
import type { EffectiveTargetPlanRow } from '@/lib/payroll/employee-target/employee-daily-target.repository';

function plan(partial: Partial<EffectiveTargetPlanRow> & { planId: number; empId: number }): EffectiveTargetPlanRow {
  return {
    empName: partial.empName ?? `E${partial.empId}`,
    isEnabled: true,
    inputBasis: 'daily',
    conversionDays: 26,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...partial,
  };
}

describe('resolveUniqueEffectivePlans', () => {
  it('keeps a covering enabled plan', () => {
    const map = resolveUniqueEffectivePlans([
      plan({ planId: 1, empId: 10, effectiveFrom: '2026-07-01' }),
    ]);
    expect(map.get(10)?.planId).toBe(1);
  });

  it('throws on multiple covering plans for same emp', () => {
    expect(() =>
      resolveUniqueEffectivePlans([
        plan({ planId: 1, empId: 10, effectiveFrom: '2026-01-01' }),
        plan({ planId: 2, empId: 10, effectiveFrom: '2026-06-01' }),
      ]),
    ).toThrow(EmployeeDailyTargetDomainError);
  });
});

describe('deriveTargetDisplayStatus', () => {
  it('no_sales / below_first_tier / earned_target', () => {
    expect(deriveTargetDisplayStatus(0, 0)).toBe('no_sales');
    expect(deriveTargetDisplayStatus(500, 0)).toBe('below_first_tier');
    expect(deriveTargetDisplayStatus(1500, 100)).toBe('earned_target');
  });
});

describe('buildCalculationBreakdownJson', () => {
  it('stores decimals as strings and includes plan snapshot', () => {
    const tiers = [
      { sortOrder: 1, inputStartAmount: 1000, dailyStartAmount: 1000, ratePercent: 20 },
    ];
    const calculation = calculateDailyTarget(1500, tiers);
    const json = buildCalculationBreakdownJson({
      workDate: '2026-07-15',
      targetPlanId: 12,
      inputBasis: 'daily',
      conversionDays: 26,
      tiers,
      calculation,
    });
    const parsed = JSON.parse(json);
    expect(parsed.calculationVersion).toBe('v1');
    expect(parsed.targetPlanId).toBe(12);
    expect(typeof parsed.netSalesAfterDiscount).toBe('string');
    expect(typeof parsed.targetAmount).toBe('string');
    expect(typeof parsed.tiers[0].dailyStartAmount).toBe('string');
    expect(typeof parsed.breakdown[0].eligibleAmount).toBe('string');
    expect(parsed.targetAmount).toBe('100.00');
  });
});

describe('calculateDailyTarget cases for generation readiness', () => {
  it('zero-start single tier', () => {
    const r = calculateDailyTarget(100, [
      { sortOrder: 1, inputStartAmount: 0, dailyStartAmount: 0, ratePercent: 10 },
    ]);
    expect(r.targetAmount).toBe(10);
  });

  it('exact boundary stays outside lower tier slice', () => {
    const r = calculateDailyTarget(1000, [
      { sortOrder: 1, inputStartAmount: 1000, dailyStartAmount: 1000, ratePercent: 20 },
    ]);
    expect(r.targetAmount).toBe(0);
  });

  it('multi tier progressive', () => {
    const r = calculateDailyTarget(1500, [
      { sortOrder: 1, inputStartAmount: 384.615384, dailyStartAmount: 384.615384, ratePercent: 10 },
      { sortOrder: 2, inputStartAmount: 1153.846154, dailyStartAmount: 1153.846154, ratePercent: 20 },
    ]);
    expect(r.targetAmount).toBe(146.15);
  });
});

describe('mergeDailyPayrollAndTargetRows', () => {
  it('merges payroll+target, payroll-only, target-only without CombinedPay', () => {
    const merged = mergeDailyPayrollAndTargetRows(
      [
        { EmpID: 1, EmpName: 'أحمد', DailyWage: 350, ActualHours: 8, AttendanceStatus: 'Present', Status: 'Generated' },
        { EmpID: 4, EmpName: 'علي', DailyWage: 300, ActualHours: 7, AttendanceStatus: 'Present', Status: 'Generated' },
      ],
      [
        {
          empId: 1,
          empName: 'أحمد',
          persistenceStatus: 'generated',
          displayStatus: 'earned_target',
          currentNetSalesAfterDiscount: '1500.00',
          storedNetSalesAfterDiscount: '1500.00',
          storedTargetAmount: '100.00',
          planSummary: 'فوق 1000 = 20%',
          targetPlanId: 1,
          tierCount: 1,
          firstDailyStartAmount: '1000.000000',
          firstRatePercent: '20.000000',
          generatedAt: 'x',
          updatedAt: null,
          previewTargetAmount: '100.00',
          previewBreakdown: [],
          tiers: [],
          inputBasis: 'daily',
          conversionDays: 26,
          planEffectiveFrom: '2026-01-01',
          planEffectiveTo: null,
          calculationBreakdownJson: null,
          dailyTargetId: 9,
          syncStatus: 'up_to_date',
        },
        {
          empId: 3,
          empName: 'كريم',
          persistenceStatus: 'not_generated',
          displayStatus: null,
          currentNetSalesAfterDiscount: '700.00',
          storedNetSalesAfterDiscount: null,
          storedTargetAmount: null,
          planSummary: 'فوق 1000 = 20%',
          targetPlanId: 2,
          tierCount: 1,
          firstDailyStartAmount: '1000.000000',
          firstRatePercent: '20.000000',
          generatedAt: null,
          updatedAt: null,
          previewTargetAmount: '0.00',
          previewBreakdown: [],
          tiers: [],
          inputBasis: 'daily',
          conversionDays: 26,
          planEffectiveFrom: '2026-01-01',
          planEffectiveTo: null,
          calculationBreakdownJson: null,
          dailyTargetId: null,
          syncStatus: 'pending',
        },
      ],
    );

    expect(merged).toHaveLength(3);
    const a = merged.find((m) => m.empId === 1)!;
    expect(a.dailyPay).toBe(350);
    expect(a.targetAmount).toBe('100.00');
    expect((a as { CombinedPay?: unknown }).CombinedPay).toBeUndefined();

    const ali = merged.find((m) => m.empId === 4)!;
    expect(ali.hasTargetPlan).toBe(false);
    expect(ali.targetAmount).toBeNull();

    const karim = merged.find((m) => m.empId === 3)!;
    expect(karim.payroll).toBeNull();
    expect(karim.hasTargetPlan).toBe(true);
    expect(karim.targetAmount).toBeNull(); // not generated
  });
});

// ── Generation service with mocked deps ─────────────────────────────────────

const listEnabledPlansCoveringDate = vi.fn();
const listTiersForPlanIds = vi.fn();
const upsertDailyTargetInTransaction = vi.fn();
const getEmployeesNetServiceSalesByDate = vi.fn();
const syncEmployeeDailyTargetLedgerEntry = vi.fn();
const fakeBegin = vi.fn();
const fakeCommit = vi.fn();
const fakeRollback = vi.fn();

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({})),
  sql: {
    Int: 'Int',
    Date: 'Date',
    Decimal: () => 'Decimal',
    NVarChar: () => 'NVarChar',
    Bit: 'Bit',
    MAX: -1,
    Transaction: class FakeTx {
      async begin() { fakeBegin(); }
      async commit() { fakeCommit(); }
      async rollback() { fakeRollback(); }
    },
    Request: class FakeRequest {
      input() { return this; }
      async query() { return { recordset: [] }; }
    },
  },
}));

vi.mock('@/lib/payroll/employee-target/employee-daily-target.repository', () => ({
  listEnabledPlansCoveringDate: (...a: unknown[]) => listEnabledPlansCoveringDate(...a),
  listTiersForPlanIds: (...a: unknown[]) => listTiersForPlanIds(...a),
  upsertDailyTargetInTransaction: (...a: unknown[]) => upsertDailyTargetInTransaction(...a),
  listDailyTargetsByWorkDate: vi.fn(async () => []),
}));

vi.mock('@/lib/payroll/employee-target/employee-target-sales-service', () => ({
  getEmployeesNetServiceSalesByDate: (...a: unknown[]) => getEmployeesNetServiceSalesByDate(...a),
  getEmployeeNetServiceSalesByDate: vi.fn(),
  EMPLOYEE_TARGET_LINE_TOTAL_SQL: '',
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

import { generateEmployeeDailyTargets } from '@/lib/payroll/employee-target/employee-daily-target-generation.service';

describe('generateEmployeeDailyTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    syncEmployeeDailyTargetLedgerEntry.mockResolvedValue({
      action: 'noop',
      ledgerEntryId: null,
      amount: 0,
    });
  });

  it('creates zero-sales row for plan holder without sales', async () => {
    listEnabledPlansCoveringDate.mockResolvedValue([
      plan({ planId: 5, empId: 11, empName: 'سارة', effectiveFrom: '2026-07-01' }),
    ]);
    listTiersForPlanIds.mockResolvedValue([
      { id: 1, targetPlanId: 5, inputStartAmount: 1000, dailyStartAmount: 1000, ratePercent: 20, sortOrder: 1 },
    ]);
    getEmployeesNetServiceSalesByDate.mockResolvedValue([]);
    upsertDailyTargetInTransaction.mockResolvedValue({
      id: 100,
      persistenceStatus: 'generated',
      generatedAt: '2026-07-15T10:00:00',
      updatedAt: null,
    });

    const result = await generateEmployeeDailyTargets({
      workDate: '2026-07-15',
      generatedByUserId: 1,
    });

    expect(result.totals.eligibleEmployees).toBe(1);
    expect(result.totals.zeroSales).toBe(1);
    expect(result.employees[0].targetAmount).toBe('0.00');
    expect(result.employees[0].persistenceStatus).toBe('generated');
    expect(fakeCommit).toHaveBeenCalled();
    expect(upsertDailyTargetInTransaction).toHaveBeenCalledTimes(1);
    expect(syncEmployeeDailyTargetLedgerEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        dailyTarget: expect.objectContaining({ id: 100, targetAmount: 0 }),
        actorUserId: 1,
      }),
    );
    const upsertArg = upsertDailyTargetInTransaction.mock.calls[0][1];
    expect(upsertArg.netSalesAfterDiscount).toBe(0);
    expect(upsertArg.targetAmount).toBe(0);
  });

  it('skips employees with sales but no plan', async () => {
    listEnabledPlansCoveringDate.mockResolvedValue([]);
    const result = await generateEmployeeDailyTargets({
      workDate: '2026-07-15',
      generatedByUserId: null,
    });
    expect(result.employees).toHaveLength(0);
    expect(getEmployeesNetServiceSalesByDate).not.toHaveBeenCalled();
    expect(upsertDailyTargetInTransaction).not.toHaveBeenCalled();
  });

  it('filters by empIds subset', async () => {
    listEnabledPlansCoveringDate.mockResolvedValue([
      plan({ planId: 1, empId: 10, empName: 'A' }),
    ]);
    listTiersForPlanIds.mockResolvedValue([
      { id: 1, targetPlanId: 1, inputStartAmount: 0, dailyStartAmount: 0, ratePercent: 10, sortOrder: 1 },
    ]);
    getEmployeesNetServiceSalesByDate.mockResolvedValue([
      { empId: 10, empName: 'A', netSalesAfterDiscount: 200, grossServiceRevenue: 200, allocatedInvoiceDiscount: 0, serviceCount: 1, invoiceCount: 1 },
    ]);
    upsertDailyTargetInTransaction.mockResolvedValue({
      id: 1, persistenceStatus: 'generated', generatedAt: 't', updatedAt: null,
    });

    await generateEmployeeDailyTargets({
      workDate: '2026-07-15',
      generatedByUserId: 1,
      empIds: [10],
    });
    expect(listEnabledPlansCoveringDate).toHaveBeenCalledWith('2026-07-15', [10]);
    expect(getEmployeesNetServiceSalesByDate).toHaveBeenCalledWith('2026-07-15', [10]);
  });

  it('rolls back when upsert fails', async () => {
    listEnabledPlansCoveringDate.mockResolvedValue([
      plan({ planId: 1, empId: 10 }),
    ]);
    listTiersForPlanIds.mockResolvedValue([
      { id: 1, targetPlanId: 1, inputStartAmount: 1000, dailyStartAmount: 1000, ratePercent: 20, sortOrder: 1 },
    ]);
    getEmployeesNetServiceSalesByDate.mockResolvedValue([]);
    upsertDailyTargetInTransaction.mockRejectedValue(new Error('db fail'));

    await expect(
      generateEmployeeDailyTargets({ workDate: '2026-07-15', generatedByUserId: 1 }),
    ).rejects.toThrow('db fail');
    expect(fakeRollback).toHaveBeenCalled();
    expect(fakeCommit).not.toHaveBeenCalled();
  });

  it('rolls back when ledger sync fails (same TX as target upsert)', async () => {
    listEnabledPlansCoveringDate.mockResolvedValue([
      plan({ planId: 1, empId: 10 }),
    ]);
    listTiersForPlanIds.mockResolvedValue([
      { id: 1, targetPlanId: 1, inputStartAmount: 1000, dailyStartAmount: 1000, ratePercent: 20, sortOrder: 1 },
    ]);
    getEmployeesNetServiceSalesByDate.mockResolvedValue([]);
    upsertDailyTargetInTransaction.mockResolvedValue({
      id: 9, persistenceStatus: 'generated', generatedAt: 't', updatedAt: null,
    });
    syncEmployeeDailyTargetLedgerEntry.mockRejectedValue(new Error('ledger fail'));

    await expect(
      generateEmployeeDailyTargets({ workDate: '2026-07-15', generatedByUserId: 1 }),
    ).rejects.toThrow('ledger fail');
    expect(fakeRollback).toHaveBeenCalled();
    expect(fakeCommit).not.toHaveBeenCalled();
  });

  it('second run marks recalculated', async () => {
    listEnabledPlansCoveringDate.mockResolvedValue([
      plan({ planId: 1, empId: 10 }),
    ]);
    listTiersForPlanIds.mockResolvedValue([
      { id: 1, targetPlanId: 1, inputStartAmount: 1000, dailyStartAmount: 1000, ratePercent: 20, sortOrder: 1 },
    ]);
    getEmployeesNetServiceSalesByDate.mockResolvedValue([
      { empId: 10, empName: 'A', netSalesAfterDiscount: 1500, grossServiceRevenue: 1500, allocatedInvoiceDiscount: 0, serviceCount: 1, invoiceCount: 1 },
    ]);
    upsertDailyTargetInTransaction.mockResolvedValue({
      id: 55, persistenceStatus: 'recalculated', generatedAt: 'old', updatedAt: 'new',
    });

    const result = await generateEmployeeDailyTargets({
      workDate: '2026-07-15',
      generatedByUserId: 1,
    });
    expect(result.totals.recalculated).toBe(1);
    expect(result.employees[0].targetAmount).toBe('100.00');
    expect(result.employees[0].displayStatus).toBe('earned_target');
  });

  it('rejects ambiguous overlapping plans', async () => {
    listEnabledPlansCoveringDate.mockResolvedValue([
      plan({ planId: 1, empId: 10, effectiveFrom: '2026-01-01' }),
      plan({ planId: 2, empId: 10, effectiveFrom: '2026-03-01' }),
    ]);
    await expect(
      generateEmployeeDailyTargets({ workDate: '2026-07-15', generatedByUserId: 1 }),
    ).rejects.toThrow(EmployeeDailyTargetDomainError);
    expect(upsertDailyTargetInTransaction).not.toHaveBeenCalled();
  });
});
