export type TenantOnboardingErrorCode =
  | 'TENANT_CODE_INVALID'
  | 'TENANT_CODE_CONFLICT'
  | 'TENANT_NOT_FOUND'
  | 'BRANCH_CODE_CONFLICT'
  | 'OWNER_USERNAME_CONFLICT'
  | 'OWNER_FIELDS_INVALID'
  | 'FORBIDDEN_SYSTEM_FIELD'
  | 'OWNER_ROLE_MISSING'
  | 'BRAND_PROFILE_INVALID'
  | 'READINESS_FAILED';

export class TenantOnboardingError extends Error {
  readonly code: TenantOnboardingErrorCode;
  readonly status: number;

  constructor(code: TenantOnboardingErrorCode, message: string, status = 400) {
    super(message);
    this.name = 'TenantOnboardingError';
    this.code = code;
    this.status = status;
  }
}
