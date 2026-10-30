/**
 * Classification of money an employee has physically taken out
 * (advances + payouts) for a given month.
 *
 * Funding/revenue the employee brought in covers withdrawals first
 * (سلف قبل صرف المستحقات). After that:
 *  - remaining EntryReason=advance → سلفة (advanceExcess)
 *  - remaining EntryReason=payout  → صرف (payoutWithinDues)
 *
 * Advances are NEVER reclassified as «صرف» just because salary/target
 * dues exist — صرف only reflects real payout ledger rows.
 *
 * revenueWithdrawal + payoutWithinDues + advanceExcess === moneyTaken.
 */
export interface EmployeeWithdrawalBuckets {
  moneyTaken: number;
  payoutWithinDues: number;
  revenueWithdrawal: number;
  advanceExcess: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function computeEmployeeWithdrawalBuckets(params: {
  advanceDebits: number;
  payoutDebits: number;
  /** Kept for callers; dues no longer move advances into «صرف». */
  salaryAndTarget?: number;
  revenue: number;
}): EmployeeWithdrawalBuckets {
  const advance = Math.max(0, params.advanceDebits);
  const payout = Math.max(0, params.payoutDebits);
  const revenue = Math.max(0, params.revenue);
  const moneyTaken = round2(advance + payout);

  // Funding covers advances first, then real payouts.
  let fundingLeft = revenue;
  const advCoveredByFunding = round2(Math.min(advance, fundingLeft));
  fundingLeft = round2(Math.max(0, fundingLeft - advCoveredByFunding));
  const payCoveredByFunding = round2(Math.min(payout, fundingLeft));

  const revenueWithdrawal = round2(advCoveredByFunding + payCoveredByFunding);
  const advanceExcess = round2(advance - advCoveredByFunding);
  const payoutWithinDues = round2(payout - payCoveredByFunding);

  return { moneyTaken, payoutWithinDues, revenueWithdrawal, advanceExcess };
}

function partnersSettlementNet(params: {
  settlementCredits?: number;
  settlementDebits?: number;
}): number {
  return round2(
    Math.max(0, params.settlementCredits ?? 0) -
      Math.max(0, params.settlementDebits ?? 0),
  );
}

/**
 * Portion of uncovered cash draws (beyond salary+target+funding) that was
 * cleared by *net* incoming inter-branch settlement. Shown under «استلم راتب»
 * instead of «سلف» — no new cash payout; voided pairs net to ~0.
 */
export function computePartnersSettlementCoveredAsReceived(params: {
  advanceDebits: number;
  payoutDebits: number;
  salaryAndTarget: number;
  fundingCredits: number;
  settlementCredits?: number;
  settlementDebits?: number;
}): number {
  const taken =
    Math.max(0, params.advanceDebits) + Math.max(0, params.payoutDebits);
  const baseCovered =
    Math.max(0, params.fundingCredits) + Math.max(0, params.salaryAndTarget);
  const excessWithoutSettlement = round2(Math.max(0, taken - baseCovered));
  const settlementNet = Math.max(0, partnersSettlementNet(params));
  return round2(Math.min(excessWithoutSettlement, settlementNet));
}

/**
 * Partners-report «سلف»: remaining uncovered cash draws after salary+target+
 * funding and after net incoming inter-branch settlement.
 */
export function computePartnersAdvanceExcess(params: {
  advanceDebits: number;
  payoutDebits: number;
  salaryAndTarget: number;
  fundingCredits: number;
  /** Incoming inter-branch settlement credits for this branch/month. */
  settlementCredits?: number;
  /** Outgoing inter-branch settlement debits for this branch/month. */
  settlementDebits?: number;
}): number {
  const taken =
    Math.max(0, params.advanceDebits) + Math.max(0, params.payoutDebits);
  const covered =
    Math.max(0, params.fundingCredits) +
    Math.max(0, params.salaryAndTarget) +
    Math.max(0, partnersSettlementNet(params));
  return round2(Math.max(0, taken - covered));
}
