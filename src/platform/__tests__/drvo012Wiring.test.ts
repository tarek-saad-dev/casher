import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkImportBoundaries } from '@/platform/internal/importBoundaries';

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const PLATFORM_ROUTES = [
  'src/app/api/admin/platform/plans/route.ts',
  'src/app/api/admin/platform/packs/route.ts',
  'src/app/api/admin/platform/apps/route.ts',
  'src/app/api/admin/platform/tenants/route.ts',
  'src/app/api/admin/platform/tenants/[tenantId]/subscription/route.ts',
  'src/app/api/admin/platform/tenants/[tenantId]/commercial-access/route.ts',
  'src/app/api/admin/platform/tenants/[tenantId]/apps/route.ts',
  'src/app/api/admin/platform/tenants/[tenantId]/apps/install/route.ts',
  'src/app/api/admin/platform/tenants/[tenantId]/apps/uninstall/route.ts',
  'src/app/api/admin/platform/tenants/[tenantId]/apps/apply-pack/route.ts',
  'src/app/api/admin/platform/tenants/[tenantId]/readiness/route.ts',
];

const TENANT_SERVICES = [
  'src/platform/apps/tenantApps.ts',
  'src/platform/commercial/subscriptionService.ts',
  'src/platform/commercial/limits.ts',
];

function sqlBlocks(source: string): string[] {
  return [...source.matchAll(/`([\s\S]*?)`/g)]
    .map((m) => m[1])
    .filter((s) => /\b(SELECT|INSERT|UPDATE|DELETE)\b/.test(s));
}

describe('DRVO-012 platform operator authorization', () => {
  it('every DRVO-012 platform route requires the platform operator', () => {
    for (const rel of PLATFORM_ROUTES) {
      const src = read(rel);
      const handlers = src.match(/export async function (GET|POST|PATCH|PUT|DELETE)/g) ?? [];
      const guards = src.match(/await requirePlatformOperator\(\)/g) ?? [];
      expect(handlers.length, rel).toBeGreaterThan(0);
      expect(guards.length, rel).toBe(handlers.length);
    }
  });

  it('onboarding still rejects browser-supplied system fields, including commercial ones', () => {
    const route = read('src/app/api/admin/platform/tenants/route.ts');
    expect(route).toContain('rejectSystemControlledFields');
    for (const field of ["'status'", "'entitlements'", "'origin'", "'trialEndsAt'"]) {
      expect(route).toContain(field);
    }
  });

  it('tenant-scoped routes validate the tenant id as a UUID', () => {
    for (const rel of PLATFORM_ROUTES.filter((r) => r.includes('[tenantId]'))) {
      expect(read(rel), rel).toContain('invalidTenantIdResponse(tenantId)');
    }
  });

  it('request helpers reject malformed JSON and non-array customizations', async () => {
    const { readJsonBody, readStringArray, PlatformRequestError, platformErrorResponse } = await import(
      '@/app/api/admin/platform/_shared/platformErrors'
    );
    await expect(readJsonBody(new Request('http://x', { method: 'POST', body: '{bad' }))).rejects.toBeInstanceOf(
      PlatformRequestError,
    );
    await expect(readJsonBody(new Request('http://x', { method: 'POST', body: '[]' }))).rejects.toBeInstanceOf(
      PlatformRequestError,
    );
    expect(readStringArray(undefined)).toEqual([]);
    expect(readStringArray(['pos'])).toEqual(['pos']);
    expect(() => readStringArray('pos', 'add')).toThrow(PlatformRequestError);
    expect(() => readStringArray([1], 'add')).toThrow(PlatformRequestError);
    expect(platformErrorResponse(new PlatformRequestError('x'))?.status).toBe(400);
  });

  it('subscription PATCH rejects system fields and misplaced currentPeriodEndsAt', () => {
    const src = read('src/app/api/admin/platform/tenants/[tenantId]/subscription/route.ts');
    expect(src).toContain('SYSTEM_FIELDS');
    expect(src).toMatch(/currentPeriodEndsAt is only accepted with action activate or reactivate/);
    expect(src).toContain('Number.isInteger(expectedRevision)');
  });

  it('tenant-scoped routes take tenantId from the path, never the body', () => {
    for (const rel of PLATFORM_ROUTES.filter((r) => r.includes('[tenantId]'))) {
      const src = read(rel);
      expect(src, rel).toContain('await params');
      expect(src, rel).not.toMatch(/body\.tenantId/);
    }
  });
});

describe('DRVO-012 tenant scoping and concurrency', () => {
  it('every tenant-state SQL statement in the new services filters by TenantId', () => {
    for (const rel of TENANT_SERVICES) {
      for (const block of sqlBlocks(read(rel))) {
        if (/sp_getapplock/.test(block)) continue;
        if (!/(TenantAppEntitlement|TenantSubscription|TenantIndustryPack|SalonPackConfig|Location|TenantMembership)/.test(block)) {
          continue;
        }
        const scoped = /^\s*INSERT\b/i.test(block)
          ? /VALUES\s*\(\s*@tenantId\b|SELECT\s+@tenantId\b/i
          : /TenantId\s*=\s*@tenantId/;
        expect(block, `${rel}: ${block.slice(0, 120)}`).toMatch(scoped);
      }
    }
  });

  it('mutations take the tenant commercial applock', () => {
    expect(read('src/platform/apps/tenantApps.ts')).toContain('acquireTenantApplock');
    expect(read('src/platform/commercial/subscriptionService.ts')).toContain('acquireTenantApplock');
    expect(read('src/platform/commercial/limits.ts')).toContain('acquireTenantApplock');
  });

  it('safe disable: tenant app services never delete rows', () => {
    for (const rel of TENANT_SERVICES) {
      expect(read(rel), rel).not.toMatch(/DELETE\s+FROM/i);
    }
  });

  it('keeps platform import boundaries (platform never imports packs)', () => {
    expect(checkImportBoundaries()).toEqual([]);
  });
});

describe('DRVO-012 onboarding', () => {
  it('provisions from pack composition with plan, subscription and in-transaction limits', () => {
    const src = read('src/platform/onboarding/provisionTenant.ts');
    expect(src).toContain('resolveTenantComposition');
    expect(src).toContain('createOnboardingSubscriptionInTransaction');
    expect(src).toContain('assertCanAddBranch');
    expect(src).toContain('assertCanAddUser');
    expect(src).toContain('DEFAULT_ONBOARDING_PLAN_CODE');
    expect(src.indexOf('resolveTenantComposition(')).toBeLessThan(src.indexOf('tx.begin()'));
    expect(src).not.toMatch(/['"]GLEEM['"]|cut-club|CAMP_CAESAR/);
  });

  it('defaults new tenants to the starter plan', async () => {
    const { DEFAULT_ONBOARDING_PLAN_CODE } = await import('@/platform/commercial/types');
    expect(DEFAULT_ONBOARDING_PLAN_CODE).toBe('starter');
  });

  it('new-tenant composition never writes the operations surface as an app', () => {
    const src = read('src/platform/apps/tenantApps.ts');
    expect(src).not.toContain("'operations'");
    expect(src).toContain('isInstallableAppCode');
  });

  it('bootstrap seed behavior is unchanged and still covers every registered app', () => {
    const seed = read('src/platform/registry/seedTenantRegistry.ts');
    expect(seed).toContain('APP_REGISTRY_CODES.map');
    expect(seed).toContain('INSERT INTO dbo.TenantAppEntitlement (TenantId, AppCode, Enabled)');
    expect(read('scripts/drvo/platformBootstrap.ts')).toContain('seedTenantRegistry(tx, tenantId');
  });
});

describe('DRVO-012 limit enforcement scope (wired by DRVO-013 on the authoritative tenant)', () => {
  it('staff branch/user creation enforces limits for the resolved tenant, never a default tenant', () => {
    const provisioning = read('src/lib/branch/branchProvisioningService.ts');
    expect(provisioning).toMatch(/assertCanAddBranch\(tx, tenantId\)/);
    expect(read('src/app/api/admin/branches/provision/route.ts')).toContain('tenantId: admin.tenantId');

    const staffUsers = read('src/lib/tenant/tenantStaffUsers.ts');
    expect(staffUsers).toMatch(/assertCanAddUser\(tx, input\.tenantId\)/);
    const usersRoute = read('src/app/api/users/route.ts');
    expect(usersRoute).toContain('createTenantStaffUser');
    expect(usersRoute).not.toMatch(/assertCanAdd(Branch|User)/);

    for (const src of [provisioning, staffUsers, usersRoute]) {
      expect(src).not.toMatch(/resolveBootstrapTenantId|BOOTSTRAP_TENANT_CODE|resolveLegacyBootstrapTenantId/);
    }
  });

  it('legacy branch bootstrap stays outside commercial limits', () => {
    expect(read('src/lib/branch/bootstrap.ts')).not.toMatch(/assertCanAdd(Branch|User)|canCreate(Branch|User)/);
  });

  it('has no broad fail-open for missing SaaS tables', () => {
    for (const rel of [
      'src/platform/commercial/limits.ts',
      'src/platform/commercial/subscriptionService.ts',
      'src/platform/apps/tenantApps.ts',
    ]) {
      expect(read(rel), rel).not.toMatch(/Invalid object name|catch\s*\{\s*return\s+(true|\{\s*allowed:\s*true)/);
    }
  });
});
