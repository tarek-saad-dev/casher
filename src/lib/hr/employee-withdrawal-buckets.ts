/**
 * Tiered classification of the money an employee has physically taken out
 * (advances + payouts) for a given month.
 *
 * The total withdrawn is covered in this order:
 *  1) سحب الايراد (revenueWithdrawal): first covered by the revenue/funding the
 *     employee brought to the shop. He is drawing against his own money — NOT a loan.
 *  2) صرف (payoutWithinDues): then covered by the employee's dues
 *     (salary + target). This is a legitimate disbursement of what he is owed.
 *  3) سلفة (advanceExcess): whatever remains after revenue + dues are exhausted.
 *     This is the real advance/loan recorded against the employee.
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
  salaryAndTarget: number;
  revenue: number;
}): EmployeeWithdrawalBuckets {
  const moneyTaken = round2(
    Math.max(0, params.advanceDebits) + Math.max(0, params.payoutDebits)
  );
  const dues = Math.max(0, params.salaryAndTarget);
  const revenue = Math.max(0, params.revenue);

  // 1) revenue/funding first, 2) then salary + target dues, 3) the rest is a loan.
  const revenueWithdrawal = round2(Math.min(moneyTaken, revenue));
  const afterRevenue = Math.max(0, moneyTaken - revenue);
  const payoutWithinDues = round2(Math.min(afterRevenue, dues));
  const advanceExcess = round2(Math.max(0, afterRevenue - dues));

  return { moneyTaken, payoutWithinDues, revenueWithdrawal, advanceExcess };
}
