import 'server-only';
import type { StaffTenantContext, TenantSqlExecutor } from '@/platform/tenant/tenantContext';
import type { DrvoPermission } from './permissions';
import type { DrvoModuleKey } from '@/platform/modules/registry';
import { requireTenantPermission } from './tenantGrants';
import { requireTenantModule } from '@/platform/modules/tenantEntitlements';

/**
 * Shared gate for future DRVO operational entry points.
 * Requires BOTH an authoritative tenant role grant and a live module entitlement.
 * Never authorize by a legacy UserLevel, a session claim, or catalog presence.
 *
 * The caller must first resolve and verify StaffTenantContext against the
 * authenticated signed session and active location. This helper does not
 * resolve session identity or authorize any existing legacy route.
 */
export async function requireDrvoModuleAccess(
  context: StaffTenantContext,
  moduleKey: DrvoModuleKey,
  permission: DrvoPermission,
  opts: { executor?: TenantSqlExecutor; now?: Date } = {},
): Promise<void> {
  await requireTenantPermission(context, permission, { executor: opts.executor });
  await requireTenantModule(context, moduleKey, { executor: opts.executor, now: opts.now });
}
