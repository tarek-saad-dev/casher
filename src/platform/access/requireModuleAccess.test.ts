import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { StaffTenantContext } from '@/platform/tenant/tenantContext';

vi.mock('./tenantGrants', () => ({ requireTenantPermission: vi.fn() }));
vi.mock('@/platform/modules/tenantEntitlements', () => ({ requireTenantModule: vi.fn() }));

import { requireTenantPermission } from './tenantGrants';
import { requireTenantModule } from '@/platform/modules/tenantEntitlements';
import { requireDrvoModuleAccess } from './requireModuleAccess';
import { DRVO_PERMISSIONS } from './permissions';

const context = {
  kind: 'staff',
  tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  membershipId: '11111111-1111-4111-8111-111111111111',
  tenantCode: 'TEST',
  userId: 1,
  activeLocation: {
    locationId: '22222222-2222-4222-8222-222222222222',
    legacyBranchId: 1,
    branchCode: 'TEST',
    timezone: 'Africa/Cairo',
  },
} satisfies StaffTenantContext;

const permission = DRVO_PERMISSIONS.modulesRead;
const requirePermissionMock = vi.mocked(requireTenantPermission);
const requireModuleMock = vi.mocked(requireTenantModule);

describe('combined DRVO module access', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('allows only when both checks pass', async () => {
    await expect(requireDrvoModuleAccess(context, 'online_booking', permission)).resolves.toBeUndefined();
    expect(requirePermissionMock).toHaveBeenCalledWith(context, permission, { executor: undefined });
    expect(requireModuleMock).toHaveBeenCalledWith(context, 'online_booking', { executor: undefined, now: undefined });
  });

  it('denies and never checks modules when role permission is missing', async () => {
    requirePermissionMock.mockRejectedValueOnce(new Error('DENIED'));
    await expect(requireDrvoModuleAccess(context, 'pos', permission)).rejects.toThrow('DENIED');
    expect(requireModuleMock).not.toHaveBeenCalled();
  });

  it('denies when role exists but entitlement is missing', async () => {
    requireModuleMock.mockRejectedValueOnce(new Error('NOT_ENTITLED'));
    await expect(requireDrvoModuleAccess(context, 'pos', permission)).rejects.toThrow('NOT_ENTITLED');
    expect(requirePermissionMock).toHaveBeenCalledOnce();
  });

  it('propagates database failures without falling back to legacy access', async () => {
    requirePermissionMock.mockRejectedValueOnce(new Error('DB_DOWN'));
    await expect(requireDrvoModuleAccess(context, 'hr', permission)).rejects.toThrow('DB_DOWN');
    expect(requireModuleMock).not.toHaveBeenCalled();
  });
});
