/**
 * Agent 5 QA: fail-closed, cross-tenant route entitlement regression.
 * Deterministic fixtures only: no network, SQL or production data.
 *
 * This tests the authoritative application gate, not end-to-end API authentication.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const fixture = vi.hoisted(() => ({
  apps: {} as Record<string, Array<{ appCode: string; status: 'installed' | 'disabled' }>>,
  reads: [] as string[],
}));

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(async () => { throw new Error('QA fixture must not connect to a database'); }),
  sql: { Int: () => ({}), UniqueIdentifier: () => ({}), NVarChar: () => ({}) },
}));
vi.mock('@/platform/apps/tenantApps', () => ({
  listTenantApps: vi.fn(async (tenantId: string) => {
    fixture.reads.push(tenantId);
    return fixture.apps[tenantId] ?? [];
  }),
  installedAppCodes: (rows: Array<{ appCode: string; status: string }>) =>
    rows.filter((row) => row.status === 'installed').map((row) => row.appCode).sort(),
}));
vi.mock('@/platform/commercial/planRepository', () => ({
  getTenantSubscription: vi.fn(),
  getPlan: vi.fn(),
}));

import {
  assertRouteAppEntitlement,
  assertTenantAppInstalled,
  invalidateTenantAccessGate,
  resetTenantAccessGate,
  TenantAccessDeniedError,
} from '@/platform/commercial/tenantAccessGate';
import { resolveRouteAppCode } from '@/platform/commercial/routeAppFamilies';

beforeEach(() => {
  fixture.apps = {
    [A]: [{ appCode: 'booking', status: 'installed' }, { appCode: 'pos', status: 'installed' }],
    [B]: [{ appCode: 'pos', status: 'installed' }, { appCode: 'loyalty', status: 'installed' }],
  };
  fixture.reads = [];
  resetTenantAccessGate();
});

describe('QA cross-tenant app entitlement contract', () => {
  it('does not reuse tenant A entitlement for tenant B, even in concurrent requests', async () => {
    const outcomes = await Promise.allSettled([
      assertRouteAppEntitlement(A, '/api/bookings/123/convert'),
      assertRouteAppEntitlement(B, '/api/bookings/123/convert'),
      assertRouteAppEntitlement(B, '/api/sales/recent'),
      assertRouteAppEntitlement(A, '/api/sales/recent'),
    ]);
    expect(outcomes[0]).toMatchObject({ status: 'fulfilled', value: 'booking' });
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'APP_NOT_INSTALLED' } });
    expect(outcomes[2]).toMatchObject({ status: 'fulfilled', value: 'pos' });
    expect(outcomes[3]).toMatchObject({ status: 'fulfilled', value: 'pos' });
    // Concurrent cache misses may independently load the same tenant; only isolation matters.
    expect(new Set(fixture.reads)).toEqual(new Set([A, B]));
  });

  it('denies alternate loyalty APIs even when the POS app itself is installed', async () => {
    const aliases = [
      '/api/pos/voucher/redeem',
      '/api/pos/client-inventory/use',
      '/api/pos/client-inventory-by-phone',
      '/api/admin/store/items',
      '/api/loyalty/clients',
    ];
    for (const route of aliases) {
      expect(resolveRouteAppCode(route), route).toBe('loyalty');
      await expect(assertRouteAppEntitlement(A, route), route).rejects.toMatchObject({
        code: 'APP_NOT_INSTALLED',
        status: 403,
      });
      await expect(assertRouteAppEntitlement(B, route), route).resolves.toBe('loyalty');
    }
  });

  it('denies both disabled and absent app entitlements, including direct app gate', async () => {
    fixture.apps[A].push({ appCode: 'payroll', status: 'disabled' });
    await expect(assertTenantAppInstalled(A, 'payroll')).rejects.toBeInstanceOf(TenantAccessDeniedError);
    await expect(assertRouteAppEntitlement(A, '/api/admin/hr/employee-ledger/payout')).rejects.toMatchObject({
      code: 'APP_NOT_INSTALLED',
    });
    await expect(assertRouteAppEntitlement(A, '/api/queue/estimate')).rejects.toMatchObject({
      code: 'APP_NOT_INSTALLED',
    });
  });

  it('invalidating tenant A entitlement cannot grant it an app or affect tenant B', async () => {
    await expect(assertTenantAppInstalled(A, 'booking')).resolves.toBeUndefined();
    await expect(assertTenantAppInstalled(B, 'pos')).resolves.toBeUndefined();
    fixture.apps[A] = [{ appCode: 'booking', status: 'disabled' }];
    invalidateTenantAccessGate(A);
    await expect(assertTenantAppInstalled(A, 'booking')).rejects.toMatchObject({ code: 'APP_NOT_INSTALLED' });
    await expect(assertTenantAppInstalled(B, 'pos')).resolves.toBeUndefined();
    expect(fixture.reads.filter((id) => id === A)).toHaveLength(2);
    expect(fixture.reads.filter((id) => id === B)).toHaveLength(1);
  });

  it('shared core route does not accidentally require an unrelated app', async () => {
    await expect(assertRouteAppEntitlement(A, '/api/customers')).resolves.toBeNull();
    expect(fixture.reads).toEqual([]);
  });
});
