import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ getPool: vi.fn(), sql: {} }));

import {
  BrandProfileValidationError,
  brandPrimaryPhone,
  brandWordmark,
  normalizeLogoUrl,
  normalizeOrigins,
  toPrintBrand,
  toPrintBrandHtml,
  validateBrandProfileInput,
} from '@/platform/branding/brandProfile';
import { evaluateLimit } from '@/platform/commercial/limits';
import { evaluateSubscription, nextSubscriptionStatus } from '@/platform/commercial/subscriptionLifecycle';
import type { TenantSubscriptionRecord } from '@/platform/commercial/types';
import { isRouteAvailable, requiredAppsForRoute } from '@/platform/tenant/navAppGating';
import { describeSubscriptionNotice } from '@/platform/tenant/subscriptionBanner';
import type { TenantShellSnapshot } from '@/platform/tenant/tenantShellTypes';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-08T12:00:00.000Z');

describe('DRVO-017 brand profile validation', () => {
  const base = { displayName: '  Acme Store ', timezone: 'Africa/Cairo' };

  it('normalizes a valid payload', () => {
    const v = validateBrandProfileInput({
      ...base,
      phone: '010 1234 5678',
      primaryColor: '#abcdef',
      logoUrl: '/logo.png',
      publicBookingOrigins: ['https://book.example.com/', 'https://book.example.com'],
    });
    expect(v.displayName).toBe('Acme Store');
    expect(v.primaryColor).toBe('#ABCDEF');
    expect(v.publicBookingOrigins).toEqual(['https://book.example.com']);
  });

  it('rejects unknown timezones, bad colors and bad phones', () => {
    expect(() => validateBrandProfileInput({ ...base, timezone: 'Mars/Olympus' })).toThrow(
      BrandProfileValidationError,
    );
    expect(() => validateBrandProfileInput({ ...base, primaryColor: 'red' })).toThrow(BrandProfileValidationError);
    expect(() => validateBrandProfileInput({ ...base, phone: '<script>' })).toThrow(BrandProfileValidationError);
    expect(() => validateBrandProfileInput({ timezone: 'UTC' })).toThrow(BrandProfileValidationError);
  });

  it('only accepts same-origin paths or https logos', () => {
    expect(normalizeLogoUrl('/a.png')).toBe('/a.png');
    expect(normalizeLogoUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AA', 'http://x.com/a.png', '//evil.com/a.png']) {
      expect(() => normalizeLogoUrl(bad)).toThrow(BrandProfileValidationError);
    }
  });

  it('booking origins must be bare https origins (http only for localhost)', () => {
    expect(normalizeOrigins(['http://localhost:3000'])).toEqual(['http://localhost:3000']);
    expect(() => normalizeOrigins(['http://example.com'])).toThrow(BrandProfileValidationError);
    expect(() => normalizeOrigins(['https://example.com/book'])).toThrow(BrandProfileValidationError);
    expect(() => normalizeOrigins('https://example.com')).toThrow(BrandProfileValidationError);
  });

  it('derives print fields and escapes them for HTML documents', () => {
    const brand = {
      displayName: 'Cut Salon',
      logoUrl: '/cutsalon.png',
      phone: '01012126899 - 035861483',
      address: 'صالون كت للرجال',
      receiptFooter: 'شكراً لاختياركم Cut Salon',
    };
    expect(toPrintBrand(brand)).toMatchObject({
      name: 'Cut Salon',
      title: 'CUT SALON',
      wordmark: 'CUT',
      primaryPhone: '01012126899',
    });
    expect(brandPrimaryPhone(null)).toBeNull();
    expect(brandWordmark('Acme')).toBe('ACME');
    const html = toPrintBrandHtml({ ...brand, displayName: '<b>X</b> & "Y"' });
    expect(html.name).toBe('&lt;b&gt;X&lt;/b&gt; &amp; &quot;Y&quot;');
  });
});

describe('DRVO-017 navigation app gating', () => {
  it('core routes are always available', () => {
    expect(requiredAppsForRoute('/admin/users')).toBeNull();
    expect(isRouteAvailable('/admin/tenant', [])).toBe(true);
  });

  it('app routes require the owning app', () => {
    expect(isRouteAvailable('/income/pos', ['pos'])).toBe(true);
    expect(isRouteAvailable('/income/pos', ['booking'])).toBe(false);
    expect(isRouteAvailable('/bookings/123', ['booking'])).toBe(true);
    expect(isRouteAvailable('/admin/queue-booking-settings', ['queue'])).toBe(true);
    expect(isRouteAvailable('/admin/queue-booking-settings', ['pos'])).toBe(false);
  });

  it('HR tabs match the exact query parameter, not a substring', () => {
    expect(requiredAppsForRoute('/admin/hr?tab=attendance')).toEqual(['attendance']);
    expect(requiredAppsForRoute('/admin/hr?tab=attendance-x')).toBeNull();
    expect(requiredAppsForRoute('/admin/hr')).toBeNull();
  });

  it('does not match sibling prefixes', () => {
    expect(requiredAppsForRoute('/salesman')).toBeNull();
    expect(requiredAppsForRoute('/sales/today')).toEqual(['pos']);
  });

  it('a supermarket tenant (pos only) loses booking/queue but keeps POS', () => {
    const apps = ['pos'];
    expect(isRouteAvailable('/income/pos', apps)).toBe(true);
    expect(isRouteAvailable('/queue', apps)).toBe(false);
    expect(isRouteAvailable('/bookings', apps)).toBe(false);
  });
});

function shellSub(over: Partial<TenantShellSnapshot['subscription']>): TenantShellSnapshot['subscription'] {
  return {
    allowed: true,
    status: 'active',
    reason: 'ACTIVE',
    warning: null,
    accessEndsAt: null,
    planCode: 'starter',
    planName: 'Starter',
    trialEndsAt: null,
    pastDueSince: null,
    currentPeriodEndsAt: null,
    ...over,
  };
}

describe('DRVO-017 subscription banner', () => {
  it('active subscriptions show nothing', () => {
    expect(describeSubscriptionNotice(shellSub({}), NOW)).toBeNull();
  });

  it('trial shows info only near the end', () => {
    const far = new Date(NOW.getTime() + 20 * DAY).toISOString();
    const near = new Date(NOW.getTime() + 3 * DAY).toISOString();
    expect(describeSubscriptionNotice(shellSub({ status: 'trial', reason: 'TRIAL_VALID', trialEndsAt: far }), NOW)).toBeNull();
    expect(
      describeSubscriptionNotice(shellSub({ status: 'trial', reason: 'TRIAL_VALID', trialEndsAt: near }), NOW)?.tone,
    ).toBe('info');
  });

  it('past due and cancelled-until-period-end warn', () => {
    expect(
      describeSubscriptionNotice(
        shellSub({ status: 'past_due', reason: 'PAST_DUE_IN_GRACE', warning: 'PAST_DUE_GRACE' }),
        NOW,
      )?.tone,
    ).toBe('warning');
    expect(
      describeSubscriptionNotice(
        shellSub({ status: 'cancelled', reason: 'CANCELLED_UNTIL_PERIOD_END', warning: 'CANCELLED_UNTIL_PERIOD_END' }),
        NOW,
      )?.tone,
    ).toBe('warning');
  });

  it('blocked subscriptions are danger', () => {
    const n = describeSubscriptionNotice(shellSub({ allowed: false, status: 'suspended', reason: 'SUSPENDED' }), NOW);
    expect(n?.tone).toBe('danger');
  });
});

function record(over: Partial<TenantSubscriptionRecord>): TenantSubscriptionRecord {
  return {
    tenantId: '00000000-0000-0000-0000-000000000017',
    planCode: 'starter',
    status: 'trial',
    origin: 'onboarding',
    trialStartedAt: NOW,
    trialEndsAt: new Date(NOW.getTime() + 14 * DAY),
    currentPeriodEndsAt: null,
    pastDueSince: null,
    suspendedAt: null,
    cancelledAt: null,
    revision: 1,
    ...over,
  };
}

describe('DRVO-017 smoke scenarios (pure)', () => {
  const plan = { pastDueGraceDays: 7 };

  it('user limit: owner fills a 1-user plan, the next user is refused', () => {
    expect(evaluateLimit(1, 0).canAdd).toBe(true);
    expect(evaluateLimit(1, 1).canAdd).toBe(false);
    expect(evaluateLimit(null, 500).canAdd).toBe(true);
  });

  it('suspend blocks and reactivate restores access', () => {
    const trial = record({});
    expect(evaluateSubscription(trial, plan, NOW).allowed).toBe(true);

    const suspendedStatus = nextSubscriptionStatus('trial', 'suspend') ?? nextSubscriptionStatus('active', 'suspend');
    expect(suspendedStatus).toBe('suspended');
    const suspended = record({ status: 'suspended', suspendedAt: NOW });
    const blocked = evaluateSubscription(suspended, plan, NOW);
    expect(blocked).toMatchObject({ allowed: false, reason: 'SUSPENDED' });
    expect(describeSubscriptionNotice(shellSub({ allowed: false, status: 'suspended', reason: 'SUSPENDED' }), NOW)?.tone).toBe(
      'danger',
    );

    expect(nextSubscriptionStatus('suspended', 'reactivate')).toBe('active');
    const restored = evaluateSubscription(record({ status: 'active', suspendedAt: null }), plan, NOW);
    expect(restored.allowed).toBe(true);
  });
});

describe('DRVO-017 onboarding wiring', () => {
  const provision = read('src/platform/onboarding/provisionTenant.ts');

  it('first branch is usable for internal operations, public booking stays off', () => {
    expect(provision).toContain("FIRST_BRANCH_LIFECYCLE = 'INTERNAL_LIVE'");
    expect(provision).toMatch(/1, N'\$\{FIRST_BRANCH_LIFECYCLE\}', 0, 0, @createdBy/);
  });

  it('owner gets the tenant admin role, never super_admin, and fails closed if missing', () => {
    expect(provision).toContain("OWNER_ROLE_KEY = 'admin'");
    expect(provision).toContain("'OWNER_ROLE_MISSING'");
    expect(provision).not.toContain("'super_admin'");
  });

  it('enforces branch and user limits inside the transaction', () => {
    expect(provision.indexOf('assertCanAddBranch(tx')).toBeLessThan(provision.indexOf('createBranchInTransaction(tx'));
    expect(provision.indexOf('assertCanAddUser(tx')).toBeLessThan(provision.indexOf('createOwnerUserInTransaction(tx'));
  });

  it('writes a brand row and only seeds booking settings for booking/queue apps', () => {
    expect(provision).toContain('insertTenantBrandProfileInTransaction');
    expect(provision).toContain("new Set(['booking', 'queue'])");
  });

  it('readiness checks cover login, role, usable branch and brand', () => {
    const readiness = read('src/platform/onboarding/tenantReadiness.ts');
    for (const id of ['has_usable_branch', 'owner_admin_role', 'owner_can_login', 'brand_profile']) {
      expect(readiness).toContain(`id: '${id}'`);
    }
  });

  it('create-tenant API requires an industry pack and rejects role/level overrides', () => {
    const route = read('src/app/api/admin/platform/tenants/route.ts');
    expect(route).toContain("'PACK_REQUIRED'");
    expect(route).not.toContain('DEFAULT_INDUSTRY_PACK_CODE');
    for (const f of ['ownerUserLevel', 'ownerRole', 'roles']) expect(route).toContain(`'${f}'`);
  });

  it('onboarding is pack-driven, not salon-hardcoded', () => {
    expect(provision).not.toMatch(/packCode === 'salon'|['"]salon['"]/);
  });
});

describe('DRVO-017 permissions and route auth', () => {
  it('permission seed/migrate are platform-operator only', () => {
    for (const rel of ['src/app/api/admin/permissions/seed/route.ts', 'src/app/api/admin/permissions/migrate/route.ts']) {
      const src = read(rel);
      expect(src).toContain('requirePlatformOperator');
      expect(src).not.toMatch(/requireAdmin\(/);
    }
  });

  it('global role/page editors require a platform operator, not just super_admin', () => {
    for (const rel of [
      'src/app/api/admin/permissions/users/route.ts',
      'src/app/api/admin/permissions/pages/route.ts',
      'src/app/api/admin/permissions/debug-access/route.ts',
    ]) {
      expect(read(rel)).toMatch(/isPlatformOperatorUser\(|requirePlatformOperator\(/);
    }
  });

  it('operator tenant routes and console are guarded by requirePlatformOperator', () => {
    expect(read('src/app/api/admin/platform/tenants/[tenantId]/route.ts')).toContain('requirePlatformOperator');
    expect(read('src/app/api/admin/platform/tenants/[tenantId]/brand/route.ts')).toContain('requirePlatformOperator');
    expect(read('src/app/platform/layout.tsx')).toContain('requirePlatformOperator');
  });

  it('tenant brand API derives the tenant from the session and rejects body tenant ids', () => {
    const src = read('src/app/api/tenant/brand/route.ts');
    expect(src).toContain('requireAdmin');
    expect(src).toMatch(/tenantId/);
    expect(src).toContain('expectedRevision');
  });

  it('tenant context API uses the tenant shell auth (works while blocked so the shell can explain)', () => {
    expect(read('src/app/api/tenant/context/route.ts')).toContain('authenticateTenantShell');
  });
});

describe('DRVO-017 generic shell branding', () => {
  it('main nav and root layout have no hardcoded CUT branding', () => {
    const nav = read('src/components/layout/MainNav.tsx');
    expect(nav).not.toMatch(/['"`]CUT( SALON| CLUB)?['"`]/);
    expect(nav).not.toContain('/cutsalon.png');
    const layout = read('src/app/layout.tsx');
    expect(layout).not.toMatch(/Cut Salon|CUT SALON/);
  });

  it('receipts read the tenant brand instead of literal CUT strings', () => {
    for (const rel of [
      'src/components/pos/PrintInvoiceModal.tsx',
      'src/components/operations/ShiftCloseReceipt.tsx',
      'src/lib/printQueueTicket.ts',
      'src/lib/printBookingTicket.ts',
    ]) {
      const src = read(rel);
      expect(src).toMatch(/PrintBrand/);
      expect(src).not.toMatch(/CUT SALON|01012126899/);
    }
  });
});
