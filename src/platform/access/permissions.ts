/**
 * DRVO ERP permission vocabulary and deterministic policy evaluation.
 *
 * Deliberately independent of legacy Casher TblRoles / UserLevel.
 * A role label, session claim or super_admin in the legacy app never
 * grants SaaS permissions. The caller must provide authoritative
 * tenant-scoped grants, after verifying membership server-side.
 */
export const DRVO_PERMISSIONS = {
  organizationRead: 'organization.read',
  organizationManage: 'organization.manage',
  locationsRead: 'locations.read',
  locationsManage: 'locations.manage',
  membersRead: 'members.read',
  membersInvite: 'members.invite',
  membersManage: 'members.manage',
  rolesRead: 'roles.read',
  rolesManage: 'roles.manage',
  modulesRead: 'modules.read',
  modulesManage: 'modules.manage',
  billingRead: 'billing.read',
  billingManage: 'billing.manage',
  auditRead: 'audit.read',
} as const;

export type DrvoPermission = typeof DRVO_PERMISSIONS[keyof typeof DRVO_PERMISSIONS];

export const DRVO_ROLE_TEMPLATES = {
  owner: {
    label: 'مالك الشركة',
    permissions: Object.values(DRVO_PERMISSIONS),
  },
  admin: {
    label: 'مدير الشركة',
    permissions: [
      DRVO_PERMISSIONS.organizationRead,
      DRVO_PERMISSIONS.locationsRead,
      DRVO_PERMISSIONS.locationsManage,
      DRVO_PERMISSIONS.membersRead,
      DRVO_PERMISSIONS.membersInvite,
      DRVO_PERMISSIONS.membersManage,
      DRVO_PERMISSIONS.rolesRead,
      DRVO_PERMISSIONS.modulesRead,
      DRVO_PERMISSIONS.auditRead,
    ],
  },
  manager: {
    label: 'مدير فرع',
    permissions: [
      DRVO_PERMISSIONS.organizationRead,
      DRVO_PERMISSIONS.locationsRead,
      DRVO_PERMISSIONS.membersRead,
      DRVO_PERMISSIONS.modulesRead,
    ],
  },
  staff: {
    label: 'موظف',
    permissions: [DRVO_PERMISSIONS.organizationRead, DRVO_PERMISSIONS.modulesRead],
  },
  viewer: {
    label: 'مشاهد',
    permissions: [DRVO_PERMISSIONS.organizationRead, DRVO_PERMISSIONS.modulesRead],
  },
} as const satisfies Record<string, { label: string; permissions: readonly DrvoPermission[] }>;

export type DrvoRoleTemplate = keyof typeof DRVO_ROLE_TEMPLATES;

export interface DrvoPermissionActor {
  /** Tenant and membership must be resolved against the DB on every request. */
  tenantId: string;
  membershipId: string;
  /** Grants must be loaded from authoritative tenant-scoped assignments. */
  grants: readonly string[];
  /** Only active memberships may be evaluated. */
  membershipActive: boolean;
}

const knownPermissions: ReadonlySet<string> = new Set(Object.values(DRVO_PERMISSIONS));

export function isDrvoPermission(value: string): value is DrvoPermission {
  return knownPermissions.has(value);
}

/** Explicit tenant match + active membership + exact permission; fail closed. */
export function canDrvo(
  actor: DrvoPermissionActor | null | undefined,
  resourceTenantId: string,
  permission: DrvoPermission,
): boolean {
  if (!actor || !actor.membershipActive || !isDrvoPermission(permission)) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actor.tenantId)) return false;
  if (!actor.membershipId.trim()) return false;
  if (actor.tenantId.toLowerCase() !== resourceTenantId.toLowerCase()) return false;
  return actor.grants.includes(permission);
}

/** Templates describe future role configuration, not current user entitlements. */
export function permissionsForTemplate(role: DrvoRoleTemplate): readonly DrvoPermission[] {
  return DRVO_ROLE_TEMPLATES[role].permissions;
}
