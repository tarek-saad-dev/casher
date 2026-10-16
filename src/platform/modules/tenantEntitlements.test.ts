import { describe, expect, it, vi } from 'vitest';
import type { StaffTenantContext, TenantSqlExecutor } from '@/platform/tenant/tenantContext';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  sql: { UniqueIdentifier: 'uniqueidentifier', Int: 'int' },
}));

import { listTenantModuleEntitlements, requireTenantModule } from './tenantEntitlements';

const context: StaffTenantContext = {
  kind: 'staff',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  tenantCode: 'DEMO',
  membershipId: '11111111-1111-4111-8111-111111111111',
  userId: 21,
  activeLocation: {
    locationId: '22222222-2222-4222-8222-222222222222',
    legacyBranchId: 1,
    branchCode: 'BR1',
    timezone: 'Africa/Cairo',
  },
};

function fakeDb(rows: unknown[]) {
  const input = vi.fn().mockReturnThis();
  const query = vi.fn().mockResolvedValue({ recordset: rows });
  const request = vi.fn().mockReturnValue({ input, query });
  return { db: { request } as unknown as TenantSqlExecutor, input, query };
}

describe('DRVO tenant module entitlements', () => {
  it('loads only scoped known modules', async () => {
    const { db, input } = fakeDb([
      { TenantId: context.tenantId, ModuleKey: 'pos', Status: 'enabled', ValidUntilUtc: null },
      { TenantId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ModuleKey: 'hr', Status: 'enabled', ValidUntilUtc: null },
      { TenantId: context.tenantId, ModuleKey: 'unknown', Status: 'enabled', ValidUntilUtc: null },
    ]);
    const rows = await listTenantModuleEntitlements(context, { executor: db });
    expect(rows).toHaveLength(1);
    expect(rows[0].moduleKey).toBe('pos');
    expect(input).toHaveBeenCalledWith('tenantId', 'uniqueidentifier', context.tenantId);
    expect(input).toHaveBeenCalledWith('membershipId', 'uniqueidentifier', context.membershipId);
    expect(input).toHaveBeenCalledWith('userId', 'int', context.userId);
  });

  it('denies missing module activation', async () => {
    const { db } = fakeDb([]);
    await expect(requireTenantModule(context, 'pos', { executor: db })).rejects.toMatchObject({ status: 403 });
  });

  it('accepts an explicit valid activation', async () => {
    const { db } = fakeDb([
      { TenantId: context.tenantId, ModuleKey: 'pos', Status: 'enabled', ValidUntilUtc: null },
    ]);
    await expect(requireTenantModule(context, 'pos', { executor: db })).resolves.toBeUndefined();
  });

  it('denies suspended activations', async () => {
    const { db } = fakeDb([
      { TenantId: context.tenantId, ModuleKey: 'pos', Status: 'suspended', ValidUntilUtc: null },
    ]);
    await expect(requireTenantModule(context, 'pos', { executor: db })).rejects.toMatchObject({ status: 403 });
  });

  it('denies expired activations', async () => {
    const { db } = fakeDb([
      { TenantId: context.tenantId, ModuleKey: 'pos', Status: 'enabled', ValidUntilUtc: new Date('2026-10-15T12:00:00Z') },
    ]);
    await expect(requireTenantModule(context, 'pos', { executor: db, now: new Date('2026-10-16T12:00:00Z') })).rejects.toMatchObject({ status: 403 });
  });
});
