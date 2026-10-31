export {
  resolveLateDeductionBracket,
  calculateLateDeductionAmount,
  dailyBasePayFromMonthlySalary,
  dailyBasePayFromHourly,
  thresholdsDueForLateMinutes,
  alertThresholdReached,
  isWorkDateEligibleForLateDeduction,
  LATE_DEDUCTION_MONTHLY_DIVISOR,
  LATE_ALERT_THRESHOLDS,
} from './rules';
export type { LateDeductionBracket, LateDeductionKind, LateAlertThreshold } from './rules';

export {
  getLateDeductionConfig,
  setLateDeductionEnabled,
} from './config';

export {
  finalizeLateDeductionOnCheckIn,
  scheduleFinalizeLateDeductionOnCheckIn,
} from './finalizeOnCheckIn';
export type {
  FinalizeLateDeductionInput,
  FinalizeLateDeductionResult,
} from './finalizeOnCheckIn';

export { enqueueLateDeductionFinalize } from './enqueueFinalize';
export { recoverPendingLateDeductionFinalizations } from './recoverFinalizations';
export { runLateDeductionAlertScan } from './alertScan';
export { isLateDeductionSchemaReady } from './schema';

export {
  listLateDeductionManagerQueue,
  applyManagerLatePenalty,
  cancelLateDeductionCase,
  setEmployeeLateDeductionExempt,
  LateDeductionActionError,
} from './managerActions';

export {
  buildLateAlertMessage,
  buildFinalDeductionMessage,
  buildExemptCheckInLateMessage,
  buildManagerDecisionEmployeeMessage,
  buildManagerReviewEmployeeAckMessage,
} from './messages';

export { LATE_DEDUCTION_REF_TYPE, LATE_DEDUCTION_ENTRY_REASON } from './constants';
