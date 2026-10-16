import { describe, expect, it } from 'vitest';
import {
  canManageCommercialEntitlements,
  canReadCommercialEntitlements,
  DRVO_PLATFORM_PERMISSIONS,
} from './platformAuthority';

describe('independent DRVO platform authority', () => {
  const manager = {
    userId: 13,
    active: true,
    grants: [DRVO_PLATFORM_PERMISSIONS.entitlementsManage],
  };
  it('authorizes an active, independently granted platform manager', () => {
    expect(canManageCommercialEntitlements(manager, 13)).toBe(true);
    expect(canReadCommercialEntitlements(manager, 13)).toBe(true);
  });
  it('rejects identity mismatch and inactive grant', () => {
    expect(canManageCommercialEntitlements(manager, 14)).toBe(false);
    expect(canManageCommercialEntitlements({ ...manager, active: false }, 13)).toBe(false);
  });
  it('rejects a tenant owner even with every tenant permission', () => {
    expect(canManageCommercialEntitlements({
      userId: 13, active: true, grants: ['modules.manage', 'billing.manage', 'super_admin'],
    }, 13)).toBe(false);
  });
  it('does not grant management to a read-only platform operator', () => {
    const reader = { userId: 13, active: true, grants: [DRVO_PLATFORM_PERMISSIONS.entitlementsRead] };
    expect(canReadCommercialEntitlements(reader, 13)).toBe(true);
    expect(canManageCommercialEntitlements(reader, 13)).toBe(false);
  });
  it('rejects missing principal and invalid user IDs', () => {
    expect(canManageCommercialEntitlements(null, 13)).toBe(false);
    expect(canManageCommercialEntitlements(manager, 0)).toBe(false);
  });
});
