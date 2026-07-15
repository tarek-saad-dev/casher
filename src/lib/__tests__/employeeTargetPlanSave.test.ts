import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const listPlansForEmployee = vi.fn();
const getEmployeeBasic = vi.fn();
const closePlanEffectiveTo = vi.fn();
const insertPlanWithTiers = vi.fn();
const replacePlanTiersInTransaction = vi.fn();
const getPlanWithTiers = vi.fn();
const countDailyTargetsForPlan = vi.fn();
const deletePlanInTransaction = vi.fn();

const fakeRollback = vi.fn();
const fakeCommit = vi.fn();
const fakeBegin = vi.fn();

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => ({})),
  sql: {
    Int: 'Int',
    Bit: 'Bit',
    Date: 'Date',
    Decimal: () => 'Decimal',
    NVarChar: () => 'NVarChar',
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

vi.mock('@/lib/payroll/employee-target/employee-target-plan.repository', () => ({
  listPlansForEmployee: (...a: unknown[]) => listPlansForEmployee(...a),
  getEmployeeBasic: (...a: unknown[]) => getEmployeeBasic(...a),
  closePlanEffectiveTo: (...a: unknown[]) => closePlanEffectiveTo(...a),
  insertPlanWithTiers: (...a: unknown[]) => insertPlanWithTiers(...a),
  replacePlanTiersInTransaction: (...a: unknown[]) => replacePlanTiersInTransaction(...a),
  getPlanWithTiers: (...a: unknown[]) => getPlanWithTiers(...a),
  countDailyTargetsForPlan: (...a: unknown[]) => countDailyTargetsForPlan(...a),
  deletePlanInTransaction: (...a: unknown[]) => deletePlanInTransaction(...a),
  listTiersForPlans: vi.fn(async () => []),
}));

import { saveEmployeeTargetPlan } from '@/lib/payroll/employee-target/employee-target-plan.service';

describe('saveEmployeeTargetPlan transaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEmployeeBasic.mockResolvedValue({ EmpID: 1, EmpName: 'Test', isActive: true });
    listPlansForEmployee.mockResolvedValue([]);
    countDailyTargetsForPlan.mockResolvedValue(0);
    deletePlanInTransaction.mockResolvedValue(undefined);
  });

  it('rolls back when insert fails', async () => {
    insertPlanWithTiers.mockRejectedValue(new Error('insert failed'));

    await expect(
      saveEmployeeTargetPlan(
        1,
        {
          isEnabled: true,
          inputBasis: 'daily',
          conversionDays: 26,
          effectiveFrom: '2026-07-14',
          tiers: [{ inputStartAmount: 1000, ratePercent: 20 }],
        },
        7,
      ),
    ).rejects.toThrow('insert failed');

    expect(fakeBegin).toHaveBeenCalled();
    expect(fakeRollback).toHaveBeenCalled();
    expect(fakeCommit).not.toHaveBeenCalled();
  });

  it('saves disabled plan without tiers', async () => {
    insertPlanWithTiers.mockResolvedValue(42);
    getPlanWithTiers.mockResolvedValue({
      id: 42,
      empId: 1,
      isEnabled: false,
      inputBasis: 'monthly',
      conversionDays: 26,
      effectiveFrom: '2026-07-14',
      effectiveTo: null,
      notes: null,
      createdByUserId: 7,
      updatedByUserId: null,
      createdAt: null,
      updatedAt: null,
      tiers: [],
    });

    const saved = await saveEmployeeTargetPlan(
      1,
      {
        isEnabled: false,
        inputBasis: 'monthly',
        conversionDays: 26,
        effectiveFrom: '2026-07-14',
        tiers: [],
      },
      7,
    );

    expect(fakeCommit).toHaveBeenCalled();
    expect(saved.isEnabled).toBe(false);
    expect(saved.tiers).toEqual([]);
  });

  it('closes prior plan inside transaction', async () => {
    listPlansForEmployee.mockResolvedValue([
      {
        id: 11,
        empId: 1,
        isEnabled: true,
        inputBasis: 'daily',
        conversionDays: 26,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        notes: null,
        createdByUserId: null,
        updatedByUserId: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    insertPlanWithTiers.mockResolvedValue(12);
    getPlanWithTiers.mockResolvedValue({
      id: 12,
      empId: 1,
      isEnabled: true,
      inputBasis: 'daily',
      conversionDays: 26,
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      notes: null,
      createdByUserId: 7,
      updatedByUserId: null,
      createdAt: null,
      updatedAt: null,
      tiers: [
        {
          id: 1,
          targetPlanId: 12,
          inputStartAmount: 1000,
          dailyStartAmount: 1000,
          ratePercent: 20,
          sortOrder: 1,
        },
      ],
    });

    await saveEmployeeTargetPlan(
      1,
      {
        isEnabled: true,
        inputBasis: 'daily',
        conversionDays: 26,
        effectiveFrom: '2026-07-01',
        tiers: [{ inputStartAmount: 1000, ratePercent: 20 }],
      },
      7,
    );

    expect(closePlanEffectiveTo).toHaveBeenCalledWith(
      expect.anything(),
      11,
      '2026-06-30',
      7,
    );
    expect(fakeCommit).toHaveBeenCalled();
  });

  it('same EffectiveFrom replaces plan in place (no insert)', async () => {
    listPlansForEmployee.mockResolvedValue([
      {
        id: 40,
        empId: 1,
        isEnabled: false,
        inputBasis: 'daily',
        conversionDays: 26,
        effectiveFrom: '2026-07-14',
        effectiveTo: null,
        notes: null,
        createdByUserId: null,
        updatedByUserId: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    replacePlanTiersInTransaction.mockResolvedValue(undefined);
    getPlanWithTiers.mockResolvedValue({
      id: 40,
      empId: 1,
      isEnabled: true,
      inputBasis: 'daily',
      conversionDays: 26,
      effectiveFrom: '2026-07-14',
      effectiveTo: null,
      notes: null,
      createdByUserId: null,
      updatedByUserId: 7,
      createdAt: null,
      updatedAt: 'now',
      tiers: [
        {
          id: 2,
          targetPlanId: 40,
          inputStartAmount: 1000,
          dailyStartAmount: 1000,
          ratePercent: 20,
          sortOrder: 1,
        },
      ],
    });

    const saved = await saveEmployeeTargetPlan(
      1,
      {
        isEnabled: true,
        inputBasis: 'daily',
        conversionDays: 26,
        effectiveFrom: '2026-07-14',
        tiers: [{ inputStartAmount: 1000, ratePercent: 20 }],
      },
      7,
    );

    expect(replacePlanTiersInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        planId: 40,
        isEnabled: true,
        effectiveFrom: '2026-07-14',
      }),
    );
    expect(insertPlanWithTiers).not.toHaveBeenCalled();
    expect(closePlanEffectiveTo).not.toHaveBeenCalled();
    expect(saved.id).toBe(40);
    expect(saved.isEnabled).toBe(true);
    expect(fakeCommit).toHaveBeenCalled();
  });

  it('mid-month save consolidates same-month plan onto day 1', async () => {
    listPlansForEmployee.mockResolvedValue([
      {
        id: 50,
        empId: 1,
        isEnabled: true,
        inputBasis: 'daily',
        conversionDays: 26,
        effectiveFrom: '2026-07-15',
        effectiveTo: null,
        notes: null,
        createdByUserId: null,
        updatedByUserId: null,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    replacePlanTiersInTransaction.mockResolvedValue(undefined);
    getPlanWithTiers.mockResolvedValue({
      id: 50,
      empId: 1,
      isEnabled: true,
      inputBasis: 'daily',
      conversionDays: 26,
      effectiveFrom: '2026-07-01',
      effectiveTo: null,
      notes: null,
      createdByUserId: null,
      updatedByUserId: 7,
      createdAt: null,
      updatedAt: 'now',
      tiers: [
        {
          id: 3,
          targetPlanId: 50,
          inputStartAmount: 1000,
          dailyStartAmount: 1000,
          ratePercent: 20,
          sortOrder: 1,
        },
      ],
    });

    await saveEmployeeTargetPlan(
      1,
      {
        isEnabled: true,
        inputBasis: 'daily',
        conversionDays: 26,
        effectiveFrom: '2026-07-01',
        tiers: [{ inputStartAmount: 1000, ratePercent: 20 }],
      },
      7,
    );

    expect(insertPlanWithTiers).not.toHaveBeenCalled();
    expect(replacePlanTiersInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        planId: 50,
        effectiveFrom: '2026-07-01',
        effectiveTo: null,
      }),
    );
    expect(fakeCommit).toHaveBeenCalled();
  });
});
