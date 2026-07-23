export type {
  ActiveBranchContext,
  BranchDomainErrorCode,
  BranchRecord,
  EmpBranchAssignmentRecord,
  UserBranchAccessRecord,
} from './types';
export { BRANCH_SESSION_VERSION, BranchDomainError } from './types';
export {
  branchNow,
  getBranchByCode,
  getBranchById,
  getEmployeeHomeBranch,
  getUserDefaultBranch,
  listActiveBranches,
  listEmployeeActiveBranchAssignments,
  listUserValidBranchAccess,
} from './repository';
export { resolveLoginDefaultBranch, validateUserBranchAccess } from './access';
export {
  getActiveBranchContext,
  isActiveBranchContext,
  requireActiveBranchContext,
  requireBranchOperationAccess,
  requireBranchReportAccess,
  validateSessionBranch,
  withBranchRequestScope,
} from './context';
export {
  closeAndOpenBusinessDay,
  closeBusinessDay,
  forceCloseBranchShifts,
  getBranchBusinessDate,
  getBusinessDayByDate,
  getBusinessDayById,
  getOpenBusinessDay,
  openBusinessDay,
  validateBusinessDayBelongsToBranch,
} from './businessDay';
export {
  closeShift,
  getUserOpenShift,
  getUserOpenShiftForBranch,
  listOpenShiftsForBranch,
  openShift,
  validateShiftBelongsToBranch,
} from './shiftSession';
export {
  branchErrorResponse,
  requireBranchOperatorContext,
  resolveBranchDayAndShiftForWrite,
  resolveBranchDayForDate,
} from './operationalGates';
export {
  assertActiveBranchOwns,
  assertShiftMatchesOwnership,
  financialNotFoundResponse,
  loadCashMoveOwnership,
  loadInvoiceOwnership,
  ownershipFromBranchDay,
  resolvePastDateBusinessDayForBranch,
  type FinancialOwnership,
} from './financialOwnership';
export {
  isReportBranchScope,
  listAuthorizedReportBranches,
  parseReportScopeQuery,
  reportScopeMetadata,
  reportScopeToCacheKey,
  requireAllBranchesReportAccess,
  resolveActiveBranchReportScope,
  resolveReportBranchScope,
  resolveSelectedBranchReportScope,
  validateRequestedReportBranch,
  type ReportBranchRef,
  type ReportBranchScope,
  type ReportScopeRequest,
} from './reportScope';
export {
  GLEEM_PARTNER_SHARE_EFFECTIVE_FROM,
  PARTNER_SHARE_SUM_TOLERANCE,
  PartnerShareConfigError,
  createBranchPartnerSharePeriod,
  endBranchPartnerSharePeriod,
  getEffectiveBranchPartnerShares,
  getPartnerShareConfigurationTimeline,
  toPartnerPercentageList,
  updateBranchPartnerSharePeriod,
  validateBranchPartnerShares,
  type BranchPartnerShareRecord,
} from './partnerShares';
export {
  EMP_BOOKABLE_AT_BRANCH_SQL,
  assertBookingOwnedByActiveBranch,
  bookingQueueNotFoundResponse,
  extractPublicBranchCode,
  isEmployeeEligibleForBranchBookings,
  listBookableEmployeeIdsForBranch,
  listPublicActiveBranches,
  loadBookingBranchId,
  loadQueueTicketBranchId,
  publicBranchRequiredResponse,
  publicInvalidBranchResponse,
  resolvePublicBranchCode,
  toPublicBranchSafe,
  type PublicBranchSafe,
} from './bookingQueueOwnership';
