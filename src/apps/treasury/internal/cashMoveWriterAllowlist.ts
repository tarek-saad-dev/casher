/**
 * Grandfathered paths allowed to SQL-write TblCashMove directly outside Treasury internal.
 * Migrated flows (income/expense/transfer create) must use MoneyMovement port.
 */
export const CASH_MOVE_WRITER_ALLOWLIST = [
  // Treasury owns non-sale writes through internal insert helper
  'src/apps/treasury/internal/cashMoveInsert.ts',
  // DRVO-009 Treasury-owned POS sale initial CashMove
  'src/apps/treasury/internal/postSaleCashMove.ts',
  // POS sale trigger path — InsCashMoveSales; app may redistribute split payments
  'src/lib/splitPaymentService.ts',
  // Legacy sale update/delete still writes CashMove while rollout stays legacy.
  'src/lib/actions/invoiceActions.ts',
  // Extracted POS update/delete CashMove seam. Create still uses InsCashMoveSales.
  'src/apps/pos/internal/legacySaleRepository.ts',
  // Deferred non-sale writers (DRVO-007 follow-ups)
  'src/app/api/payroll/daily/post-to-cash/route.ts',
  'src/app/api/deductions/route.ts',
  'src/lib/services/employeeTipService.ts',
  'src/lib/services/employeeLedgerFundingService.ts',
  'src/lib/services/employeeLedgerFundingSyncService.ts',
  'src/lib/services/employeeLedgerPayoutService.ts',
  // HR monthly dues settlement: one Treasury cash-out paired atomically with employee advance ledger debit
  'src/lib/services/employeeLedgerDuesSettlementService.ts',
  'src/lib/actions/deductionSettlementPairing.ts',
  'src/lib/actions/incomeActions.ts',
  'src/lib/actions/expenseActions.ts',
  'src/lib/services/cashMoveHardDeleteService.ts',
  'src/lib/actions/cashMoveActions.ts',
  'src/app/api/incomes/bulk-update/route.ts',
] as const;

export const CASH_MOVE_MUTATION_PATTERN =
  /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(\[dbo\]\.)?\[?TblCashMove\]?/i;
