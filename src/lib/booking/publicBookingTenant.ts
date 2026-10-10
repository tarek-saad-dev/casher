/**
 * DRVO-013 — public booking tenant derivation.
 * Anonymous routes have no session; the tenant is derived from the explicit public identity the
 * request names (branch code, booking code, hold key) through dbo.Location. There is no default
 * or first-tenant fallback: unmapped, ambiguous or cross-tenant identities resolve to null and the
 * caller answers with its normal non-disclosing "not found" response.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { normalizePublicBookingCode } from '@/lib/booking/publicBookingReader';
import {
  isTenantContextError,
  resolvePublicTenantContext,
  type PublicTenantContext,
} from '@/platform/tenant/tenantContext';

function logDenied(route: string, reason: string): void {
  console.warn('[public-booking-tenant] denied', { route, reason });
}

async function resolveOrNull(
  identity: { branchCode: string } | { legacyBranchId: number },
  route: string,
  staffTenantId?: string | null,
): Promise<PublicTenantContext | null> {
  try {
    const ctx = await resolvePublicTenantContext(identity);
    if (staffTenantId && ctx.tenantId !== staffTenantId.toLowerCase()) {
      logDenied(route, 'staff_tenant_mismatch');
      return null;
    }
    return ctx;
  } catch (err) {
    if (isTenantContextError(err)) {
      logDenied(route, err.code);
      return null;
    }
    throw err;
  }
}

/**
 * Tenant of a public branch code. When `staffTenantId` is given (internal ops calling the public
 * routes) the branch must belong to the staff member's tenant.
 */
export async function resolvePublicTenantForBranchCode(
  branchCode: string | null | undefined,
  route: string,
  opts: { staffTenantId?: string | null } = {},
): Promise<PublicTenantContext | null> {
  const code = String(branchCode ?? '').trim();
  if (!code) return null;
  return resolveOrNull({ branchCode: code }, route, opts.staffTenantId);
}

export async function resolvePublicTenantForBranchId(
  branchId: number,
  route: string,
): Promise<PublicTenantContext | null> {
  if (!Number.isInteger(branchId) || branchId <= 0) return null;
  return resolveOrNull({ legacyBranchId: branchId }, route);
}

export type PublicBookingCodeTenant =
  | { ok: true; tenant: PublicTenantContext }
  | { ok: false; reason: 'invalid_code' | 'not_found' };

/** Tenant of an existing booking, derived from the booking's own branch. */
export async function resolvePublicTenantForBookingCode(
  rawCode: string,
  route: string,
): Promise<PublicBookingCodeTenant> {
  let code: string;
  try {
    code = normalizePublicBookingCode(rawCode);
  } catch {
    return { ok: false, reason: 'invalid_code' };
  }
  const db = await getPool();
  const r = await db
    .request()
    .input('code', sql.NVarChar(32), code)
    .query(`SELECT TOP 1 BranchID FROM dbo.Bookings WHERE BookingCode = @code;`);
  const branchId = Number(r.recordset[0]?.BranchID ?? 0);
  const tenant = await resolvePublicTenantForBranchId(branchId, route);
  return tenant ? { ok: true, tenant } : { ok: false, reason: 'not_found' };
}

/**
 * Tenant of an active slot hold. Port-path holds are stored tenant-namespaced
 * (`t:{tenant}:{clientKey}`); a candidate only counts when its prefix matches the tenant that
 * owns the hold's branch. If the same client key is active for more than one tenant the result
 * is ambiguous and nothing is resolved (fail closed).
 */
export async function resolvePublicTenantForHoldKey(
  holdKey: string,
  route: string,
): Promise<PublicTenantContext | null> {
  let raw = holdKey.trim();
  // POST /hold returns the stored (tenant-prefixed) key; clients may echo it back verbatim.
  const prefixed = /^t:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(.+)$/i.exec(raw);
  const claimedTenant = prefixed ? prefixed[1].toLowerCase() : null;
  if (prefixed) raw = prefixed[2];
  if (!raw) return null;
  const db = await getPool();
  const r = await db
    .request()
    .input('suffix', sql.NVarChar(220), `:${raw}`)
    .query(`
      IF OBJECT_ID(N'dbo.TblBookingHold', N'U') IS NOT NULL
        SELECT TOP 20 BranchID, HoldKey FROM dbo.TblBookingHold
        WHERE Status = N'active'
          AND LEFT(HoldKey, 2) = N't:'
          AND RIGHT(HoldKey, LEN(@suffix)) = @suffix;
    `);
  const rows = (r.recordset ?? []) as Array<{ BranchID: number; HoldKey: string }>;
  const matches = new Map<string, PublicTenantContext>();
  for (const row of rows) {
    const tenant = await resolvePublicTenantForBranchId(Number(row.BranchID), route);
    if (tenant && String(row.HoldKey).toLowerCase() === `t:${tenant.tenantId}:${raw}`.toLowerCase()) {
      matches.set(tenant.tenantId, tenant);
    }
  }
  if (claimedTenant) {
    const claimed = matches.get(claimedTenant);
    return claimed ?? null;
  }
  if (matches.size !== 1) {
    if (matches.size > 1) logDenied(route, 'hold_key_ambiguous');
    return null;
  }
  return [...matches.values()][0];
}
