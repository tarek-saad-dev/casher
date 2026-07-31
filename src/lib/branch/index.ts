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
  listAllBranches,
  listEmployeeActiveBranchAssignments,
  listUserValidBranchAccess,
} from './repository';
export { resolveLoginDefaultBranch, validateUserBranchAccess } from './access';
export {
  getActiveBranchContext,
  isActiveBranchContext,
  requireActiveBranchContext,
  requireBranchAdminAccess,
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
  resolveActiveBranchDayForPosWrite,
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
  listQueueEligibleEmployeeIdsForBranch,
  listPublicActiveBranches,
  loadBookingBranchId,
  loadQueueTicketBranchId,
  publicBranchRequiredResponse,
  publicInvalidBranchResponse,
  resolvePublicBranchCode,
  toPublicBranchSafe,
  type PublicBranchSafe,
  type ResolvePublicBranchOptions,
} from './bookingQueueOwnership';
export {
  listSwitchableBranchesForUser,
  switchActiveBranch,
  resolvePostSwitchNavigationPath,
  type SwitchableBranch,
  type ActiveBranchSafe,
  type SwitchBranchResult,
} from './switchBranch';
export {
  DOMAIN_OWNERSHIP_REGISTRY,
  BRANCH_OWNED_ROUTE_MARKERS,
  GO_LIVE_BLOCKER_DOMAINS,
  type OwnershipClassification,
  type DomainOwnershipEntry,
} from './domainOwnershipRegistry';
export {
  assertBranchIdentityAvailable,
  bootstrapBranch,
  createBranchRecord,
  ensureQueueBookingSettingsForBranch,
  grantUserBranchAccess,
  seedPartnerSharesFromSourceBranch,
  type BootstrapBranchOptions,
  type BootstrapBranchResult,
  type CreateBranchInput,
  type GrantUserBranchAccessInput,
  type GrantUserBranchAccessResult,
  type SeedQueueSettingsInput,
} from './bootstrap';
export {
  auditEmployeeAssignmentIntegrity,
  ensureEmployeeBranchAssignment,
  type AssignmentIntegrityIssue,
  type AssignmentIntegrityReport,
} from './assignmentIntegrity';
export {
  evaluateBranchOperationalReadiness,
  type BranchReadinessReport,
  type ReadinessCheck,
} from './readiness';
export {
  BRANCH_LIFECYCLE_STATUSES,
  LIFECYCLE_CAPABILITIES,
  ALLOWED_LIFECYCLE_TRANSITIONS,
  capabilitiesFor,
  isBranchLifecycleStatus,
  isForbiddenLifecycleJump,
  isPubliclyDiscoverable,
  isTransitionAllowed,
  type BranchLifecycleStatus as LifecycleStatusAlias,
  type LifecycleCapabilities,
} from './lifecycle';
export { provisionBranch } from './branchProvisioningService';
export {
  evaluateBranchReadiness,
  evaluateBranchReadinessByCode,
} from './branchReadinessService';
export { transitionBranchLifecycle } from './branchLifecycleTransition';
export {
  assertSmokeBranch,
  cleanupBranchSmokeRun,
  getBranchSmokeRun,
  registerSmokeArtifact,
  startBranchSmokeRun,
  SMOKE_BRANCH_CODE,
  GLEEM_BRANCH_CODE,
} from './branchSmokeService';
export {
  applyApprovedBranchConfigurationTemplate,
  auditGlobalServiceParity,
} from './branchConfigurationTemplate';
export { updateBranchSetupFields } from './updateBranchSetup';
export {
  resolveBranchDisplayIdentity,
  buildBranchMessageIdentity,
  normalizeEgyptianDisplayPhone,
} from './branchDisplayIdentity';
export {
  evaluateOvernightSlot,
  CAMP_CAESAR_OVERNIGHT_HOURS,
  assertCampCaesarOvernightBoundaries,
} from './overnightOperatingHours';
export {
  commitEmployeeBranchAssignment,
  assertBranchPayrollPresentForOps,
} from './employeeAssignmentCommit';
export {
  upsertCampCaesarPartnerShareDraft,
  resolveCampCaesarPartnerIdentities,
} from './campCaesarPartnerDraft';
export {
  OPENING_INVENTORY_OPTIONS,
  selectOpeningInventoryOption,
  isOpeningInventoryResolved,
} from './openingInventoryDecision';
export {
  getBranchSetupPolicy,
  upsertBranchSetupPolicy,
} from './branchSetupPolicy';
export {
  decideOpeningCashZero,
  decideOpeningCashAmount,
  isOpeningCashResolved,
} from './openingCashDecision';
export { activateBranchPartnerShares } from './activatePartnerShares';
export {
  buildMockBranchReceiptPayload,
  renderWhatsAppTemplateProof,
} from './branchReceiptIdentity';
