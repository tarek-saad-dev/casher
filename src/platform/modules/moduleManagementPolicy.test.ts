import { describe, expect, it } from 'vitest';
import { authorizeTenantModuleAction } from './moduleManagementPolicy';
import { DRVO_PERMISSIONS, type DrvoPermissionActor } from '@/platform/access/permissions';

const tenantId = '083d433e-f36b-1410-8820-009ec495c7e1';
const otherTenantId = '183d433e-f36b-1410-8820-009ec495c7e1';
const actor: DrvoPermissionActor = {
  tenantId,
  membershipId: '173d433e-f36b-1410-8820-009ec495c7e1',
  membershipActive: true,
  grants: Object.values(DRVO_PERMISSIONS),
};
const entitlement = { tenantId, moduleKey: 'pos', status: 'enabled' as const, validUntilUtc: null };

describe('tenant module management security boundary', () => {
  it.each(['provision', 'suspend', 'renew', 'cancel'] as const)(
    'denies %s even to a tenant owner with every tenant grant',
    (action) => {
      expect(authorizeTenantModuleAction({ actor, tenantId, moduleKey: 'pos', action, entitlement }))
        .toEqual({ allowed: false, reason: 'PLATFORM_AUTHORITY_REQUIRED' });
    },
  );

  it('allows reading the catalog without a commercial entitlement', () => {
    expect(authorizeTenantModuleAction({ actor, tenantId, moduleKey: 'hr', action: 'view' }))
      .toEqual({ allowed: true });
  });

  it('requires both tenant manage permission and a live entitlement for configuration', () => {
    expect(authorizeTenantModuleAction({ actor, tenantId, moduleKey: 'pos', action: 'configure', entitlement }))
      .toEqual({ allowed: true });
    expect(authorizeTenantModuleAction({ actor, tenantId, moduleKey: 'hr', action: 'configure' }))
      .toEqual({ allowed: false, reason: 'ENTITLEMENT_REQUIRED' });
    expect(authorizeTenantModuleAction({
      actor: { ...actor, grants: [DRVO_PERMISSIONS.modulesRead] },
      tenantId, moduleKey: 'pos', action: 'configure', entitlement,
    })).toEqual({ allowed: false, reason: 'TENANT_PERMISSION_REQUIRED' });
  });

  it('rejects expired, suspended and cross-tenant entitlements', () => {
    expect(authorizeTenantModuleAction({
      actor, tenantId, moduleKey: 'pos', action: 'configure',
      entitlement: { ...entitlement, status: 'suspended' },
    }).allowed).toBe(false);
    expect(authorizeTenantModuleAction({
      actor, tenantId, moduleKey: 'pos', action: 'configure',
      entitlement: { ...entitlement, validUntilUtc: '2020-01-01T00:00:00Z' },
    }).allowed).toBe(false);
    expect(authorizeTenantModuleAction({
      actor, tenantId, moduleKey: 'pos', action: 'configure',
      entitlement: { ...entitlement, tenantId: otherTenantId },
    }).allowed).toBe(false);
  });

  it('rejects cross-tenant actors, inactive memberships, and unknown modules', () => {
    expect(authorizeTenantModuleAction({
      actor, tenantId: otherTenantId, moduleKey: 'pos', action: 'view',
    }).allowed).toBe(false);
    expect(authorizeTenantModuleAction({
      actor: { ...actor, membershipActive: false }, tenantId, moduleKey: 'pos', action: 'view',
    }).allowed).toBe(false);
    expect(authorizeTenantModuleAction({
      actor, tenantId, moduleKey: 'not-real', action: 'view',
    })).toEqual({ allowed: false, reason: 'INVALID_MODULE' });
  });
});
