import 'server-only';
import { getPool, sql } from '@/lib/db';
import type { TenantSqlExecutor } from '@/platform/tenant/tenantContext';
import {
  canManageCommercialEntitlements,
  type DrvoPlatformPrincipal,
} from './platformAuthority';

/**
 * Independent platform grants: no legacy super_admin or tenant owner fallback.
 * Missing table, inactive grant or database error must fail closed.
 *
 * Schema is staged separately in docs/drvo/platform-authority-schema-candidate.sql.
 * This function does not provision users, roles or commercial entitlements.
 */
export async function loadPlatformPrincipal(
  authenticatedUserId: number,
  opts: { executor?: TenantSqlExecutor } = {},
): Promise<DrvoPlatformPrincipal> {
  if (!Number.isSafeInteger(authenticatedUserId) || authenticatedUserId <= 0) {
    return { userId: authenticatedUserId, active: false, grants: [] };
  }
  const db = opts.executor ?? await getPool();
  const result = await db.request()
    .input('userId', sql.Int, authenticatedUserId)
    .query<{ PermissionKey: string }>(`
      SELECT PermissionKey
      FROM dbo.DrvoPlatformOperatorGrant
      WHERE LegacyUserId = @userId AND IsActive = 1
    `);
  const rows = result.recordset as Array<{ PermissionKey: string }>;
  return {
    userId: authenticatedUserId,
    active: rows.length > 0,
    grants: [...new Set(rows.map(row => String(row.PermissionKey)))],
  };
}

export class DrvoPlatformAuthorityDeniedError extends Error {
  readonly code = 'DRVO_PLATFORM_AUTHORITY_REQUIRED';
  readonly status = 403;
  constructor() {
    super('صلاحية إدارة اشتراكات المنصة مطلوبة');
    this.name = 'DrvoPlatformAuthorityDeniedError';
  }
}

/**
 * Only call with userId resolved from verified server session, never request JSON.
 * The caller must still enforce staging mutation restrictions, CSRF protection,
 * tenant existence, transaction/idempotency and audit before writing anything.
 */
export async function requirePlatformEntitlementManager(
  authenticatedUserId: number,
  opts: { executor?: TenantSqlExecutor } = {},
): Promise<void> {
  const principal = await loadPlatformPrincipal(authenticatedUserId, opts);
  if (!canManageCommercialEntitlements(principal, authenticatedUserId)) {
    throw new DrvoPlatformAuthorityDeniedError();
  }
}
