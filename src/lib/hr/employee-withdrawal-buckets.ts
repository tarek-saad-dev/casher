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

/**
 * Partners-report «سلف»: cash the shop already paid out beyond
 * accrued salary+target+funding. Using ledger advanceExcess as-is would
 * double-count informal salary draws (recorded as سلفة) after daily payroll exists.
 */
export function computePartnersAdvanceExcess(params: {
  advanceDebits: number;
  payoutDebits: number;
  salaryAndTarget: number;
  fundingCredits: number;
}): number {
  const taken =
    Math.max(0, params.advanceDebits) + Math.max(0, params.payoutDebits);
  const covered =
    Math.max(0, params.fundingCredits) + Math.max(0, params.salaryAndTarget);
  return round2(Math.max(0, taken - covered));
}
