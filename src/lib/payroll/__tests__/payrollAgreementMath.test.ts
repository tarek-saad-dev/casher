import { describe, expect, it } from 'vitest';
import { prorateSalary, validateRetroInput } from '@/lib/payroll/payrollAgreementMath';

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
