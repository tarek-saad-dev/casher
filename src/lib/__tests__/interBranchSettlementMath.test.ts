import { describe, expect, it } from 'vitest';
import {
  assertValidSettlementAmount,
  computeMaxSettlementAmount,
  findSettleablePairs,
  projectBalancesAfterSettlement,
  type BranchBalanceSnapshot,
} from '@/lib/hr/interBranchSettlementMath';

describe('interBranchSettlementMath', () => {
  it('A +500 / B -200 → settle 200 → A +300 / B 0 / Total +300', () => {
    expect(computeMaxSettlementAmount(500, -200)).toBe(200);
    const p = projectBalancesAfterSettlement({
      sourceBalance: 500,
      destBalance: -200,
      amount: 200,
    });
    expect(p.sourceAfter).toBe(300);
    expect(p.destAfter).toBe(0);
    expect(p.totalBefore).toBe(300);
    expect(p.totalAfter).toBe(300);
  });

  it('A +100 / B -300 → settle 100 → A 0 / B -200 / Total -200', () => {
    expect(computeMaxSettlementAmount(100, -300)).toBe(100);
    const p = projectBalancesAfterSettlement({
      sourceBalance: 100,
      destBalance: -300,
      amount: 100,
    });
    expect(p.sourceAfter).toBe(0);
    expect(p.destAfter).toBe(-200);
    expect(p.totalBefore).toBe(-200);
    expect(p.totalAfter).toBe(-200);
  });

  it('A +500 / B -200 partial 50 → A +450 / B -150 / Total +300', () => {
    const p = projectBalancesAfterSettlement({
      sourceBalance: 500,
      destBalance: -200,
      amount: 50,
    });
    expect(p.sourceAfter).toBe(450);
    expect(p.destAfter).toBe(-150);
    expect(p.totalBefore).toBe(300);
    expect(p.totalAfter).toBe(300);
  });

  it('rejects same branch, zero, over-max', () => {
    expect(() =>
      assertValidSettlementAmount({
        amount: 10,
        maxAmount: 10,
        sourceBranchId: 1,
        destBranchId: 1,
      }),
    ).toThrow(/نفس الفرع/);
    expect(() =>
      assertValidSettlementAmount({
        amount: 0,
        maxAmount: 10,
        sourceBranchId: 1,
        destBranchId: 2,
      }),
    ).toThrow(/أكبر من صفر/);
    expect(() =>
      assertValidSettlementAmount({
        amount: 201,
        maxAmount: 200,
        sourceBranchId: 1,
        destBranchId: 2,
      }),
    ).toThrow(/أكبر من المتاح/);
  });

  it('findSettleablePairs only opposite-sign pairs', () => {
    const branches: BranchBalanceSnapshot[] = [
      { branchId: 1, branchCode: 'GLEEM', branchName: 'جليم', balance: 500 },
      { branchId: 2, branchCode: 'CAMP_CAESAR', branchName: 'كامب', balance: -200 },
      { branchId: 3, branchCode: 'X', branchName: 'X', balance: 0 },
    ];
    const pairs = findSettleablePairs(branches);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].source.branchId).toBe(1);
    expect(pairs[0].dest.branchId).toBe(2);
    expect(pairs[0].maxAmount).toBe(200);
  });

  it('max is 0 when signs are not opposite', () => {
    expect(computeMaxSettlementAmount(100, 50)).toBe(0);
    expect(computeMaxSettlementAmount(-100, -50)).toBe(0);
    expect(computeMaxSettlementAmount(-100, 50)).toBe(0);
  });
});
