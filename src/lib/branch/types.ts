/** Phase 1B branch domain types (server-safe). */

export const BRANCH_SESSION_VERSION = 1 as const;

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
  | 'NO_BUSINESS_DAY_FOR_DATE'
  | 'BRANCH_REQUIRED';

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
