/** Phase 1B branch domain types (server-safe). */

export const BRANCH_SESSION_VERSION = 1 as const;

export type BranchLifecycleStatus =
  | 'SETUP'
  | 'SMOKE_TEST'
  | 'INTERNAL_LIVE'
  | 'PUBLIC_LIVE'
  | 'SUSPENDED';

export interface BranchRecord {
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  address: string | null;
  phone: string | null;
  timeZone: string;
  businessDayCutoffTime: string;
  defaultOpenTime: string | null;
  defaultCloseTime: string | null;
  isActive: boolean;
  /** Phase 1M — authoritative stage. Defaults to SETUP when column absent in old rows. */
  lifecycleStatus: BranchLifecycleStatus;
  /** Phase 1M — public website discovery / booking gate (independent of ops IsActive). */
  publicBookingEnabled: boolean;
  /** Phase 1M — real WhatsApp / customer messaging gate. */
  externalNotificationsEnabled: boolean;
  createdAt: Date;
  updatedAt: Date | null;
}

export interface UserBranchAccessRecord {
  id: number;
  userId: number;
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  isDefault: boolean;
  canOperate: boolean;
  canViewReports: boolean;
  canSwitch: boolean;
  isActive: boolean;
  validFrom: Date;
  validTo: Date | null;
  branchIsActive: boolean;
}

export interface EmpBranchAssignmentRecord {
  id: number;
  empId: number;
  branchId: number;
  branchCode: string;
  branchName: string;
  isHomeBranch: boolean;
  canReceiveBookings: boolean;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ActiveBranchContext {
  userId: number;
  branchId: number;
  branchCode: string;
  branchName: string;
  shortName: string | null;
  timeZone: string;
  businessDayCutoffTime: string;
  canOperate: boolean;
  canViewReports: boolean;
  canSwitch: boolean;
}

export type BranchDomainErrorCode =
  | 'BRANCH_NOT_FOUND'
  | 'BRANCH_INACTIVE'
  | 'NO_BRANCH_ACCESS'
  | 'BRANCH_ACCESS_INACTIVE'
  | 'BRANCH_ACCESS_NOT_STARTED'
  | 'BRANCH_ACCESS_EXPIRED'
  | 'BRANCH_ACCESS_MISMATCH'
  | 'NO_DEFAULT_BRANCH'
  | 'MULTIPLE_DEFAULT_BRANCHES'
  | 'OPERATION_NOT_ALLOWED'
  | 'REPORT_NOT_ALLOWED'
  | 'USER_DELETED'
  | 'USER_NOT_FOUND'
  | 'SESSION_UPGRADE_REQUIRED'
  | 'UNSUPPORTED_BRANCH_SESSION_VERSION'
  | 'SHIFT_BRANCH_MISMATCH'
  | 'SHIFT_DAY_MISMATCH'
  | 'FINANCIAL_BRANCH_MISMATCH'
  | 'NO_OPEN_DAY'
  | 'NO_OPEN_SHIFT'
  | 'OPERATIONAL_OWNERSHIP_MISMATCH'
  | 'ALREADY_OPEN_SHIFT'
  | 'ALREADY_OPEN_ON_TARGET_BRANCH'
  | 'SHIFT_ALREADY_CLOSED'
  | 'SHIFT_NOT_FOUND'
  | 'BUSINESS_DAY_CLOSED'
  | 'BUSINESS_DAY_STALE'
  | 'BUSINESS_DAY_RECONCILIATION_FAILED'
  | 'BUSINESS_DAY_ALREADY_CLOSED'
  | 'ALREADY_OPEN_BUSINESS_DAY'
  | 'OPEN_SHIFTS'
  | 'NO_BUSINESS_DAY_FOR_DATE'
  | 'BRANCH_REQUIRED'
  | 'BRANCH_LIFECYCLE_FORBIDDEN'
  | 'BRANCH_NOT_READY'
  | 'BRANCH_ADMIN_REQUIRED';

export class BranchDomainError extends Error {
  readonly code: BranchDomainErrorCode;
  readonly status: number;

  constructor(code: BranchDomainErrorCode, message: string, status = 403) {
    super(message);
    this.name = 'BranchDomainError';
    this.code = code;
    this.status = status;
  }
}
