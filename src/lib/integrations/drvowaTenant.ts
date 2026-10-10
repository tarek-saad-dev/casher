import 'server-only';
import { resolveLegacyBootstrapTenantId } from '@/platform/tenant/legacyBootstrapSeam';
import { requireMessagingTenantId } from '@/modules/messaging/tenancy/messagingTenantScope';
import { isDrvowaEventMessagingActive } from './drvowaClient';

/** DRVOWA is paired once per instance (no TenantId); only CASHER_BOOT may pair, read or send through it. */
export function resolveDrvowaOwnerTenantId(): Promise<string> {
  return resolveLegacyBootstrapTenantId('drvowa-instance-channel');
}

export async function isDrvowaOwnerTenant(tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const owner = await resolveDrvowaOwnerTenantId();
    return owner.toLowerCase() === tenantId.toLowerCase();
  } catch {
    return false;
  }
}

export async function isDrvowaActiveForTenant(tenantId: string): Promise<boolean> {
  if (!(await isDrvowaEventMessagingActive())) return false;
  return isDrvowaOwnerTenant(tenantId);
}

/** Same check for the tenant of the current messaging scope (throws outside a scope). */
export async function isDrvowaActiveForMessagingTenant(where: string): Promise<boolean> {
  return isDrvowaActiveForTenant(requireMessagingTenantId(where));
}
