/**
 * Customer onboarding wizard — composition, plan limits, request parsing, the coordinator's
 * create/retry contract and static guards (DRVOWA, legacy provisioning API, password hashing).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { findIndustryPack } from '@/packs';
import type { SaaSPlanRecord } from '@/platform/commercial/types';
import {
  addBranch,
  buildOnboardingRequest,
  emptyService,
  emptyUser,
  initialDraft,
  removeBranch,
  setBusinessName,
  setIndustryPack,
  toggleApp,
  type OnboardingDraft,
} from '@/platform/onboarding/wizard/draft';
import { parseOnboardingRequest } from '@/platform/onboarding/wizard/parseRequest';
import {
  hasBlockingIssues,
  suggestTenantCode,
  validateOnboardingRequest,
  visibleWizardSteps,
} from '@/platform/onboarding/wizard/plan';
import type { OnboardingRequest } from '@/platform/onboarding/wizard/types';
import type { ProvisionTenantInput, ProvisionTenantResult } from '@/platform/onboarding/types';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({
  getPool: async () => {
    throw new Error('tests must not reach the database');
  },
  sql: {},
}));

const salon = findIndustryPack('salon')!;
const supermarket = findIndustryPack('supermarket')!;
const clinic = findIndustryPack('clinic')!;

const plan = (over: Partial<SaaSPlanRecord> = {}): SaaSPlanRecord => ({
  planCode: 'starter',
  displayName: 'Starter',
  isPublic: true,
  isActive: true,
  sortOrder: 1,
  maxBranches: 1,
  maxUsers: 3,
  trialDays: 14,
  pastDueGraceDays: 7,
  ...over,
});

function filledDraft(packCode = 'salon'): OnboardingDraft {
  const selected = findIndustryPack(packCode)!;
  let d = setIndustryPack(setBusinessName(initialDraft(), 'Salon Nour'), selected);
  d = {
    ...d,
    branches: [{ ...d.branches[0]!, branchName: 'Main' }],
    owner: { displayName: 'Nour', loginName: 'nour.owner', password: 'Strong123' },
  };
  return d;
}

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('industry composition', () => {
  it('salon: booking required, recommended apps on, optional off, salon steps visible', () => {
    const { request, apps } = buildOnboardingRequest(filledDraft('salon'), salon);
    expect(apps).toEqual(expect.arrayContaining(['booking', 'queue', 'pos', 'attendance', 'payroll', 'treasury', 'reports']));
    for (const off of ['inventory', 'purchasing', 'messaging', 'ai-receptionist']) expect(apps).not.toContain(off);
    expect(request.booking).toHaveLength(1);
    expect(request.ai).toBeNull();
    const steps = visibleWizardSteps(salon, apps);
    expect(steps).toEqual(expect.arrayContaining(['services', 'booking']));
    expect(steps).not.toContain('ai');
    expect(validateOnboardingRequest(request, { pack: salon, plan: plan() }).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('supermarket: no salon services, no booking step, catalog configured later', () => {
    let d = filledDraft('salon');
    d = { ...d, services: [{ ...emptyService(), name: 'Cut', price: 50 }] };
    d = setIndustryPack(d, supermarket);
    expect(d.services).toEqual([]);
    const { request, apps } = buildOnboardingRequest(d, supermarket);
    expect(apps).toEqual(expect.arrayContaining(['pos', 'inventory', 'purchasing', 'treasury', 'reports']));
    expect(apps).not.toContain('booking');
    expect(request.services).toEqual([]);
    expect(request.booking).toEqual([]);
    expect(visibleWizardSteps(supermarket, apps)).not.toContain('booking');

    const forced: OnboardingRequest = { ...request, services: [{ ...emptyService(), name: 'Milk', price: 10 }] };
    const issues = validateOnboardingRequest(forced, { pack: supermarket, plan: plan() });
    expect(issues.some((i) => i.step === 'services' && i.severity === 'error')).toBe(true);
  });

  it('clinic: reuses booking/POS/workforce apps with clinic-specific semantics', () => {
    let d = setIndustryPack(setBusinessName(initialDraft(), 'Care Clinic'), clinic);
    d = {
      ...d,
      branches: [{ ...d.branches[0]!, branchName: 'Main Clinic' }],
      owner: { displayName: 'Doctor Owner', loginName: 'doctor.owner', password: 'Strong123' },
      services: [{ ...emptyService(), name: 'Consultation', arabicName: 'كشف', price: 350 }],
      employees: [{ name: 'Dr Ahmed', job: 'طبيب', branchIndex: 0, active: true, acceptsBookings: true }],
    };
    const { request, apps } = buildOnboardingRequest(d, clinic);
    expect(apps).toEqual(expect.arrayContaining(['booking', 'queue', 'pos', 'attendance', 'payroll', 'treasury', 'reports']));
    expect(request.services).toHaveLength(1);
    expect(request.booking).toHaveLength(1);
    expect(request.employees[0]).toMatchObject({ job: 'طبيب', acceptsBookings: true });
    expect(visibleWizardSteps(clinic, apps)).toContain('booking');
    expect(validateOnboardingRequest(request, { pack: clinic, plan: plan() }).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('a required app cannot be disabled', () => {
    const d = filledDraft('salon');
    expect(toggleApp(d, salon, 'booking', false)).toBe(d);
    const { request } = buildOnboardingRequest(d, salon);
    const issues = validateOnboardingRequest({ ...request, apps: { add: [], remove: ['booking'] } }, { pack: salon, plan: plan() });
    expect(issues.some((i) => i.step === 'apps' && i.severity === 'error')).toBe(true);
  });

  it('messaging / AI: WhatsApp stays "not connected" and AI is only sent when installed', () => {
    let d = toggleApp(filledDraft('salon'), salon, 'messaging', true);
    d = toggleApp(d, salon, 'ai-receptionist', true);
    const { request, apps } = buildOnboardingRequest(d, salon);
    expect(visibleWizardSteps(salon, apps)).toContain('ai');
    expect(request.ai).toMatchObject({ businessName: 'Salon Nour', locale: 'ar-EG' });
    const issues = validateOnboardingRequest(request, { pack: salon, plan: plan() });
    expect(issues.find((i) => i.step === 'ai')).toMatchObject({ severity: 'attention' });
    expect(hasBlockingIssues(issues)).toBe(false);
  });
});

describe('plan limits', () => {
  it('blocks more branches than the plan allows', () => {
    const d = addBranch(filledDraft());
    const two = { ...d, branches: d.branches.map((b, i) => ({ ...b, branchName: `B${i}` })) };
    const { request } = buildOnboardingRequest(two, salon);
    const issues = validateOnboardingRequest(request, { pack: salon, plan: plan({ maxBranches: 1 }) });
    expect(issues.some((i) => i.step === 'branches' && i.field === 'branches')).toBe(true);
    expect(hasBlockingIssues(validateOnboardingRequest(request, { pack: salon, plan: plan({ maxBranches: 2 }) }))).toBe(false);
  });

  it('counts the owner toward the plan user limit', () => {
    const user = (n: number) => ({ ...emptyUser(), displayName: `U${n}`, loginName: `user${n}`, password: 'Password1', roleKey: 'cashier' });
    const d = { ...filledDraft(), users: [user(1), user(2), user(3)] };
    const { request } = buildOnboardingRequest(d, salon);
    expect(validateOnboardingRequest(request, { pack: salon, plan: plan({ maxUsers: 3 }) }).some((i) => i.field === 'users')).toBe(true);
    expect(validateOnboardingRequest(request, { pack: salon, plan: plan({ maxUsers: 4 }) }).some((i) => i.field === 'users')).toBe(false);
  });

  it('removing a branch re-points rows to the first branch', () => {
    let d = addBranch(filledDraft());
    d = { ...d, users: [{ ...emptyUser(), branchIndex: 1 }] };
    expect(removeBranch(d, 1).users[0]!.branchIndex).toBe(0);
    expect(removeBranch(d, 0)).toBe(d);
  });
});

describe('request parsing', () => {
  it('rejects system-controlled fields anywhere in the request', () => {
    const body = JSON.parse(JSON.stringify(buildOnboardingRequest(filledDraft(), salon).request));
    expect(() => parseOnboardingRequest({ ...body, tenantId: 'x' })).toThrow();
    expect(() => parseOnboardingRequest({ ...body, users: [{ ...emptyUser(), userLevel: 'admin' }] })).toThrow();
    expect(() => parseOnboardingRequest({ ...body, booking: [{ branchCode: 'X', bookingEnabled: true }] })).toThrow();
    expect(() => parseOnboardingRequest({ ...body, ai: { businessName: 'x', locale: 'ar', enabled: true } })).toThrow();
    expect(parseOnboardingRequest(body).business.tenantCode).toBe(body.business.tenantCode);
  });

  it('suggests safe uppercase codes and never CASHER_BOOT', () => {
    expect(suggestTenantCode('Salon Nour')).toBe('SALON_NOUR');
    expect(suggestTenantCode('صالون نور')).toMatch(/^[A-Z][A-Z0-9_]{2,}$/);
    expect(suggestTenantCode('casher boot')).not.toBe('CASHER_BOOT');
  });
});

describe('coordinator', () => {
  const TENANT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  function coreResult(input: ProvisionTenantInput): ProvisionTenantResult {
    return {
      tenantId: TENANT,
      tenantCode: input.tenantCode,
      locationId: 'loc',
      membershipId: 'mem',
      legacyBranchId: 900,
      legacyUserId: 901,
      branchCode: input.firstBranchCode,
      ownerLoginName: input.ownerLoginName,
      ownerRole: 'admin',
      ownerUserLevel: 'admin',
      industryPackCode: input.industryPack.packCode,
      apps: ['booking', 'pos', 'queue'],
      planCode: 'starter',
      subscriptionStatus: 'trial',
      trialEndsAt: null,
      readiness: { tenantId: TENANT, tenantCode: input.tenantCode, overall: 'PASS', checks: [] },
    } as unknown as ProvisionTenantResult;
  }

  async function setup(failStage?: string) {
    const { onboardBusiness, retryOnboardingSetup } = await import('@/platform/onboarding/wizard/coordinator');
    const core = vi.fn(async (input: ProvisionTenantInput) => coreResult(input));
    const ran: Array<{ stage: string; tenantId: string }> = [];
    let failing = failStage;
    const stage = (name: string) => async (ctx: { tenantId: string }) => {
      ran.push({ stage: name, tenantId: ctx.tenantId });
      if (failing === name) throw Object.assign(new Error(`${name} failed`), { code: 'X' });
      return { created: 1, existing: 0 };
    };
    const bootstrapChecks: string[] = [];
    const deps = {
      findPack: findIndustryPack,
      loadPlans: async () => [plan({ maxBranches: 3, maxUsers: 5 })],
      provisionCore: core,
      loadTarget: async (tenantId: string) => ({
        tenantId,
        tenantCode: 'SALON_NOUR',
        packCode: 'salon',
        apps: ['booking', 'pos', 'queue'],
        planCode: 'starter',
        subscriptionStatus: 'trial',
        trialEndsAt: null,
        branchIds: new Map([['SALON_NOUR_1', 900]]),
      }),
      findOwnerUserId: async () => 901,
      assertNotBootstrap: async (tenantId: string) => {
        bootstrapChecks.push(tenantId);
      },
      evaluateReadiness: async () => null,
      stages: {
        branches: stage('branches'),
        services: stage('services'),
        team: stage('team'),
        users: stage('users'),
        booking: stage('booking'),
        ai: stage('ai'),
      },
    };
    let d = addBranch(filledDraft());
    d = {
      ...d,
      branches: d.branches.map((b, i) => ({ ...b, branchName: `B${i}` })),
      services: [{ ...emptyService(), name: 'Cut', price: 100 }],
      employees: [{ name: 'Ali', job: 'حلاق', branchIndex: 1, active: true }],
    };
    const { request } = buildOnboardingRequest(d, salon);
    return {
      onboardBusiness,
      retryOnboardingSetup,
      core,
      ran,
      deps,
      request,
      bootstrapChecks,
      heal: () => {
        failing = undefined;
      },
    };
  }

  it('creates the core once, then runs tenant-scoped stages with the new tenant id', async () => {
    const t = await setup();
    const result = await t.onboardBusiness(t.request, { actorUserId: 1, actorUserName: 'op' }, t.deps);
    expect(t.core).toHaveBeenCalledTimes(1);
    const input = t.core.mock.calls[0]![0];
    expect(input).toMatchObject({ tenantCode: 'SALON_NOUR', firstBranchCode: 'SALON_NOUR_1', planCode: 'starter' });
    expect(result.complete).toBe(true);
    expect(t.ran.map((r) => r.stage)).toEqual(['branches', 'services', 'team', 'booking']);
    expect(t.ran.every((r) => r.tenantId === TENANT)).toBe(true);
    expect(JSON.stringify(result)).not.toContain(t.request.owner.password);
  });

  it('does not create anything when validation fails', async () => {
    const t = await setup();
    const bad = { ...t.request, owner: { ...t.request.owner, password: 'short' } };
    await expect(t.onboardBusiness(bad, { actorUserId: 1, actorUserName: 'op' }, t.deps)).rejects.toMatchObject({
      code: 'ONBOARDING_PLAN_INVALID',
    });
    expect(t.core).not.toHaveBeenCalled();
  });

  it('reports a failed stage, blocks branch-dependent stages, and retry never re-creates the tenant', async () => {
    const t = await setup('branches');
    const first = await t.onboardBusiness(t.request, { actorUserId: 1, actorUserName: 'op' }, t.deps);
    expect(first.complete).toBe(false);
    const byStage = Object.fromEntries(first.stages.map((s) => [s.stage, s.status]));
    expect(byStage).toMatchObject({ branches: 'failed', services: 'done', team: 'blocked', booking: 'blocked' });

    t.heal();
    const retry = await t.retryOnboardingSetup(TENANT, t.request, { actorUserId: 1, actorUserName: 'op' }, t.deps);
    expect(retry.complete).toBe(true);
    expect(t.core).toHaveBeenCalledTimes(1);
    expect(t.bootstrapChecks).toEqual([TENANT]);
    expect(retry.core.tenantId).toBe(TENANT);
  });

  it('retry refuses setup data that belongs to a different business', async () => {
    const t = await setup();
    const other = { ...t.request, business: { ...t.request.business, tenantCode: 'OTHER_BIZ' } };
    await expect(
      t.retryOnboardingSetup(TENANT, other, { actorUserId: 1, actorUserName: 'op' }, t.deps),
    ).rejects.toMatchObject({ code: 'ONBOARDING_TARGET_INVALID' });
    expect(t.ran).toEqual([]);
  });
});

describe('static guards', () => {
  const WIZARD_FILES = [
    'src/platform/onboarding/wizard/setupStages.ts',
    'src/platform/onboarding/wizard/coordinator.ts',
    'src/platform/onboarding/wizard/preflight.ts',
    'src/platform/onboarding/wizard/plan.ts',
    'src/platform/onboarding/wizard/draft.ts',
    'src/app/api/admin/platform/tenants/onboarding/route.ts',
    'src/app/api/admin/platform/tenants/onboarding/preflight/route.ts',
    'src/app/api/admin/platform/tenants/[tenantId]/onboarding-setup/route.ts',
    'src/components/platform/onboarding/OnboardingWizard.tsx',
    'src/components/platform/onboarding/OnboardingSteps.tsx',
    'src/components/platform/onboarding/OnboardingResultViews.tsx',
  ];

  it('DRVOWA stays CASHER_BOOT-only: onboarding never binds or reuses a messaging channel', () => {
    for (const rel of WIZARD_FILES) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/drvowa|TenantMessagingChannel|bindTenantWhatsAppChannel|BOOTSTRAP_TENANT_CODE|CASHER_BOOT/i);
    }
    expect(read('src/lib/integrations/drvowaTenant.ts')).toContain('drvowa-instance-channel');
  });

  it('the legacy POST /api/admin/platform/tenants contract is unchanged', () => {
    const route = read('src/app/api/admin/platform/tenants/route.ts');
    expect(route).toContain('await provisionTenant(');
    expect(route).toContain('rejectSystemControlledFields');
    const types = read('src/platform/onboarding/types.ts');
    expect(types).toMatch(/firstBranchShortName\?:/);
    expect(types).toMatch(/firstBranchTimezone\?:/);
  });

  it('passwords are hashed by the existing user services and never persisted by the wizard', () => {
    expect(read('src/platform/onboarding/provisionTenant.ts')).toContain('hashPassword(');
    expect(read('src/lib/tenant/tenantStaffUsers.ts')).toContain('hashPassword(');
    for (const rel of WIZARD_FILES) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/INSERT INTO dbo\.TblUser\b|localStorage|sessionStorage/);
    }
  });

  it('services are only ever written with the target tenant id (no copy from another tenant)', () => {
    const src = read('src/platform/onboarding/wizard/setupStages.ts');
    expect(src).not.toMatch(/INSERT INTO dbo\.TblPro[^;]*SELECT/);
    for (const m of src.matchAll(/(?:SELECT|UPDATE)[^`]*?(TblPro|TblCat|TblEmp)\b[^`]*`/g)) {
      expect(m[0]).toContain('TenantId = @tenantId');
    }
  });

  it('new platform routes are operator-only', () => {
    for (const rel of WIZARD_FILES.filter((f) => f.includes('/api/'))) {
      expect(read(rel), rel).toContain('await requirePlatformOperator()');
    }
  });
});
