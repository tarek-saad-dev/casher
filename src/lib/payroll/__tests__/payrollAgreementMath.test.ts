import { describe, expect, it } from 'vitest';
import { calculateRetroBranchImpacts, prorateSalary, validateRetroInput } from '@/lib/payroll/payrollAgreementMath';

describe('Payroll Agreement V2 calendar proration',()=>{
  it('pays the full salary when effective on day one',()=>{
    expect(prorateSalary('2026-10-01',6000)).toEqual({days:31,monthDays:31,amount:6000});
  });
  it('prorates from an arbitrary mid-month agreement date',()=>{
    expect(prorateSalary('2026-10-15',6000)).toEqual({days:17,monthDays:31,amount:3290.32});
  });
  it('handles leap-year February',()=>{
    expect(prorateSalary('2024-02-15',2900)).toEqual({days:15,monthDays:29,amount:1500});
  });
  it('does not pay full monthly salary for just one day',()=>{
    expect(prorateSalary('2026-10-31',3100)).toEqual({days:1,monthDays:31,amount:100});
  });
});

describe('Payroll Agreement V2 validation',()=>{
  const base={effectiveFrom:'2026-10-01',reason:'اتفاق جديد من أول الشهر',
    branches:[{branchId:1,enabled:true,monthlySalary:6000},
              {branchId:2,enabled:true,monthlySalary:4000}]};
  it('accepts two independent branch salaries',()=>expect(()=>validateRetroInput(base)).not.toThrow());
  it('rejects invalid calendar dates',()=>expect(()=>validateRetroInput({...base,effectiveFrom:'2026-02-31'})).toThrow());
  it('rejects duplicate branches',()=>expect(()=>validateRetroInput({
    ...base,branches:[base.branches[0],base.branches[0]]
  })).toThrow());
  it('rejects non-positive salaries',()=>expect(()=>validateRetroInput({
    ...base,branches:[{branchId:1,enabled:true,monthlySalary:0}]
  })).toThrow());
  it('requires an audit reason',()=>expect(()=>validateRetroInput({...base,reason:'x'})).toThrow());
});

describe('Branch-scoped financial preview for October 2026', () => {
  const branches = [
    { branchId: 1, enabled: true, monthlySalary: 4000 },
    { branchId: 2, enabled: true, monthlySalary: 6000 },
    { branchId: 3, enabled: false, monthlySalary: 3000 },
  ];
  it('separately reconciles Ziad\'s actual branch wages and monthly entitlements', () => {
    const impacts = calculateRetroBranchImpacts('2026-10-01', branches, [
      { branchId: 1, amount: 2107.27, ledgerAmount: 2107.27 },
      { branchId: 2, amount: 2840, ledgerAmount: 2840 },
    ]);
    expect(impacts).toEqual([
      {
        branchId: 1, dailyCount: 1, oldWages: 2107.27,
        oldLedgerCredits: 2107.27, monthlySalary: 4000,
        newEntitlement: 4000, difference: 1892.73,
      },
      {
        branchId: 2, dailyCount: 1, oldWages: 2840,
        oldLedgerCredits: 2840, monthlySalary: 6000,
        newEntitlement: 6000, difference: 3160,
      },
    ]);
    expect(impacts.reduce((sum, row) => sum + row.difference, 0)).toBeCloseTo(5052.73, 2);
  });

  it('uses prorated days independently in each branch', () => {
    const impacts = calculateRetroBranchImpacts('2026-10-16', branches, []);
    expect(impacts.map(b => b.newEntitlement)).toEqual([2064.52, 3096.77]);
    expect(impacts.map(b => b.dailyCount)).toEqual([0, 0]);
  });
});
