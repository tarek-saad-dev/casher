/** Pure helpers for inter-branch employee settlement (no DB). */

export type BranchBalanceSnapshot = {
  branchId: number;
  branchCode: string;
  branchName: string;
  balance: number;
};

export type SettlementPair = {
  source: BranchBalanceSnapshot;
  dest: BranchBalanceSnapshot;
  maxAmount: number;
};

export function roundSettlementMoney(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Maximum settlement = min(positiveSource, abs(negativeDest)).
 */
export function computeMaxSettlementAmount(
  sourceBalance: number,
  destBalance: number,
): number {
  const src = roundSettlementMoney(sourceBalance);
  const dst = roundSettlementMoney(destBalance);
  if (src <= 0 || dst >= 0) return 0;
  return roundSettlementMoney(Math.min(src, Math.abs(dst)));
}

export function projectBalancesAfterSettlement(args: {
  sourceBalance: number;
  destBalance: number;
  amount: number;
}): {
  sourceAfter: number;
  destAfter: number;
  totalBefore: number;
  totalAfter: number;
} {
  const amount = roundSettlementMoney(args.amount);
  const sourceBefore = roundSettlementMoney(args.sourceBalance);
  const destBefore = roundSettlementMoney(args.destBalance);
  const totalBefore = roundSettlementMoney(sourceBefore + destBefore);
  const sourceAfter = roundSettlementMoney(sourceBefore - amount);
  const destAfter = roundSettlementMoney(destBefore + amount);
  const totalAfter = roundSettlementMoney(sourceAfter + destAfter);
  return { sourceAfter, destAfter, totalBefore, totalAfter };
}

/**
 * Find all (positive, negative) branch pairs that can settle.
 * Source = positive balance branch; Dest = negative balance branch.
 */
export function findSettleablePairs(
  branches: BranchBalanceSnapshot[],
): SettlementPair[] {
  const positives = branches.filter((b) => roundSettlementMoney(b.balance) > 0);
  const negatives = branches.filter((b) => roundSettlementMoney(b.balance) < 0);
  const pairs: SettlementPair[] = [];
  for (const source of positives) {
    for (const dest of negatives) {
      if (source.branchId === dest.branchId) continue;
      const maxAmount = computeMaxSettlementAmount(source.balance, dest.balance);
      if (maxAmount <= 0) continue;
      pairs.push({ source, dest, maxAmount });
    }
  }
  pairs.sort((a, b) => b.maxAmount - a.maxAmount);
  return pairs;
}

export function assertValidSettlementAmount(args: {
  amount: number;
  maxAmount: number;
  sourceBranchId: number;
  destBranchId: number;
}): void {
  if (args.sourceBranchId === args.destBranchId) {
    throw new Error('لا يمكن التسوية مع نفس الفرع');
  }
  const amount = roundSettlementMoney(args.amount);
  if (!(amount > 0)) {
    throw new Error('مبلغ التسوية يجب أن يكون أكبر من صفر');
  }
  const max = roundSettlementMoney(args.maxAmount);
  if (amount > max + 0.00001) {
    throw new Error(`مبلغ التسوية أكبر من المتاح (${max})`);
  }
}
