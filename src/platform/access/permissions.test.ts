import { describe, expect, it } from 'vitest';
import {
  canDrvo, DRVO_PERMISSIONS, DRVO_ROLE_TEMPLATES, permissionsForTemplate,
  type DrvoPermissionActor,
} from './permissions';

const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actor: DrvoPermissionActor = {
  tenantId: TENANT_A,
  membershipId: 'membership-a',
  membershipActive: true,
  grants: [DRVO_PERMISSIONS.membersRead],
};

describe('DRVO tenant-scoped permission evaluator', () => {
  it('allows a verified grant in the same tenant', () => {
    expect(canDrvo(actor, TENANT_A, DRVO_PERMISSIONS.membersRead)).toBe(true);
  });
  it('denies cross-tenant access even with a matching grant', () => {
    expect(canDrvo(actor, TENANT_B, DRVO_PERMISSIONS.membersRead)).toBe(false);
  });
  it('denies missing permissions', () => {
    expect(canDrvo(actor, TENANT_A, DRVO_PERMISSIONS.membersManage)).toBe(false);
  });
  it('denies inactive or missing memberships', () => {
    expect(canDrvo({ ...actor, membershipActive: false }, TENANT_A, DRVO_PERMISSIONS.membersRead)).toBe(false);
    expect(canDrvo({ ...actor, membershipId: '' }, TENANT_A, DRVO_PERMISSIONS.membersRead)).toBe(false);
    expect(canDrvo(null, TENANT_A, DRVO_PERMISSIONS.membersRead)).toBe(false);
  });
  it('denies malformed or absent tenant identity', () => {
    expect(canDrvo({ ...actor, tenantId: '' }, TENANT_A, DRVO_PERMISSIONS.membersRead)).toBe(false);
    expect(canDrvo(actor, '', DRVO_PERMISSIONS.membersRead)).toBe(false);
  });
  it('never treats legacy super_admin or wildcards as SaaS grants', () => {
    expect(canDrvo({ ...actor, grants: ['super_admin', '*'] }, TENANT_A, DRVO_PERMISSIONS.membersManage)).toBe(false);
  });
  it('rejects unknown permissions at runtime', () => {
    expect(canDrvo(actor, TENANT_A, 'members.delete_everything' as typeof DRVO_PERMISSIONS.membersRead)).toBe(false);
  });
  it('exposes templates as configuration only, with no implicit grants', () => {
    expect(permissionsForTemplate('owner')).toContain(DRVO_PERMISSIONS.rolesManage);
    expect(permissionsForTemplate('viewer')).not.toContain(DRVO_PERMISSIONS.rolesManage);
    expect(Object.keys(DRVO_ROLE_TEMPLATES)).toEqual(['owner', 'admin', 'manager', 'staff', 'viewer']);
    expect(canDrvo({ ...actor, grants: [] }, TENANT_A, DRVO_PERMISSIONS.membersRead)).toBe(false);
  });
});
