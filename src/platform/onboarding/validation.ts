import { TenantOnboardingError } from './errors';

const TENANT_CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,62}$/;

export function normalizeTenantCode(code: string): string {
  return code.trim().toUpperCase();
}

export function normalizeBranchCode(code: string): string {
  return code.trim().toUpperCase();
}

export function assertValidTenantCode(code: string): string {
  const normalized = normalizeTenantCode(code);
  if (!TENANT_CODE_PATTERN.test(normalized)) {
    throw new TenantOnboardingError(
      'TENANT_CODE_INVALID',
      'Tenant code must be 3-63 chars: uppercase letters, digits, underscore; start with a letter.',
    );
  }
  if (normalized === 'CASHER_BOOT') {
    throw new TenantOnboardingError(
      'TENANT_CODE_INVALID',
      'Tenant code CASHER_BOOT is reserved for bootstrap reconciliation.',
    );
  }
  return normalized;
}

export function rejectSystemControlledFields(
  body: Record<string, unknown>,
  forbidden: string[],
): void {
  for (const key of forbidden) {
    if (body[key] !== undefined) {
      throw new TenantOnboardingError(
        'FORBIDDEN_SYSTEM_FIELD',
        `System-controlled field is not accepted: ${key}`,
      );
    }
  }
}
