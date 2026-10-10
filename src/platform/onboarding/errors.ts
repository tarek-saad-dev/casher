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
  | 'READINESS_FAILED'
  | 'ONBOARDING_PLAN_INVALID'
  | 'ONBOARDING_TARGET_INVALID';

export class TenantOnboardingError extends Error {
  readonly code: TenantOnboardingErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    code: TenantOnboardingErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'TenantOnboardingError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
