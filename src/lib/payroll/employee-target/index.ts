export type {
  CalculateDailyTargetOptions,
  DailyTargetBreakdownRow,
  DailyTargetCalculationResult,
  DailyTargetTier,
  TargetInputBasis,
  TargetTierInput,
} from './target.types';

export {
  EmployeeTargetValidationError,
  assertValidConversionDays,
  assertValidInputBasis,
  assertValidWorkDate,
  assertNonNegativeSales,
  normalizeTiersForCalculation,
  toDailyStartAmount,
} from './target.validation';

export { calculateDailyTarget } from './calculate-daily-target';

export {
  EMPLOYEE_TARGET_LINE_TOTAL_SQL,
  getEmployeeNetServiceSalesByDate,
  getEmployeesNetServiceSalesByDate,
  getEmployeesServiceCountsByDate,
  type EmployeeDayServiceCounts,
  type EmployeeNetServiceSalesRow,
} from './employee-target-sales-service';

export {
  convertInputTiersToDaily,
  type ConvertibleTierInput,
  type ConvertedTargetTier,
  type ConvertInputTiersParams,
} from './convert-target-tiers';

export {
  parseTargetPreviewBody,
  parseTargetSaveBody,
  type TargetPreviewBody,
  type TargetSaveBody,
} from './employee-target-plan.schemas';

export {
  getEmployeeTargetSettings,
  previewEmployeeTargetPlan,
  saveEmployeeTargetPlan,
  deleteEmployeeTargetPlan,
  EmployeeTargetConflictError,
} from './employee-target-plan.service';

export {
  getEmployeesTargetSummaryBatch,
  type EmployeeTargetSummaryRow,
} from './employee-target-plan.repository';

export {
  computeTargetPlanVersioning,
  addDaysIso,
  type PlanDateWindow,
  type VersioningDecision,
} from './target-plan-versioning';

export {
  parseDailyTargetGenerateBody,
  parseWorkDateQuery,
  deriveTargetDisplayStatus,
  type DailyTargetGenerateBody,
  type TargetPersistenceStatus,
  type TargetDisplayStatus,
  type TargetUpsertStatus,
} from './employee-daily-target.schemas';

export {
  generateEmployeeDailyTargets,
  EmployeeDailyTargetDomainError,
  EmployeeDailyTargetLedgerConflictError,
  resolveUniqueEffectivePlans,
  type GenerateEmployeeDailyTargetsParams,
  type GenerateEmployeeDailyTargetsResult,
  type GeneratedTargetEmployeeResult,
} from './employee-daily-target-generation.service';

export {
  getEmployeeDailyTargetsForDate,
  type DailyTargetDayQueryResult,
  type DailyTargetQueryEmployee,
} from './employee-daily-target-query.service';

export {
  syncEmployeeDailyTargetLedgerEntry,
} from './employee-daily-target-ledger-sync.service';

export {
  reconcileEmployeeDailyTargetLedger,
  getDailyTargetLedgerDetails,
  type TargetLedgerReconcileResult,
  type DailyTargetLedgerDetails,
} from './employee-daily-target-ledger-query.service';

export {
  parseTargetLedgerSyncBody,
  type TargetLedgerSyncBody,
  type TargetLedgerSyncAction,
  type TargetLedgerReconcileStatus,
} from './employee-daily-target-ledger.schemas';

export {
  EMP_LEDGER_REF_TYPE_DAILY_TARGET,
  EMP_LEDGER_REASON_TARGET,
  buildDailyTargetLedgerNote,
  payrollMonthFromWorkDate,
  roundLedgerAmount,
} from './employee-daily-target-ledger.constants';

export {
  buildCalculationBreakdownJson,
  CALCULATION_VERSION,
  moneyStr,
  amountStr,
} from './calculation-breakdown-json';

export {
  resolveInvoiceTargetRecalculationScope,
  extractInvoiceScopeSnapshot,
  dedupeTargetRecalcScopes,
  type TargetRecalcScope,
} from './employee-target-recalc-scope';

export {
  enqueueEmployeeTargetRecalculation,
  enqueueEmployeeTargetRecalculations,
  enqueueEmployeeTargetRecalculationsStandalone,
} from './employee-target-recalc-enqueue.service';

export {
  processEmployeeTargetRecalcRequests,
  enqueueAndMaybeProcessTargetRecalc,
  tryProcessEnqueuedTargetRecalcs,
  getTargetRecalcRequestsForApi,
} from './employee-target-recalc-process.service';

export {
  parseEnqueueRecalcBody,
  parseProcessRecalcBody,
  type TargetSyncStatus,
  type TargetRecalcRequestStatus,
} from './employee-target-recalc.schemas';

export {
  enqueueTargetRecalcFromInvoiceSnapshots,
  tryProcessAfterInvoiceCommit,
} from './employee-target-invoice-sync';

export { deriveTargetSyncStatus } from './employee-daily-target-query.service';
