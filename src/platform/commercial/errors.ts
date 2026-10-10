export type CommercialErrorCode =
  | 'PLAN_NOT_FOUND'
  | 'PLAN_NOT_ASSIGNABLE'
  | 'TRIAL_NOT_AVAILABLE'
  | 'SUBSCRIPTION_NOT_FOUND'
  | 'SUBSCRIPTION_EXISTS'
  | 'INVALID_TRANSITION'
  | 'INVALID_ACTION'
  | 'REVISION_CONFLICT'
  | 'COMMERCIAL_ACCESS_BLOCKED'
  | 'BRANCH_LIMIT_REACHED'
  | 'USER_LIMIT_REACHED'
  | 'TENANT_NOT_FOUND';

export class CommercialError extends Error {
  readonly code: CommercialErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: CommercialErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CommercialError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
