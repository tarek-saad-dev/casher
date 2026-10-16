import { canDrvo, DRVO_PERMISSIONS, type DrvoPermissionActor } from '@/platform/access/permissions';
import { canUseDrvoModule, isDrvoModuleKey, type DrvoModuleEntitlement } from './registry';

/**
 * DRVO module management trust boundary.
 *
 * A tenant-scoped owner/admin may view entitlements and, after a separate
 * settings implementation is authorized, edit non-commercial module settings.
 * They can NEVER issue, renew, suspend, or cancel commercial entitlements.
 *
 * Commercial provisioning requires an independently authenticated PLATFORM
 * principal checked by the platform control plane. No legacy UserLevel,
 * tenant RBAC grant, client role string, or signed tenant session is enough.
 */
export type TenantModuleAction = 'view' | 'configure' | 'provision' | 'suspend' | 'renew' | 'cancel';

export type TenantModuleDecision =
  | { allowed: true }
  | { allowed: false; reason: 'INVALID_MODULE' | 'TENANT_PERMISSION_REQUIRED' | 'ENTITLEMENT_REQUIRED' | 'PLATFORM_AUTHORITY_REQUIRED' };

export function authorizeTenantModuleAction(input: {
  actor: DrvoPermissionActor | null | undefined;
  tenantId: string;
  moduleKey: string;
  action: TenantModuleAction;
  entitlement?: DrvoModuleEntitlement | null;
  now?: Date;
}): TenantModuleDecision {
  if (!isDrvoModuleKey(input.moduleKey)) return { allowed: false, reason: 'INVALID_MODULE' };

  // Commercial operations must NEVER be authorized from a tenant principal.
  if (input.action === 'provision' || input.action === 'suspend' ||
      input.action === 'renew' || input.action === 'cancel') {
    return { allowed: false, reason: 'PLATFORM_AUTHORITY_REQUIRED' };
  }

  const permission = input.action === 'view'
    ? DRVO_PERMISSIONS.modulesRead
    : DRVO_PERMISSIONS.modulesManage;
  if (!canDrvo(input.actor, input.tenantId, permission)) {
    return { allowed: false, reason: 'TENANT_PERMISSION_REQUIRED' };
  }

  if (input.action === 'configure' &&
      !canUseDrvoModule(input.tenantId, input.moduleKey, input.entitlement, input.now)) {
    return { allowed: false, reason: 'ENTITLEMENT_REQUIRED' };
  }

  return { allowed: true };
}

/**
 * Trusted platform control plane is a separate authority and MUST resolve
 * the platform principal from server-side platform authentication before
 * calling this helper. It must not accept a client-supplied isAdmin boolean.
 *
 * This policy deliberately does not expose any mutation or issue entitlements.
 */
export function isCommercialModuleAction(action: TenantModuleAction): boolean {
  return action === 'provision' || action === 'suspend' || action === 'renew' || action === 'cancel';
}
