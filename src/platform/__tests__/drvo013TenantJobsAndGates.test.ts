/**
 * DRVO-013 — tenant-safe system jobs and app gates over a fake SQL layer.
 * Tenants: A (salon, active), B (salon, active), C (subscription inactive), BOOT (CASHER_BOOT, loyalty).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const BOOT = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const db = vi.hoisted(() => ({
  tenants: [] as Array<{ TenantId: string; Code: string; Status: string }>,
  locations: [] as Array<{ TenantId: string; LegacyBranchId: number; BranchCode: string; Status: string }>,
}));

vi.mock('@/lib/db', () => {
  const same = (a: unknown, b: unknown) => String(a).toLowerCase() === String(b).toLowerCase();
  const typeFn = () => ({});
  const sql = { Int: typeFn, UniqueIdentifier: typeFn, NVarChar: typeFn, MAX: -1 };
  function run(text: string, p: Record<string, unknown>) {
    const t = text.replace(/\s+/g, ' ');
    if (/FROM dbo\.Tenant t LEFT JOIN dbo\.Location l/.test(t)) {
      const rows: unknown[] = [];
      for (const tenant of [...db.tenants].sort((x, y) => x.Code.localeCompare(y.Code))) {
        if (tenant.Status !== 'active') continue;
        if (p.tenantId && !same(tenant.TenantId, p.tenantId)) continue;
        const locs = db.locations.filter((l) => same(l.TenantId, tenant.TenantId) && l.Status === 'active');
        if (locs.length === 0) rows.push({ TenantId: tenant.TenantId.toUpperCase(), Code: tenant.Code, LegacyBranchId: null });
        for (const l of locs) rows.push({ TenantId: tenant.TenantId.toUpperCase(), Code: tenant.Code, LegacyBranchId: l.LegacyBranchId });
      }
      return { recordset: rows };
    }
    if (/FROM dbo\.Location l INNER JOIN dbo\.Tenant t/.test(t)) {
      const rows = db.locations
        .filter((l) => l.Status === 'active' && l.LegacyBranchId === p.branchId)
        .map((l) => {
          const tenant = db.tenants.find((x) => same(x.TenantId, l.TenantId) && x.Status === 'active');
          return tenant
            ? { TenantId: l.TenantId.toUpperCase(), Code: tenant.Code, LocationId: `loc-${l.LegacyBranchId}`, LegacyBranchId: l.LegacyBranchId, BranchCode: l.BranchCode, Timezone: 'Africa/Cairo' }
            : null;
        })
        .filter(Boolean);
      return { recordset: rows };
    }
    throw new Error(`fake db: unhandled query ${t.slice(0, 100)}`);
  }
  const pool = {
    request() {
      const params: Record<string, unknown> = {};
      const req = {
        input(name: string, _type: unknown, value?: unknown) {
          params[name] = value;
          return req;
        },
        async query(text: string) {
          return run(text, params);
        },
      };
      return req;
    },
  };
  return { sql, getPool: vi.fn(async () => pool) };
});

const apps = vi.hoisted(() => ({ installed: {} as Record<string, string[]> }));
const subs = vi.hoisted(() => ({ active: {} as Record<string, boolean> }));

vi.mock('@/platform/apps/tenantApps', () => ({
  listTenantApps: vi.fn(async (tenantId: string) =>
    (apps.installed[tenantId] ?? []).map((appCode) => ({ appCode, status: 'installed' })),
  ),
  installedAppCodes: (rows: Array<{ appCode: string }>) => rows.map((r) => r.appCode),
}));
vi.mock('@/platform/commercial/planRepository', () => ({
  getTenantSubscription: vi.fn(async (_db: unknown, tenantId: string) =>
    subs.active[tenantId] ? { tenantId, planCode: 'starter' } : null,
  ),
  getPlan: vi.fn(async () => ({ code: 'starter' })),
}));
vi.mock('@/platform/commercial/subscriptionLifecycle', () => ({
  evaluateSubscription: (sub: unknown) =>
    sub ? { allowed: true, reason: 'ACTIVE' } : { allowed: false, reason: 'NO_SUBSCRIPTION' },
}));

import {
  listTenantJobTargets,
  runTenantJobFanout,
  tenantJobScopeFor,
} from '@/platform/tenant/tenantJobFanout';
import {
  assertRouteAppEntitlement,
  isAppInstalledForBranchTenant,
  resetTenantAccessGate,
  TenantAccessDeniedError,
} from '@/platform/commercial/tenantAccessGate';
import { assertCanInstall, resolveTenantComposition } from '@/platform/apps/compositionResolver';
import { SALON_PACK } from '@/packs/salon/manifest';
import { TenantAppError } from '@/platform/apps/errors';

const SALON_APPS = ['booking', 'queue', 'pos', 'attendance', 'payroll', 'treasury', 'reports'];

beforeEach(() => {
  db.tenants = [
    { TenantId: A, Code: 'TENANT_A', Status: 'active' },
    { TenantId: B, Code: 'TENANT_B', Status: 'active' },
    { TenantId: C, Code: 'TENANT_C', Status: 'active' },
    { TenantId: BOOT, Code: 'CASHER_BOOT', Status: 'active' },
  ];
  db.locations = [
    { TenantId: A, LegacyBranchId: 1, BranchCode: 'A-1', Status: 'active' },
    { TenantId: A, LegacyBranchId: 2, BranchCode: 'A-2', Status: 'active' },
    { TenantId: B, LegacyBranchId: 7, BranchCode: 'B-7', Status: 'active' },
    { TenantId: B, LegacyBranchId: 8, BranchCode: 'B-8', Status: 'inactive' },
    { TenantId: C, LegacyBranchId: 9, BranchCode: 'C-9', Status: 'active' },
    { TenantId: BOOT, LegacyBranchId: 100, BranchCode: 'GLEEM', Status: 'active' },
  ];
  apps.installed = {
    [A]: SALON_APPS,
    [B]: SALON_APPS.filter((a) => a !== 'payroll'),
    [C]: SALON_APPS,
    [BOOT]: [...SALON_APPS, 'loyalty'],
  };
  subs.active = { [A]: true, [B]: true, [C]: false, [BOOT]: true };
  resetTenantAccessGate();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('DRVO-013 cron fan-out is tenant-safe', () => {
  it('a cron bearer fans out over every eligible tenant; each run sees only its own branches', async () => {
    const seen: Array<{ tenant: string; branches: number[] }> = [];
    const { outcomes, skipped } = await runTenantJobFanout(
      { scope: { kind: 'all_tenants' }, job: 'test' },
      async (t) => {
        seen.push({ tenant: t.tenantId, branches: t.branchIds });
        return t.branchIds.length;
      },
    );
    expect(seen).toEqual([
      { tenant: BOOT, branches: [100] },
      { tenant: A, branches: [1, 2] },
      { tenant: B, branches: [7] },
    ]);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(skipped).toEqual([{ tenantId: C, tenantCode: 'TENANT_C', reason: 'SUBSCRIPTION_INACTIVE' }]);
  });

  it('the commercial app check skips tenants without the app', async () => {
    const { targets, skipped } = await listTenantJobTargets({ scope: { kind: 'all_tenants' }, app: 'payroll' });
    expect(targets.map((t) => t.tenantId)).toEqual([BOOT, A]);
    expect(skipped.map((s) => [s.tenantId, s.reason])).toEqual([
      [B, 'APP_NOT_INSTALLED'],
      [C, 'SUBSCRIPTION_INACTIVE'],
    ]);
  });

  it('an admin session only ever runs its own tenant', async () => {
    const scope = tenantJobScopeFor({ via: 'session', tenantId: A.toUpperCase() });
    expect(scope).toEqual({ kind: 'single_tenant', tenantId: A });
    const { targets } = await listTenantJobTargets({ scope });
    expect(targets).toEqual([{ tenantId: A, tenantCode: 'TENANT_A', branchIds: [1, 2] }]);
  });

  it('a session job without a tenant is refused; a cron bearer is all-tenants', () => {
    expect(() => tenantJobScopeFor({ via: 'session', tenantId: null })).toThrow();
    expect(tenantJobScopeFor({ via: 'cron_bearer', tenantId: null })).toEqual({ kind: 'all_tenants' });
  });

  it('a tenant without active locations is skipped, and one tenant failing never stops the others', async () => {
    db.locations = db.locations.filter((l) => l.TenantId !== B);
    const { outcomes, skipped } = await runTenantJobFanout(
      { scope: { kind: 'all_tenants' }, job: 'test' },
      async (t) => {
        if (t.tenantId === BOOT) throw new Error('boom');
        return 'ok';
      },
    );
    expect(outcomes.map((o) => [o.tenantId, o.ok])).toEqual([
      [BOOT, false],
      [A, true],
    ]);
    expect(skipped.map((s) => s.reason).sort()).toEqual(['NO_ACTIVE_LOCATION', 'SUBSCRIPTION_INACTIVE']);
  });
});

describe('DRVO-013 route-family app gate', () => {
  it('denies an app-family route when the tenant lacks the app, allows it when installed', async () => {
    await expect(assertRouteAppEntitlement(B, '/api/payroll/daily/generate')).rejects.toMatchObject({
      code: 'APP_NOT_INSTALLED',
    });
    await expect(assertRouteAppEntitlement(A, '/api/payroll/daily/generate')).resolves.toBe('payroll');
  });

  it('core routes and requests without a path are not app-gated', async () => {
    await expect(assertRouteAppEntitlement(B, '/api/customers')).resolves.toBeNull();
    await expect(assertRouteAppEntitlement(B, null)).resolves.toBeNull();
  });

  it('withTenantApp gates any tenant-checked auth result', async () => {
    const { withTenantApp } = await import('@/lib/api-auth');
    const okA = await withTenantApp('payroll', Promise.resolve({ ok: true as const, tenantId: A }));
    expect(okA).toEqual({ ok: true, tenantId: A });

    const deniedB = await withTenantApp('payroll', Promise.resolve({ ok: true as const, tenantId: B }));
    expect(deniedB).toBeInstanceOf(NextResponse);
    expect((deniedB as NextResponse).status).toBe(403);
    expect(await (deniedB as NextResponse).json()).toMatchObject({ code: 'APP_NOT_INSTALLED' });

    const noTenant = await withTenantApp('payroll', Promise.resolve({ ok: true as const, tenantId: null }));
    expect((noTenant as NextResponse).status).toBe(403);

    const upstream = NextResponse.json({}, { status: 401 });
    expect(await withTenantApp('payroll', Promise.resolve(upstream))).toBe(upstream);
  });
});

describe('DRVO-013 Loyalty is CASHER_BOOT-only in V1 (fail closed)', () => {
  it('cannot be installed or added at onboarding for any tenant', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
        return null;
      } catch (err) {
        return err instanceof TenantAppError ? err.code : String(err);
      }
    };
    expect(code(() => assertCanInstall(SALON_APPS, 'loyalty'))).toBe('APP_NOT_AVAILABLE');
    expect(code(() => resolveTenantComposition(SALON_PACK, { add: ['loyalty'] }))).toBe('APP_NOT_AVAILABLE');
    expect(resolveTenantComposition(SALON_PACK).apps).not.toContain('loyalty');
  });

  it('Loyalty routes deny tenants without Loyalty; CASHER_BOOT keeps them', async () => {
    await expect(assertRouteAppEntitlement(A, '/api/loyalty/clients')).rejects.toBeInstanceOf(TenantAccessDeniedError);
    await expect(assertRouteAppEntitlement(A, '/api/pos/voucher')).rejects.toBeInstanceOf(TenantAccessDeniedError);
    await expect(assertRouteAppEntitlement(BOOT, '/api/loyalty/clients')).resolves.toBe('loyalty');
  });

  it('POS loyalty earn runs only for a branch whose tenant has Loyalty; unknown branches fail closed', async () => {
    expect(await isAppInstalledForBranchTenant(100, 'loyalty')).toBe(true);
    expect(await isAppInstalledForBranchTenant(1, 'loyalty')).toBe(false);
    expect(await isAppInstalledForBranchTenant(8, 'loyalty')).toBe(false);
    expect(await isAppInstalledForBranchTenant(404, 'loyalty')).toBe(false);
  });
});

describe('DRVO-013 auto-absence route: cross-tenant branch is not reachable', () => {
  it('an admin of tenant A cannot scan a branch of tenant B; a cron bearer scans each tenant separately', async () => {
    vi.resetModules();
    const scans: number[] = [];
    vi.doMock('@/lib/hr/attendance/autoAbsence', () => ({
      runAutoAbsenceScan: vi.fn(async (args: { branchId: number }) => {
        scans.push(args.branchId);
        return { processed: 1, markedAbsent: 0, bookingsMarked: 0 };
      }),
    }));
    const auth = { via: 'session' as 'session' | 'cron_bearer', tenantId: A as string | null };
    vi.doMock('@/lib/api-auth', () => ({
      requireSystemJobAuth: vi.fn(async () => ({ ok: true, userId: 1, ...auth })),
    }));
    const { POST } = await import('@/app/api/admin/attendance/auto-absence/run/route');
    const req = (body: unknown) =>
      new Request('http://x/api/admin/attendance/auto-absence/run', {
        method: 'POST',
        body: JSON.stringify(body),
      }) as unknown as Parameters<typeof POST>[0];

    const cross = await POST(req({ branchId: 7 }));
    expect(cross.status).toBe(404);
    expect(scans).toEqual([]);

    const own = await POST(req({}));
    expect(own.status).toBe(200);
    expect(scans).toEqual([1, 2]);

    scans.length = 0;
    auth.via = 'cron_bearer';
    auth.tenantId = null;
    const cron = await POST(req({}));
    const body = await cron.json();
    expect(scans.sort((x, y) => x - y)).toEqual([1, 2, 7, 100]);
    expect(body.skippedTenants).toEqual([{ tenantId: C, tenantCode: 'TENANT_C', reason: 'SUBSCRIPTION_INACTIVE' }]);
    vi.doUnmock('@/lib/hr/attendance/autoAbsence');
    vi.doUnmock('@/lib/api-auth');
  });
});
