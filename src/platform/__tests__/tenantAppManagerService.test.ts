import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const fx = vi.hoisted(() => ({
  queries: [] as Array<{ text: string; inputs: Record<string, unknown> }>,
  commits: 0,
  rollbacks: 0,
  pack: 'salon',
  apps: ['booking'],
  events: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/db', () => {
  class Request {
    inputs: Record<string, unknown> = {};
    input(name: string, type: unknown, value?: unknown) {
      this.inputs[name] = arguments.length > 2 ? value : type;
      return this;
    }
    async query(text: string) {
      fx.queries.push({ text, inputs: { ...this.inputs } });
      if (text.includes('SELECT 1 AS ok FROM dbo.Tenant')) return { recordset: [{ ok: 1 }] };
      if (text.includes('FROM dbo.TenantIndustryPack')) return { recordset: [{
        PackCode: fx.pack, PackVersion: 1, ConfigJson: '{}',
      }] };
      if (text.includes('FROM dbo.TenantAppEntitlement') && text.includes('ORDER BY AppCode')) {
        return { recordset: fx.apps.map((AppCode) => ({
          AppCode, Status: 'installed', Source: 'pack', InstalledAt: null, DisabledAt: null,
        })) };
      }
      if (text.includes('DECLARE @outcome')) return { recordset: [{ outcome: 'inserted' }] };
      if (text.includes('SELECT @@ROWCOUNT AS changed')) return { recordset: [{ changed: 1 }] };
      return { recordset: [] };
    }
  }
  class Transaction {
    request() { return new Request(); }
    async begin() {}
    async commit() { fx.commits++; }
    async rollback() { fx.rollbacks++; }
  }
  return {
    getPool: vi.fn(async () => ({ request: () => new Request() })),
    sql: {
      Request, Transaction,
      UniqueIdentifier: 'uid', NVarChar: () => 'nvarchar', DateTime2: 'date', MAX: -1,
    },
  };
});
vi.mock('@/platform/commercial/bootstrapGuard', () => ({
  assertNotBootstrapTenant: vi.fn(async () => undefined),
}));
vi.mock('@/platform/tenant/tenantApplock', () => ({
  TENANT_COMMERCIAL_LOCK_PARTS: ['commercial'],
  acquireTenantApplock: vi.fn(async () => undefined),
}));
vi.mock('@/platform/registry/seedTenantRegistry', () => ({
  ensureAppRegistryRows: vi.fn(async () => undefined),
}));
vi.mock('@/platform/commercial/accessGateMemo', () => ({
  invalidateTenantAccessGate: vi.fn(),
}));
vi.mock('@/platform/outbox/publisher', () => ({
  publishPlatformOutboxEvent: vi.fn(async (_tx, event: Record<string, unknown>) => { fx.events.push(event); }),
}));

import { changeSelfServiceTenantApps } from '@/platform/apps/tenantApps';
import { findIndustryPack } from '@/packs';
const TENANT = '11111111-1111-4111-8111-111111111111';
const ACTOR = { actorUserId: 12 };

beforeEach(() => {
  fx.queries = [];
  fx.commits = 0;
  fx.rollbacks = 0;
  fx.events = [];
  fx.pack = 'salon';
  fx.apps = ['booking'];
});

describe('tenant admin app mutation transaction', () => {
  it('atomically installs inventory before purchasing and emits one scoped event', async () => {
    const result = await changeSelfServiceTenantApps(TENANT, {
      action: 'install', appCode: 'purchasing', confirmDependencies: true,
    }, { actor: ACTOR, resolvePack: findIndustryPack });
    expect(result.appCodes).toEqual(['inventory', 'purchasing']);
    const writes = fx.queries.filter((q) => q.text.includes('DECLARE @outcome'));
    expect(writes.map((q) => q.inputs.code)).toEqual(['inventory', 'purchasing']);
    expect(writes.every((q) => q.inputs.tenantId === TENANT && q.inputs.source === 'customer')).toBe(true);
    expect(fx.commits).toBe(1);
    expect(fx.events).toHaveLength(1);
    expect(fx.events[0]).toMatchObject({
      tenantId: TENANT, eventType: 'tenant.app.self_service_installed',
    });
    expect(JSON.parse(String(fx.events[0].payload))).toMatchObject({
      actorUserId: 12, autoAddedDependencies: ['inventory'],
    });
  });

  it('reinstall clears stale disabled timestamp without deleting historical records', async () => {
    const result = await changeSelfServiceTenantApps(TENANT, {
      action: 'install', appCode: 'inventory',
    }, { actor: ACTOR, resolvePack: findIndustryPack });
    expect(result.appCodes).toEqual(['inventory']);
    const mutation = fx.queries.find((q) => q.text.includes('DECLARE @outcome'));
    expect(mutation).toBeDefined();
    expect(mutation?.text).toMatch(/SET Enabled = 1, Status = N'installed', Source = @source,\\s*InstalledAt = ISNULL\\(InstalledAt, @now\\), DisabledAt = NULL, UpdatedAt = @now/);
    expect(mutation?.text).not.toMatch(/DELETE\\s+FROM\\s+dbo\\.TenantAppEntitlement/i);
    expect(mutation?.inputs.tenantId).toBe(TENANT);
    expect(fx.commits).toBe(1);
    expect(fx.events).toHaveLength(1);
  });

  it('rejects unconfirmed dependencies before any DB writes, rolls back and publishes nothing', async () => {
    await expect(changeSelfServiceTenantApps(TENANT, {
      action: 'install', appCode: 'purchasing',
    }, { actor: ACTOR, resolvePack: findIndustryPack })).rejects.toMatchObject({
      code: 'MISSING_DEPENDENCIES',
    });
    expect(fx.queries.some((q) => q.text.includes('DECLARE @outcome'))).toBe(false);
    expect(fx.rollbacks).toBe(1);
    expect(fx.events).toHaveLength(0);
  });

  it('never touches another tenant id or auto-manages non-pack apps', async () => {
    await expect(changeSelfServiceTenantApps(TENANT, {
      action: 'install', appCode: 'loyalty',
    }, { actor: ACTOR, resolvePack: findIndustryPack })).rejects.toMatchObject({
      code: 'APP_NOT_AVAILABLE',
    });
    expect(fx.queries.every((q) => !('tenantId' in q.inputs) || q.inputs.tenantId === TENANT)).toBe(true);
    expect(fx.commits).toBe(0);
    expect(fx.events).toHaveLength(0);
  });
});
