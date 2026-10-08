import 'server-only';
import type { SessionUser } from '@/lib/session-types';
import {
  resolveUserTenantMembership,
  type TenantMembershipResolution,
} from '@/platform/tenant/tenantContext';

/** Tenant membership of a staff user (no location). Kept for existing platform-public callers. */
export type StaffTenantMembership = TenantMembershipResolution;

/**
 * Authoritative staff tenant membership: user -> active TenantMembership -> active Tenant.
 * Throws TenantContextError when the tenant cannot be resolved; there is no bootstrap default
 * and no process-global cache.
 */
export async function resolveStaffTenantContext(
  user: Pick<SessionUser, 'UserID'> & { TenantId?: string | null },
): Promise<StaffTenantMembership> {
  return resolveUserTenantMembership({
    userId: user.UserID,
    preferredTenantId: user.TenantId ?? null,
  });
}
