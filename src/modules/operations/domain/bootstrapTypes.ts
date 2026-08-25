/**
 * Compact operational bootstrap DTO — safe for client and server.
 * Keep this free of server-only imports.
 */

export type BootstrapErrorCode =
  | 'UNAUTHENTICATED'
  | 'NO_BRANCH_ACCESS'
  | 'STALE_DAY_RECONCILIATION_FAILED'
  | 'TEMPORARY_OPERATIONAL_READ_FAILURE'
  | 'USER_DELETED'
  | 'SESSION_UPGRADE_REQUIRED';

export type BootstrapUser = {
  userId: number;
  userName: string;
  userLevel: 'admin' | 'user';
  defaultShiftId: number | null;
};

export type BootstrapBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  isCurrent: boolean;
  canOperate: boolean;
};

export type BootstrapActiveBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  timeZone: string;
  businessDayCutoffTime: string;
  canOperate: boolean;
  canViewReports: boolean;
  canSwitch: boolean;
};

export type BootstrapBusinessDay = {
  id: number;
  branchId: number;
  businessDate: string;
  status: boolean;
};

export type BootstrapShift = {
  id: number;
  branchId: number;
  businessDayId: number;
  newDay: string;
  userId: number;
  shiftId: number;
  startTime: string | null;
  status: boolean;
  userName: string | null;
  shiftName: string | null;
};

export type BootstrapAccess = {
  roles: string[];
  isSuperAdmin: boolean;
  isPartnerOnly: boolean;
  defaultLandingPath: string;
  allowedPagePaths: string[];
  allowedPageKeys: string[];
};

export type BootstrapViewState = {
  branch: BootstrapActiveBranch;
  businessDay: BootstrapBusinessDay | null;
};

export type BootstrapOperationalState = {
  /** OPEN ShiftSession branch. Null when the user has no OPEN shift. */
  branch: BootstrapActiveBranch | null;
  /** Business day of the OPEN shift, or null when no OPEN shift. */
  businessDay: BootstrapBusinessDay | null;
  /** User OPEN shift on any branch. Never derived from the view-branch cookie. */
  shift: BootstrapShift | null;
  /**
   * Compatibility: same as `shift` when view.branchId !== operational.branchId.
   * New code must not treat this as an error state.
   */
  shiftOnOtherBranch: BootstrapShift | null;
};

export type OperationalBootstrap = {
  user: BootstrapUser;
  permissions: string[];
  access: BootstrapAccess;
  branches: BootstrapBranch[];
  /** Compatibility alias of `view.branch`. New code should use `view`. */
  activeBranch: BootstrapActiveBranch;
  view: BootstrapViewState;
  operational: BootstrapOperationalState;
  activeBranchState: {
    businessDay: BootstrapBusinessDay | null;
    openShiftCount: number;
  };
  stale: boolean;
  needsRollover: boolean;
  expectedBusinessDate: string | null;
  reconciliationError: string | null;
  reconciliationAction: string | null;
  revision: string;
  dbRoundTrips: number;
};

export function buildOperationalRevision(args: {
  viewBranchId: number;
  operationalBranchId?: number | null;
  /** @deprecated Compatibility alias of viewBranchId. */
  branchId?: number;
  businessDayId: number | null;
  businessDayStatus: boolean | null;
  shiftId: number | null;
  shiftStatus: boolean | null;
  stale: boolean;
}): string {
  const viewBranchId = args.viewBranchId || args.branchId || 0;
  return [
    viewBranchId,
    args.operationalBranchId ?? 0,
    args.businessDayId ?? 0,
    args.businessDayStatus ? 1 : 0,
    args.shiftId ?? 0,
    args.shiftStatus ? 1 : 0,
    args.stale ? 1 : 0,
  ].join(':');
}
