import 'server-only';
import { getSession } from '@/lib/session';
import { getPool, sql } from '@/lib/db';
import { resolveStaffTenantContextForRequest, type StaffTenantContext } from '@/platform/tenant/tenantContext';
import { loadTenantPermissionActor } from '@/platform/access/tenantGrants';
import { canDrvo, DRVO_PERMISSIONS } from '@/platform/access/permissions';
import { canUseDrvoModule, type DrvoModuleEntitlement } from '@/platform/modules/registry';

/**
 * DRVO POS READ preflight only. No legacy POS endpoint is enabled by this module.
 * Do not use modules.read as an operational write permission.
 */
export type PosReadGateResult =
  | { ok: true; context: StaffTenantContext }
  | { ok: false; status: 401 | 403 | 503; code: string };

export async function authorizeDrvoPosRead(): Promise<PosReadGateResult> {
  // This preview deliberately cannot run against production or unsafe staging.
  if (process.env.DRVO_STAGING_MODE !== 'true' ||
      process.env.STAGING_SAFETY_ENFORCE !== 'true' ||
      process.env.STAGING_SAFETY_DB_NAME !== 'last132_agent' ||
      process.env.DB_NAME !== 'last132_agent' ||
      process.env.DB_DATABASE !== 'last132_agent' ||
      process.env.DB_USER !== 'drvo_agent' ||
      process.env.DRVO_STAGING_OUTBOUND_DISABLED !== 'true' ||
      process.env.DRVO_STAGING_WORKERS_DISABLED !== 'true' ||
      process.env.DRVO_STAGING_CRON_DISABLED !== 'true') {
    return { ok: false, status: 503, code: 'STAGING_ONLY' };
  }
  const session = await getSession();
  if (!session) return { ok: false, status: 401, code: 'UNAUTHENTICATED' };
  if (!session.TenantId || !session.MembershipId || !session.ActiveBranchID) {
    return { ok: false, status: 403, code: 'TENANT_CONTEXT_REQUIRED' };
  }

  try {
    const db = await getPool();
    const identity = await db.request().query<{ DatabaseName: string }>('SELECT DB_NAME() AS DatabaseName');
    if (identity.recordset[0]?.DatabaseName !== 'last132_agent') {
      return { ok: false, status: 503, code: 'WRONG_DATABASE' };
    }
    const context = await resolveStaffTenantContextForRequest({
      userId: session.UserID,
      activeBranchId: session.ActiveBranchID,
      preferredTenantId: session.TenantId,
    }, { executor: db });
    if (context.membershipId.toLowerCase() !== session.MembershipId.toLowerCase()) {
      return { ok: false, status: 403, code: 'MEMBERSHIP_MISMATCH' };
    }
    const actor = await loadTenantPermissionActor(context, { executor: db });
    if (!canDrvo(actor, context.tenantId, DRVO_PERMISSIONS.modulesRead)) {
      return { ok: false, status: 403, code: 'FORBIDDEN' };
    }
    const entitlementResult = await db.request()
      .input('tenantId', sql.UniqueIdentifier, context.tenantId)
      .input('moduleKey', sql.NVarChar(64), 'pos')
      .query<{ TenantId: string; ModuleKey: string; Status: string; ValidUntilUtc: Date | null }>(`
        SELECT TenantId, ModuleKey, Status, ValidUntilUtc
        FROM dbo.DrvoTenantModuleEntitlement
        WHERE TenantId = @tenantId AND ModuleKey = @moduleKey
      `);
    if (entitlementResult.recordset.length !== 1) {
      return { ok: false, status: 403, code: 'POS_NOT_ENTITLED' };
    }
    const row = entitlementResult.recordset[0];
    const entitlement: DrvoModuleEntitlement = {
      tenantId: String(row.TenantId),
      moduleKey: String(row.ModuleKey),
      status: row.Status as DrvoModuleEntitlement['status'],
      validUntilUtc: row.ValidUntilUtc ? new Date(row.ValidUntilUtc).toISOString() : null,
    };
    if (!canUseDrvoModule(context.tenantId, 'pos', entitlement)) {
      return { ok: false, status: 403, code: 'POS_NOT_ENTITLED' };
    }
    return { ok: true, context };
  } catch (error) {
    console.error('[drvo/pos/read-gate] denied', error instanceof Error ? error.name : 'unknown');
    return { ok: false, status: 503, code: 'POS_GATE_UNAVAILABLE' };
  }
}

/**
 * Operational POS reads require an explicit tenant-scoped pos.read grant.
 * Subscription/catalog visibility alone never exposes invoice data.
 */
export async function authorizeDrvoPosOperationalRead(): Promise<PosReadGateResult> {
  const preflight = await authorizeDrvoPosRead();
  if (!preflight.ok) return preflight;
  try {
    const db = await getPool();
    const actor = await loadTenantPermissionActor(preflight.context, { executor: db });
    if (!canDrvo(actor, preflight.context.tenantId, DRVO_PERMISSIONS.posRead)) {
      return { ok: false, status: 403, code: 'POS_READ_FORBIDDEN' };
    }
    return preflight;
  } catch {
    return { ok: false, status: 503, code: 'POS_READ_GATE_UNAVAILABLE' };
  }
}
