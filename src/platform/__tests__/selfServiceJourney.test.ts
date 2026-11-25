import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GoLiveMilestone, GoLiveMilestoneId, TenantGoLiveReport } from '@/platform/onboarding/goLiveTypes';
import { buildSelfServiceJourney, isSelfServiceStepId } from '@/platform/onboarding/selfServiceJourney';

const IDS: GoLiveMilestoneId[] = [
  'commercial_access', 'active_branch', 'catalog', 'team', 'users',
  'business_day', 'first_shift', 'first_sale', 'first_booking',
];

function example(done: GoLiveMilestoneId[] = [], bookingInstalled = true): TenantGoLiveReport {
  const milestones: GoLiveMilestone[] = IDS.map((id) => ({
    id, label: id, detail: id, action: id,
    status: id === 'first_booking' && !bookingInstalled ? 'not_applicable' : done.includes(id) ? 'done' : 'pending',
    count: done.includes(id) ? 1 : 0,
  }));
  return {
    tenantId: '11111111-1111-4111-8111-111111111111',
    tenantCode: 'NEW_SALON',
    tenantName: 'صالون جديد',
    ownerLoginName: 'u201012345678',
    bookingInstalled,
    status: 'IN_PROGRESS',
    completed: done.length,
    total: bookingInstalled ? 9 : 8,
    progressPercent: 0,
    primaryBranch: { branchId: 42, branchCode: 'NEW_MAIN', branchName: 'الفرع الرئيسي' },
    milestones,
  };
}

describe('self-service salon onboarding', () => {
  it('renders stable routed steps and does not depend on local storage flags', () => {
    const journey = buildSelfServiceJourney(example());
    expect(journey.steps.map((s) => s.href)).toEqual([
      '/setup', '/setup/branch', '/setup/services',
      '/setup/team', '/setup/launch', '/setup/finish',
    ]);
    expect(journey.progressPercent).toBe(0);
    expect(journey.ready).toBe(false);
    expect(journey.steps[0].complete).toBe(true);
    expect(isSelfServiceStepId('branch')).toBe(true);
    expect(isSelfServiceStepId('not-real')).toBe(false);
  });

  it('tracks only the tenant-scoped branch, catalog, team and day + shift setup', () => {
    const journey = buildSelfServiceJourney(example([
      'commercial_access', 'active_branch', 'users', 'catalog', 'team',
    ]));
    expect(journey.completeCount).toBe(3);
    expect(journey.totalCount).toBe(4);
    expect(journey.progressPercent).toBe(75);
    expect(journey.steps.find((s) => s.id === 'launch')?.complete).toBe(false);
    expect(journey.pendingMilestones).toEqual(['business_day', 'first_shift']);
  });

  it('does not require a real sale or public booking to complete initial setup', () => {
    const journey = buildSelfServiceJourney(example([
      'commercial_access', 'active_branch', 'catalog', 'team', 'users',
      'business_day', 'first_shift',
    ]));
    expect(journey.ready).toBe(true);
    expect(journey.progressPercent).toBe(100);
    expect(journey.steps.find((s) => s.id === 'finish')?.complete).toBe(true);
    expect(journey.bookingInstalled).toBe(true);
  });

  it('does not call an uninstalled booking app a required setup step', () => {
    const journey = buildSelfServiceJourney(example([
      'commercial_access', 'active_branch', 'catalog', 'team', 'users',
      'business_day', 'first_shift',
    ], false));
    expect(journey.ready).toBe(true);
    expect(journey.bookingInstalled).toBe(false);
  });

  it('requires commercial access and owner membership even if operating milestones exist', () => {
    const journey = buildSelfServiceJourney(example([
      'active_branch', 'catalog', 'team', 'business_day', 'first_shift',
    ]));
    expect(journey.progressPercent).toBe(100);
    expect(journey.ready).toBe(false);
  });
});

describe('self-service setup security and routing guardrails', () => {
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

  it('keeps onboarding read-only, admin-scoped and bound to session tenant only', () => {
    const route = read('src/app/api/tenant/onboarding/route.ts');
    expect(route).toContain('requireAdmin()');
    expect(route).toContain('evaluateTenantGoLive(auth.tenantId)');
    expect(route).toContain('report.tenantId.toLowerCase() !== auth.tenantId.toLowerCase()');
    expect(route).not.toMatch(/\b(req\.query|searchParams|INSERT INTO|UPDATE dbo\.)\b/i);
    expect(route).toContain("'Cache-Control': 'no-store'");
  });

  it('requires admin auth for every routed setup page', () => {
    const layout = read('src/app/setup/layout.tsx');
    expect(layout).toContain('requireAdmin()');
    expect(layout).toContain("redirect('/login')");
  });

  it('routes new salons into the guide without changing supermarket entry', () => {
    const service = read('src/platform/publicSignup/service.ts');
    expect(service).toContain("nextPath: input.industry === 'salon' ? '/setup' : '/operations'");
    expect(service).toContain('onboardBusiness(');
  });

  it('does not mutate the public booking flag, channels or trial terms', () => {
    const files = [
      'src/app/api/tenant/onboarding/route.ts',
      'src/platform/onboarding/selfServiceJourney.ts',
      'src/components/onboarding/SelfServiceSetup.tsx',
    ].map(read).join('\n');
    expect(files).not.toMatch(/PublicBookingEnabled|UPDATE\s+dbo\.|TenantMessagingChannel/);
    expect(files).not.toContain('/api/public/signup/complete');
  });
});
