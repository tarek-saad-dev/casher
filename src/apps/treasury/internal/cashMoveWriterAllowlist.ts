/**
 * Grandfathered paths allowed to SQL-write TblCashMove directly outside Treasury internal.
 * Migrated flows (income/expense/transfer create) must use MoneyMovement port.
 */
export const CASH_MOVE_WRITER_ALLOWLIST = [
  // Treasury owns non-sale writes through internal insert helper
  'src/apps/treasury/internal/cashMoveInsert.ts',
  // POS sale trigger path — InsCashMoveSales; app may redistribute split payments
  'src/lib/splitPaymentService.ts',
  'src/lib/actions/invoiceActions.ts',
  // Deferred non-sale writers (DRVO-007 follow-ups)
  'src/app/api/payroll/daily/post-to-cash/route.ts',
  'src/app/api/deductions/route.ts',
  'src/lib/services/employeeTipService.ts',
  'src/lib/services/employeeLedgerFundingService.ts',
  'src/lib/services/employeeLedgerFundingSyncService.ts',
  'src/lib/services/employeeLedgerPayoutService.ts',
  'src/lib/actions/deductionSettlementPairing.ts',
  'src/lib/actions/incomeActions.ts',
  'src/lib/actions/expenseActions.ts',
  'src/lib/services/cashMoveHardDeleteService.ts',
  'src/lib/actions/cashMoveActions.ts',
  'src/app/api/incomes/bulk-update/route.ts',
] as const;

export const CASH_MOVE_MUTATION_PATTERN =
  /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\[dbo\]\.)?\[?TblCashMove\]?/i;
