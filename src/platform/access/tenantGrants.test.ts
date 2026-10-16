import { describe, expect, it, vi } from 'vitest';
import type { TenantSqlExecutor, StaffTenantContext } from '@/platform/tenant/tenantContext';
import { DRVO_PERMISSIONS } from './permissions';

vi.mock('@/lib/db', () => ({
  getPool: vi.fn(),
  sql: { UniqueIdentifier: 'uniqueidentifier', Int: 'int' },
}));

import { loadTenantPermissionActor, requireTenantPermission } from './tenantGrants';

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

function fakeDb(rows: Array<{ MembershipId: string; PermissionKey: string | null }>) {
  const input = vi.fn().mockReturnThis();
  const query = vi.fn().mockResolvedValue({ recordset: rows });
  const request = vi.fn().mockReturnValue({ input, query });
  return { db: { request } as unknown as TenantSqlExecutor, input, query };
}

describe('tenant grant reader', () => {
  it('scopes grants to the tenant and membership', async () => {
    const { db, input } = fakeDb([{ MembershipId: context.membershipId, PermissionKey: 'members.read' }]);
    const actor = await loadTenantPermissionActor(context, { executor: db });
    expect(actor.grants).toEqual([DRVO_PERMISSIONS.membersRead]);
    expect(input).toHaveBeenCalledWith('tenantId', 'uniqueidentifier', context.tenantId);
    expect(input).toHaveBeenCalledWith('membershipId', 'uniqueidentifier', context.membershipId);
    expect(input).toHaveBeenCalledWith('userId', 'int', context.userId);
  });

  it('denies users without memberships', async () => {
    const { db } = fakeDb([]);
    const actor = await loadTenantPermissionActor(context, { executor: db });
    expect(actor.membershipActive).toBe(false);
    await expect(requireTenantPermission(context, DRVO_PERMISSIONS.membersRead, { executor: db })).rejects.toMatchObject({ status: 403 });
  });

  it('ignores unknown grants and duplicate grants', async () => {
    const { db } = fakeDb([
      { MembershipId: context.membershipId, PermissionKey: 'legacy.admin' },
      { MembershipId: context.membershipId, PermissionKey: 'members.read' },
      { MembershipId: context.membershipId, PermissionKey: 'members.read' },
    ]);
    const actor = await loadTenantPermissionActor(context, { executor: db });
    expect(actor.grants).toEqual([DRVO_PERMISSIONS.membersRead]);
    await expect(requireTenantPermission(context, DRVO_PERMISSIONS.membersManage, { executor: db })).rejects.toMatchObject({ status: 403 });
  });
});
