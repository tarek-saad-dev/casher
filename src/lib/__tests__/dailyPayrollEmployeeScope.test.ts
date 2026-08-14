import { describe, expect, it } from 'vitest';
import { parseDailyPayrollEmployeeScope } from '@/lib/payroll/dailyPayrollEmployeeScope.shared';
import {
  detectSameDayMultiBranchEmployees,
  mergeDailyPayrollAndTargetRows,
} from '@/lib/payroll/employee-target/merge-daily-payroll-target-rows';

describe('parseDailyPayrollEmployeeScope', () => {
  it('defaults omitted to active (session branch)', () => {
    expect(parseDailyPayrollEmployeeScope(null)).toBe('active');
    expect(parseDailyPayrollEmployeeScope('')).toBe('active');
  });

  it('parses all / GLEEM / CAMP', () => {
    expect(parseDailyPayrollEmployeeScope('all')).toBe('all');
    expect(parseDailyPayrollEmployeeScope('GLEEM')).toBe('GLEEM');
    expect(parseDailyPayrollEmployeeScope('camp_caesar')).toBe('CAMP_CAESAR');
    expect(parseDailyPayrollEmployeeScope('CAMP')).toBe('CAMP_CAESAR');
  });
});

describe('mergeDailyPayrollAndTargetRows multi-branch', () => {
  const targetBase = {
    persistenceStatus: 'generated' as const,
    displayStatus: 'earned_target' as const,
    currentNetSalesAfterDiscount: '100.00',
    storedNetSalesAfterDiscount: '100.00',
    storedTargetAmount: '10.00',
    planSummary: 'x',
    targetPlanId: 1,
    tierCount: 1,
    firstDailyStartAmount: '1',
    firstRatePercent: '10',
    generatedAt: 'x',
    updatedAt: null,
    previewTargetAmount: '10.00',
    previewBreakdown: [],
    tiers: [],
    inputBasis: 'daily',
    conversionDays: 26,
    planEffectiveFrom: '2026-01-01',
    planEffectiveTo: null,
    calculationBreakdownJson: null,
    dailyTargetId: 1,
    syncStatus: 'up_to_date' as const,
  };

  it('keeps separate rows per BranchID for same EmpID', () => {
    const merged = mergeDailyPayrollAndTargetRows(
      [
        {
          EmpID: 7,
          EmpName: 'أحمد',
          BranchID: 3,
          BranchCode: 'CAMP_CAESAR',
          BranchName: 'كامب شيزار',
          DailyWage: 200,
        },
        {
          EmpID: 7,
          EmpName: 'أحمد',
          BranchID: 1,
          BranchCode: 'GLEEM',
          BranchName: 'جليم',
          DailyWage: 300,
        },
      ],
      [
        { ...targetBase, empId: 7, empName: 'أحمد', branchId: 3, branchCode: 'CAMP_CAESAR' },
        { ...targetBase, empId: 7, empName: 'أحمد', branchId: 1, branchCode: 'GLEEM', storedTargetAmount: '20.00' },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged.every((m) => m.sameDayMultiBranch)).toBe(true);
    const camp = merged.find((m) => m.branchCode === 'CAMP_CAESAR')!;
    const gleem = merged.find((m) => m.branchCode === 'GLEEM')!;
    expect(camp.dailyPay).toBe(200);
    expect(camp.targetAmount).toBe('10.00');
    expect(gleem.dailyPay).toBe(300);
    expect(gleem.targetAmount).toBe('20.00');
  });

  it('detectSameDayMultiBranchEmployees flags EmpID across branches', () => {
    const flags = detectSameDayMultiBranchEmployees([
      { empId: 7, empName: 'أحمد', branchId: 1 },
      { empId: 7, empName: 'أحمد', branchId: 3 },
      { empId: 2, empName: 'زياد', branchId: 1 },
    ]);
    expect(flags).toEqual([{ empId: 7, empName: 'أحمد', branchIds: [1, 3] }]);
  });
});
