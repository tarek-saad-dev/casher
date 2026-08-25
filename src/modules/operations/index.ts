import 'server-only';

export {
  BusinessClock,
  now,
  parseBusinessCutoffHour,
  resolveBusinessClock,
  resolveBusinessDate,
  resolveCutoffTime,
  resolveTimeZone,
  getBranchLocalClockParts,
  isPastRolloverWindow,
  resolveRolloverLocalTime,
  DEFAULT_ROLLOVER_LOCAL_TIME,
  type BusinessClockBranch,
  type ResolvedBusinessClock,
} from './clock/BusinessClock';

export {
  BusinessDayService,
  closeAndOpenBusinessDay,
  closeBusinessDay,
  forceCloseBranchShifts,
  getBranchBusinessDate,
  getBusinessDayByDate,
  getBusinessDayById,
  getOpenBusinessDay,
  listOpenShiftsForBranchDay,
  openBusinessDay,
  validateBusinessDayBelongsToBranch,
  type BusinessDayRecord,
} from './application/BusinessDayService';

export {
  ShiftSessionService,
  closeOwnOpenShift,
  closeShift,
  getUserOpenShift,
  getUserOpenShiftForBranch,
  handoffShift,
  listOpenShiftsForBranch,
  openShift,
  validateShiftBelongsToBranch,
  type ShiftMoveRecord,
} from './application/ShiftSessionService';

export {
  lockBranchForDayMutation,
  lockCurrentOpenBusinessDay,
  lockOpenBusinessDay,
  lockOperationalWrite,
  lockShiftSessionForWrite,
} from './infra/businessDayLock';

export {
  ONE_OPEN_BUSINESS_DAY_PER_BRANCH,
  BUSINESS_DAY_FORCE_CLOSE,
  AUTO_BUSINESS_DAY_ROLLOVER,
  BUSINESS_DAY_RECONCILE_USER_MESSAGE,
  ONE_OPEN_SHIFT_PER_USER,
} from './domain/invariants';

export { planBusinessDayReconciliation, isCatchUpMutationRequired } from './domain/businessDayReconciliation';
export type { ReconcilePlanAction, BusinessDayCatchUpMode } from './domain/businessDayReconciliation';

export {
  ensureBusinessDayCurrent,
  reconcileAllBusinessDays,
  reconcileBusinessDay,
} from './application/reconcileBusinessDay';
export type {
  ReconcileAllBusinessDaysResult,
  ReconcileBusinessDayResult,
  ReconcileTrigger,
  EnsureBusinessDayCurrentArgs,
} from './application/reconcileBusinessDay';

export {
  OperationalContextService,
  requireOperationalContext,
  requireOperationalSnapshot,
} from './application/OperationalContextService';

export type {
  OperationalContext,
  OperationalScope,
  OperationalSnapshot,
  RequireOperationalContextArgs,
} from './domain/types';

export { loadOperationalBootstrap, toLegacySessionPayload } from './application/loadOperationalBootstrap';
export type { LoadOperationalBootstrapResult } from './application/loadOperationalBootstrap';
export { loadOperationalBootstrapSnapshot } from './infra/operationalBootstrapRepository';
export { buildOperationalRevision } from './domain/bootstrapTypes';
export type {
  OperationalBootstrap,
  BootstrapErrorCode,
  BootstrapAccess,
  BootstrapBranch,
  BootstrapActiveBranch,
  BootstrapViewState,
  BootstrapOperationalState,
} from './domain/bootstrapTypes';

export { memoizeInOperationalRequest, withOperationalRequestScope } from './requestScope';
