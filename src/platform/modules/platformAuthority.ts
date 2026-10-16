/**
 * DRVO commercial control-plane authority.
 *
 * Separate from Casher legacy super_admin, TenantMembership, tenant roles and
 * modules.manage. The caller MUST load an active platform grant from trusted
 * server-side storage after authenticating the session user.
 *
 * No caller-supplied role, boolean or tenant-scoped permission can substitute
 * for a platform grant. This module does not issue entitlements.
 */
export const DRVO_PLATFORM_PERMISSIONS = {
  entitlementsRead: 'platform.entitlements.read',
  entitlementsManage: 'platform.entitlements.manage',
} as const;

export type DrvoPlatformPermission =
  typeof DRVO_PLATFORM_PERMISSIONS[keyof typeof DRVO_PLATFORM_PERMISSIONS];

export interface DrvoPlatformPrincipal {
  userId: number;
  active: boolean;
  /** Must originate from authoritative platform-only storage, not the session. */
  grants: readonly string[];
}

export function canManageCommercialEntitlements(
  principal: DrvoPlatformPrincipal | null | undefined,
  authenticatedUserId: number,
): boolean {
  return !!principal &&
    Number.isSafeInteger(authenticatedUserId) && authenticatedUserId > 0 &&
    principal.userId === authenticatedUserId &&
    principal.active === true &&
    principal.grants.includes(DRVO_PLATFORM_PERMISSIONS.entitlementsManage);
}

export function canReadCommercialEntitlements(
  principal: DrvoPlatformPrincipal | null | undefined,
  authenticatedUserId: number,
): boolean {
  return !!principal &&
    Number.isSafeInteger(authenticatedUserId) && authenticatedUserId > 0 &&
    principal.userId === authenticatedUserId &&
    principal.active === true &&
    (principal.grants.includes(DRVO_PLATFORM_PERMISSIONS.entitlementsRead) ||
     principal.grants.includes(DRVO_PLATFORM_PERMISSIONS.entitlementsManage));
}
