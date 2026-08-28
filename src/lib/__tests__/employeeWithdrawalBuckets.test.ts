import { describe, expect, it } from 'vitest';
import {
  computeEmployeeWithdrawalBuckets,
  computePartnersAdvanceExcess,
} from '@/lib/hr/employee-withdrawal-buckets';

describe('computeEmployeeWithdrawalBuckets', () => {
  it('keeps advances in سلفة even when salary dues cover them', () => {
    // هدى: salary 145.31, advances 310 — must NOT show 145.31 as صرف
    const b = computeEmployeeWithdrawalBuckets({
      advanceDebits: 310,
      payoutDebits: 0,
      salaryAndTarget: 145.31,
      revenue: 0,
    });
    expect(b.payoutWithinDues).toBe(0);
    expect(b.advanceExcess).toBe(310);
    expect(b.revenueWithdrawal).toBe(0);
    expect(b.moneyTaken).toBe(310);
  });

  it('keeps يوسف advances as سلفة when salary exists', () => {
    const b = computeEmployeeWithdrawalBuckets({
      advanceDebits: 300,
      payoutDebits: 0,
      salaryAndTarget: 203.33,
      revenue: 0,
    });
    expect(b.payoutWithinDues).toBe(0);
    expect(b.advanceExcess).toBe(300);
  });

  it('applies funding to advances first (سحب ايراد), remainder stays سلفة', () => {
    const b = computeEmployeeWithdrawalBuckets({
      advanceDebits: 200,
      payoutDebits: 0,
      salaryAndTarget: 500,
      revenue: 50,
    });
    expect(b.revenueWithdrawal).toBe(50);
    expect(b.advanceExcess).toBe(150);
    expect(b.payoutWithinDues).toBe(0);
  });

  it('shows real payouts in صرف only', () => {
    const b = computeEmployeeWithdrawalBuckets({
      advanceDebits: 100,
      payoutDebits: 80,
      salaryAndTarget: 1000,
      revenue: 0,
    });
    expect(b.advanceExcess).toBe(100);
    expect(b.payoutWithinDues).toBe(80);
    expect(b.moneyTaken).toBe(180);
  });

  it('funding covers advances before payouts', () => {
    const b = computeEmployeeWithdrawalBuckets({
      advanceDebits: 40,
      payoutDebits: 60,
      revenue: 50,
    });
    expect(b.revenueWithdrawal).toBe(50); // 40 adv + 10 pay
    expect(b.advanceExcess).toBe(0);
    expect(b.payoutWithinDues).toBe(50);
  });

  it('invariant: buckets sum to moneyTaken', () => {
    const b = computeEmployeeWithdrawalBuckets({
      advanceDebits: 310,
      payoutDebits: 90,
      salaryAndTarget: 200,
      revenue: 50,
    });
    expect(
      Math.round((b.revenueWithdrawal + b.payoutWithinDues + b.advanceExcess) * 100) / 100,
    ).toBe(b.moneyTaken);
  });
});

describe('computePartnersAdvanceExcess', () => {
  it('does not double-count informal salary draws after daily payroll exists', () => {
    // زياد جليم أغسطس: سلف خزنة 14245 − تمويل 390 − راتب+تارجت 11735.47
    expect(
      computePartnersAdvanceExcess({
        advanceDebits: 14245,
        payoutDebits: 0,
        salaryAndTarget: 11735.47,
        fundingCredits: 390,
      }),
    ).toBe(2119.53);
  });

  it('keeps full cash as سلف when no salary/target accrued', () => {
    expect(
      computePartnersAdvanceExcess({
        advanceDebits: 14245,
        payoutDebits: 0,
        salaryAndTarget: 0,
        fundingCredits: 390,
      }),
    ).toBe(13855);
  });

  it('is zero when dues cover all cash taken', () => {
    expect(
      computePartnersAdvanceExcess({
        advanceDebits: 800,
        payoutDebits: 200,
        salaryAndTarget: 900,
        fundingCredits: 200,
      }),
    ).toBe(0);
  });
});
