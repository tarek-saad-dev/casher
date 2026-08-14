/**
 * Phase 6C — global employee payroll agreement precedence (pure).
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

vi.mock('server-only', () => ({}));

import {
  pickEffectivePayrollPlan,
  type BranchPayrollPlanRow,
} from '@/lib/payroll/branchPayrollPlan';
import { SQL_BRANCH_PAYROLL_PLAN_APPLY } from '@/lib/payroll/dailyPayrollHrRules';

const root = path.join(__dirname, '..', '..', '..');

function plan(
  over: Partial<BranchPayrollPlanRow> & Pick<BranchPayrollPlanRow, 'planId' | 'branchId'>,
): BranchPayrollPlanRow {
  return {
    empId: 99,
    payType: 'hourly',
    hourlyRate: 50,
    dailyRate: null,
    monthlySalary: null,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    isActive: true,
    ...over,
  };
}

describe('pickEffectivePayrollPlan (global agreement)', () => {
  it('explicit Camp override wins over GLEEM primary', () => {
    const chosen = pickEffectivePayrollPlan({
      branchId: 3,
      homeBranchIds: new Set([1]),
      candidates: [
        plan({ planId: 10, branchId: 1, hourlyRate: 40 }), // GLEEM primary
        plan({ planId: 20, branchId: 3, hourlyRate: 55 }), // Camp override
      ],
    });
    expect(chosen?.planId).toBe(20);
    expect(chosen?.hourlyRate).toBe(55);
    expect(chosen?.inheritedFromPrimary).toBe(false);
  });

  it('inherits GLEEM primary when Camp has no override', () => {
    const chosen = pickEffectivePayrollPlan({
      branchId: 3,
      homeBranchIds: new Set([1]),
      candidates: [plan({ planId: 10, branchId: 1, hourlyRate: 40 })],
    });
    expect(chosen?.planId).toBe(10);
    expect(chosen?.branchId).toBe(1);
    expect(chosen?.inheritedFromPrimary).toBe(true);
    expect(chosen?.hourlyRate).toBe(40);
  });

  it('prefers home branch when inheriting among multiple plans', () => {
    const chosen = pickEffectivePayrollPlan({
      branchId: 3,
      homeBranchIds: new Set([1]),
      candidates: [
        plan({ planId: 11, branchId: 2, hourlyRate: 30, effectiveFrom: '2026-02-01' }),
        plan({ planId: 10, branchId: 1, hourlyRate: 40, effectiveFrom: '2026-01-01' }),
      ],
    });
    expect(chosen?.branchId).toBe(1);
    expect(chosen?.inheritedFromPrimary).toBe(true);
  });

  it('returns null when no agreement exists → SALARY_CONFIG_MISSING path', () => {
    expect(
      pickEffectivePayrollPlan({
        branchId: 3,
        candidates: [],
      }),
    ).toBeNull();
  });
});

describe('SQL_BRANCH_PAYROLL_PLAN_APPLY inherit contract', () => {
  it('prefers working branch then home, never TblEmp columns', () => {
    expect(SQL_BRANCH_PAYROLL_PLAN_APPLY).toContain('bp0.BranchID = v.BranchID');
    expect(SQL_BRANCH_PAYROLL_PLAN_APPLY).toContain('IsHomeBranch');
    expect(SQL_BRANCH_PAYROLL_PLAN_APPLY).toContain('NOT EXISTS');
    expect(SQL_BRANCH_PAYROLL_PLAN_APPLY).not.toContain('ManualHourlyRate');
    expect(SQL_BRANCH_PAYROLL_PLAN_APPLY).not.toContain('e.HourlyRate');
  });

  it('contract doc documents global agreement precedence', () => {
    const doc = fs.readFileSync(
      path.join(root, 'docs/branch-phase-1l-payroll-plan-contract.md'),
      'utf8',
    );
    expect(doc).toContain('Primary / global employee agreement');
    expect(doc).toContain('Explicit EmpID + BranchID');
  });
});
