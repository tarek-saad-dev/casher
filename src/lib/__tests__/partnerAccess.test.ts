import { describe, it, expect } from 'vitest';
import {
  PARTNER_ROLE_KEY,
  PARTNERS_REPORT_PAGE_PATH,
  canPartnerAccessPath,
  getDefaultLandingPath,
  isPartnerOnlyUser,
  isStaffLayoutUser,
  normalizePagePath,
  shouldSkipShiftPrompt,
} from '@/lib/partnerAccess';

describe('partnerAccess', () => {
  it('identifies partner-only users', () => {
    expect(isPartnerOnlyUser(['partner'])).toBe(true);
    expect(isPartnerOnlyUser(['partner', 'admin'])).toBe(false);
    expect(isPartnerOnlyUser(['partner', 'super_admin'])).toBe(false);
    expect(isPartnerOnlyUser(['cashier'])).toBe(false);
  });

  it('identifies staff layout users', () => {
    expect(isStaffLayoutUser(['admin'])).toBe(true);
    expect(isStaffLayoutUser(['super_admin'])).toBe(true);
    expect(isStaffLayoutUser(['partner', 'admin'])).toBe(true);
    expect(isStaffLayoutUser(['partner'])).toBe(false);
  });

  it('returns partners report as default landing for partner-only users', () => {
    expect(getDefaultLandingPath({ roles: ['partner'], isSuperAdmin: false }))
      .toBe(PARTNERS_REPORT_PAGE_PATH);
    expect(getDefaultLandingPath({ roles: ['cashier'], isSuperAdmin: false }))
      .toBe('/income/pos');
    expect(getDefaultLandingPath({ roles: ['partner', 'admin'], isSuperAdmin: false }))
      .toBe('/income/pos');
  });

  it('skips shift prompt for partner-only users', () => {
    expect(shouldSkipShiftPrompt(['partner'])).toBe(true);
    expect(shouldSkipShiftPrompt(['cashier'])).toBe(false);
  });

  it('normalizes paths without query strings', () => {
    expect(normalizePagePath('/admin/reports/partners?year=2026&month=6'))
      .toBe('/admin/reports/partners');
    expect(normalizePagePath('/admin/reports/partners/'))
      .toBe('/admin/reports/partners');
  });

  it('allows partner paths with or without trailing slash and query params', () => {
    expect(canPartnerAccessPath('/admin/reports/partners')).toBe(true);
    expect(canPartnerAccessPath('/admin/reports/partners/')).toBe(true);
    expect(canPartnerAccessPath('/admin/reports/partners?year=2026&month=6')).toBe(true);
    expect(canPartnerAccessPath('/admin/users')).toBe(false);
    expect(canPartnerAccessPath('/operations')).toBe(false);
  });

  it('uses stable partner role key', () => {
    expect(PARTNER_ROLE_KEY).toBe('partner');
  });
});
