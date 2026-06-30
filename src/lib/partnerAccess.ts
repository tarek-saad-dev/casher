import type { UserAccess } from '@/lib/permissions-types';

export const PARTNER_ROLE_KEY = 'partner';
export const PARTNERS_REPORT_PAGE_PATH = '/admin/reports/partners';
export const PARTNERS_REPORT_PAGE_KEY = 'reports.partners';

export const STAFF_LAYOUT_ROLE_KEYS = ['admin', 'super_admin'] as const;

export function isStaffLayoutUser(roles: string[]): boolean {
  return roles.some((role) => STAFF_LAYOUT_ROLE_KEYS.includes(role as typeof STAFF_LAYOUT_ROLE_KEYS[number]));
}

export function isPartnerOnlyUser(roles: string[]): boolean {
  return roles.includes(PARTNER_ROLE_KEY) && !isStaffLayoutUser(roles);
}

export function getDefaultLandingPath(access: Pick<UserAccess, 'roles' | 'isSuperAdmin'>): string {
  if (isPartnerOnlyUser(access.roles)) {
    return PARTNERS_REPORT_PAGE_PATH;
  }
  return '/income/pos';
}

export function shouldSkipShiftPrompt(roles: string[]): boolean {
  return isPartnerOnlyUser(roles);
}

export function normalizePagePath(path: string): string {
  return path.split('?')[0].replace(/\/$/, '') || '/';
}

export function canPartnerAccessPath(path: string): boolean {
  return normalizePagePath(path) === normalizePagePath(PARTNERS_REPORT_PAGE_PATH);
}
