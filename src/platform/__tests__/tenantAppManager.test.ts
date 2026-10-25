import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SALON_PACK } from '@/packs/salon/public';
import { SUPERMARKET_PACK } from '@/packs/supermarket/public';
import { buildAppManagerCatalog, planSelfServiceChange } from '@/platform/apps/selfServiceAppManager';
import type { TenantAppState } from '@/platform/apps/tenantApps';

function state(appCode: string, status: TenantAppState['status'] = 'installed', source: TenantAppState['source'] = 'pack'): TenantAppState {
  return { appCode, status, source, installedAt: null, disabledAt: null };
}

describe('DRVO tenant self-service app manager policy', () => {
  it('read model shows only self-service-ready pack options and protects the required booking app', () => {
    const apps = buildAppManagerCatalog(SALON_PACK, [state('booking'), state('pos')]);
    expect(apps.map((x) => x.code)).not.toContain('messaging');
    expect(apps.map((x) => x.code)).not.toContain('ai-receptionist');
    expect(apps.find((x) => x.code === 'booking')).toMatchObject({
      status: 'installed', canDisable: false, group: 'required',
    });
    expect(apps.find((x) => x.code === 'inventory')).toMatchObject({
      status: 'available', canInstall: true, group: 'optional',
    });
    expect(apps.find((x) => x.code === 'purchasing')?.missingDependencies).toEqual(['inventory']);
  });

  it('purchase install requires explicit confirmation for inventory and gives dependency-first order', () => {
    const current = [state('booking'), state('pos')];
    expect(() => planSelfServiceChange(SALON_PACK, current, {
      action: 'install', appCode: 'purchasing',
    })).toThrowError(/تفعيل التطبيق يحتاج/);
    expect(planSelfServiceChange(SALON_PACK, current, {
      action: 'install', appCode: 'purchasing', confirmDependencies: true,
    })).toEqual({
      action: 'install', appCodes: ['inventory', 'purchasing'], autoAddedDependencies: ['inventory'],
    });
  });

  it('never disables a required app or a dependency in use', () => {
    expect(() => planSelfServiceChange(SALON_PACK, [
      state('booking'), state('inventory'), state('purchasing'),
    ], { action: 'disable', appCode: 'booking' })).toMatchObject({ code: 'REQUIRED_BY_PACK' });
    expect(() => planSelfServiceChange(SALON_PACK, [
      state('booking'), state('inventory'), state('purchasing'),
    ], { action: 'disable', appCode: 'inventory' })).toThrowError(/required by installed app/);
  });

  it('refuses out-of-pack apps, unready channels, and operator-managed changes', () => {
    expect(() => planSelfServiceChange(SALON_PACK, [state('booking')], {
      action: 'install', appCode: 'loyalty',
    })).toMatchObject({ code: 'APP_NOT_AVAILABLE' });
    expect(() => planSelfServiceChange(SALON_PACK, [state('booking')], {
      action: 'install', appCode: 'messaging',
    })).toMatchObject({ code: 'APP_NOT_AVAILABLE' });
    expect(() => planSelfServiceChange(SALON_PACK, [state('booking'), state('pos', 'disabled', 'platform_admin')], {
      action: 'install', appCode: 'pos',
    })).toMatchObject({ code: 'APP_NOT_AVAILABLE' });
  });

  it('supermarket POS is required while optional attendance is independently addable', () => {
    const apps = buildAppManagerCatalog(SUPERMARKET_PACK, [state('pos')]);
    expect(apps.find((a) => a.code === 'pos')?.canDisable).toBe(false);
    expect(planSelfServiceChange(SUPERMARKET_PACK, [state('pos')], {
      action: 'install', appCode: 'attendance',
    }).appCodes).toEqual(['attendance']);
  });

  it('read-only CASHER_BOOT never exposes active mutation controls and shows legacy apps', () => {
    const apps = buildAppManagerCatalog(SALON_PACK, [state('booking'), state('loyalty', 'installed', 'bootstrap')], {
      protectedTenant: true,
    });
    expect(apps.find((x) => x.code === 'loyalty')).toMatchObject({ group: 'managed', canDisable: false });
    expect(apps.every((x) => !x.canInstall && !x.canDisable)).toBe(true);
  });

  it('backend wiring keeps tenant and actor authoritative and uses transactional outbox', () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
    const route = read('src/app/api/tenant/apps/route.ts');
    const service = read('src/platform/apps/tenantApps.ts');
    expect(route.match(/await requireAdmin\(\)/g)).toHaveLength(2);
    expect(route).toContain('changeSelfServiceTenantApps(auth.tenantId');
    expect(route).toContain('auth.userId');
    expect(route).not.toContain('body.tenantId');
    expect(route).toContain('confirmDisable');
    expect(service).toContain("withTenantAppsTx(tenantId, 'changeSelfServiceTenantApps'");
    expect(service).toContain("listTenantApps(tenantId, { executor: tx, forUpdate: true })");
    expect(service).toContain("setAppInstalled(tx, tenantId, code, 'customer'");
    expect(service).toContain('publishPlatformOutboxEvent(tx, {');
  });
});
