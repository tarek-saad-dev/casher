export type TenantAppErrorCode =
  | 'UNKNOWN_APP'
  | 'PACK_NOT_FOUND'
  | 'PACK_INVALID'
  | 'MISSING_DEPENDENCIES'
  | 'DEPENDENCY_IN_USE'
  | 'REQUIRED_BY_PACK'
  | 'CUSTOMIZATION_CONFLICT'
  | 'APP_NOT_SELECTED'
  | 'APP_NOT_INSTALLED'
  | 'APP_ALREADY_INSTALLED'
  | 'APP_NOT_AVAILABLE'
  | 'TENANT_NOT_FOUND'
  | 'LOCK_TIMEOUT';

export class TenantAppError extends Error {
  readonly code: TenantAppErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: TenantAppErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TenantAppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
