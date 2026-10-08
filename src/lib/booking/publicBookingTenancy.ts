/**
 * DRVO-019 — public booking tenancy.
 *
 * Every public booking request is served for exactly one tenant:
 * - `branchCode` (required for every tenant) → active TblBranch → its active Location → TenantId;
 * - only when `branchCode` is absent, the CASHER_BOOT (cutsaloon.com) compatibility fallback may
 *   apply through the named `public-booking-cut-compat` seam, and only for requests whose Origin
 *   is absent or one of CUT's legacy allowlisted origins.
 * Booking is an optional app: a tenant without the `booking` app installed (or whose subscription
 * is not active) is answered exactly like an unknown branch (404).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchByCode } from '@/lib/branch/repository';
import {
  listPublicDiscoverableBranches,
  tryNormalizePublicBranchCode,
  type PublicDiscoverableBranch,
} from '@/lib/booking/publicBookingBranchContext';
import {
  getPublicBookingAllowedOrigins,
  normalizePublicBookingOrigin,
} from '@/lib/booking/publicBookingCors';
import {
  resolvePublicTenantForBookingCode,
  resolvePublicTenantForBranchId,
} from '@/lib/booking/publicBookingTenant';
import {
  evaluateTenantSubscriptionGate,
  getTenantInstalledAppsForGate,
} from '@/platform/commercial/tenantAccessGate';
import { getTenantBrandProfileCached } from '@/platform/branding/brandRepository';
import { resolveLegacyBootstrapTenantId } from '@/platform/tenant/legacyBootstrapSeam';
import { isTenantContextError, listTenantLegacyBranchIds } from '@/platform/tenant/tenantContext';

export const PUBLIC_BOOKING_APP_CODE = 'booking';

export type PublicBookingTenancy = {
  tenantId: string;
  /** `branch`: derived from the request branch code. `cut-compat`: CASHER_BOOT legacy fallback. */
  source: 'branch' | 'cut-compat';
  branchCode: string | null;
  branchId: number | null;
};

export type PublicBookingTenancyDeniedCode =
  | 'BRANCH_REQUIRED'
  | 'INVALID_BRANCH_CODE'
  | 'BRANCH_NOT_FOUND';

export type PublicBookingTenancyResult =
  | { ok: true; tenancy: PublicBookingTenancy }
  | { ok: false; code: PublicBookingTenancyDeniedCode };

function logDenied(route: string, reason: string): void {
  console.warn('[public-booking-tenancy] denied', { route, reason });
}

/** Booking app installed and subscription allowed; any failure answers false (fail closed). */
export async function isPublicBookingAvailableForTenant(tenantId: string): Promise<boolean> {
  try {
    const apps = await getTenantInstalledAppsForGate(tenantId);
    if (!apps.includes(PUBLIC_BOOKING_APP_CODE)) return false;
    const subscription = await evaluateTenantSubscriptionGate(tenantId);
    return subscription.allowed;
  } catch (err) {
    console.warn('[public-booking-tenancy] app gate failed', err instanceof Error ? err.message : err);
    return false;
  }
}

const BRANCH_TENANT_TTL_MS = 30_000;
const branchTenantCacheKey = '__pos_public_booking_branch_tenant_v1';

function branchTenantCache(): Map<number, { tenantId: string | null; expiresAt: number }> {
  const g = globalThis as typeof globalThis & {
    [branchTenantCacheKey]?: Map<number, { tenantId: string | null; expiresAt: number }>;
  };
  if (!g[branchTenantCacheKey]) g[branchTenantCacheKey] = new Map();
  return g[branchTenantCacheKey]!;
}

export function invalidatePublicBookingTenancyCache(): void {
  branchTenantCache().clear();
  allOriginsCache = null;
}

/**
 * Tenant that may serve public booking for a legacy branch: the branch's Location tenant, with
 * the booking app installed. Null when unmapped, ambiguous, inactive or not entitled.
 */
export async function resolvePublicBookingTenantIdForBranch(
  branchId: number,
  route: string,
): Promise<string | null> {
  if (!Number.isInteger(branchId) || branchId <= 0) return null;
  const cache = branchTenantCache();
  const hit = cache.get(branchId);
  let tenantId: string | null;
  if (hit && hit.expiresAt > Date.now()) {
    tenantId = hit.tenantId;
  } else {
    tenantId = (await resolvePublicTenantForBranchId(branchId, route))?.tenantId ?? null;
    if (cache.size >= 256) cache.clear();
    cache.set(branchId, { tenantId, expiresAt: Date.now() + BRANCH_TENANT_TTL_MS });
  }
  if (!tenantId) return null;
  if (!(await isPublicBookingAvailableForTenant(tenantId))) {
    logDenied(route, 'booking_app_unavailable');
    return null;
  }
  return tenantId;
}

/**
 * A request may use the CUT compatibility fallback only when it carries no Origin (server-side /
 * same-origin GET) or an Origin on CUT's legacy allowlist (PUBLIC_BOOKING_ALLOWED_ORIGINS).
 * Any other tenant's site must name its branch.
 */
export function isCutCompatPublicBookingRequest(req: Request): boolean {
  const raw = req.headers.get('origin');
  if (raw == null || raw.trim() === '') return true;
  const origin = normalizePublicBookingOrigin(raw);
  if (!origin) return false;
  return getPublicBookingAllowedOrigins().origins.includes(origin);
}

async function resolveCutCompatTenantId(): Promise<string | null> {
  try {
    return await resolveLegacyBootstrapTenantId('public-booking-cut-compat');
  } catch (err) {
    if (isTenantContextError(err)) return null;
    throw err;
  }
}

/**
 * Resolve the tenant of a public booking request.
 * `allowCutCompat`: the route historically accepted requests without a branch code (CUT widget
 * global barbers / upcoming-by-phone); only those routes may fall back to CASHER_BOOT.
 */
export async function resolvePublicBookingTenancy(
  req: Request,
  args: { branchCode: string | null | undefined; route: string; allowCutCompat?: boolean },
): Promise<PublicBookingTenancyResult> {
  const raw = args.branchCode == null ? '' : String(args.branchCode).trim();
  if (raw) {
    const normalized = tryNormalizePublicBranchCode(raw);
    if (!normalized.ok) {
      const code = normalized.error.code === 'BRANCH_REQUIRED' ? 'BRANCH_REQUIRED' : 'INVALID_BRANCH_CODE';
      return { ok: false, code };
    }
    const branch = await getBranchByCode(normalized.code);
    if (!branch || !branch.isActive) {
      logDenied(args.route, 'branch_unknown_or_inactive');
      return { ok: false, code: 'BRANCH_NOT_FOUND' };
    }
    const tenantId = await resolvePublicBookingTenantIdForBranch(branch.branchId, args.route);
    if (!tenantId) return { ok: false, code: 'BRANCH_NOT_FOUND' };
    return {
      ok: true,
      tenancy: { tenantId, source: 'branch', branchCode: branch.branchCode, branchId: branch.branchId },
    };
  }

  if (!args.allowCutCompat || !isCutCompatPublicBookingRequest(req)) {
    return { ok: false, code: 'BRANCH_REQUIRED' };
  }
  const tenantId = await resolveCutCompatTenantId();
  if (!tenantId || !(await isPublicBookingAvailableForTenant(tenantId))) {
    logDenied(args.route, 'cut_compat_unavailable');
    return { ok: false, code: 'BRANCH_REQUIRED' };
  }
  return { ok: true, tenancy: { tenantId, source: 'cut-compat', branchCode: null, branchId: null } };
}

/**
 * Tenant of an existing booking (from the booking's own branch), with the booking app gate.
 * A booking whose tenant lost the app is reported as not found.
 */
export async function resolvePublicBookingTenancyForCode(
  code: string,
  route: string,
): Promise<{ ok: true; tenantId: string } | { ok: false; reason: 'invalid_code' | 'not_found' }> {
  const owner = await resolvePublicTenantForBookingCode(code, route);
  if (!owner.ok) return owner;
  if (!(await isPublicBookingAvailableForTenant(owner.tenant.tenantId))) {
    logDenied(route, 'booking_app_unavailable');
    return { ok: false, reason: 'not_found' };
  }
  return { ok: true, tenantId: owner.tenant.tenantId };
}

/**
 * Browser origins allowed to read this tenant's public booking responses: the tenant brand
 * profile `PublicBookingOrigins`; CASHER_BOOT additionally keeps its legacy env allowlist.
 * Local dev defaults (non-production, env unset) apply to every tenant.
 */
export async function loadPublicBookingTenantOrigins(tenantId: string): Promise<string[]> {
  const out = new Set<string>();
  try {
    const brand = await getTenantBrandProfileCached(tenantId);
    for (const o of brand?.publicBookingOrigins ?? []) {
      const n = normalizePublicBookingOrigin(o);
      if (n) out.add(n);
    }
  } catch (err) {
    console.warn('[public-booking-tenancy] brand origins unavailable', err instanceof Error ? err.message : err);
  }
  const legacy = getPublicBookingAllowedOrigins();
  if (legacy.source === 'dev_default' || (legacy.origins.length > 0 && (await resolveCutCompatTenantId()) === tenantId)) {
    for (const o of legacy.origins) out.add(o);
  }
  return [...out];
}

const ALL_ORIGINS_TTL_MS = 60_000;
let allOriginsCache: { origins: string[]; expiresAt: number } | null = null;

/**
 * Preflight only (no tenant data is returned): the union of every active tenant's configured
 * public booking origins. The real response is still gated by its own tenant's origins.
 */
export async function loadAnyTenantPublicBookingOrigins(): Promise<string[]> {
  if (allOriginsCache && allOriginsCache.expiresAt > Date.now()) return allOriginsCache.origins;
  const out = new Set<string>();
  try {
    const db = await getPool();
    const r = await db.request().query(`
      SELECT b.PublicBookingOrigins
      FROM dbo.TenantBrandProfile b
      INNER JOIN dbo.Tenant t ON t.TenantId = b.TenantId
      WHERE t.Status = N'active' AND b.PublicBookingOrigins IS NOT NULL;
    `);
    for (const row of (r.recordset ?? []) as Array<{ PublicBookingOrigins: unknown }>) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(row.PublicBookingOrigins));
      } catch {
        continue;
      }
      if (!Array.isArray(parsed)) continue;
      for (const o of parsed) {
        const n = normalizePublicBookingOrigin(o);
        if (n) out.add(n);
      }
    }
  } catch (err) {
    console.warn('[public-booking-tenancy] origin union unavailable', err instanceof Error ? err.message : err);
  }
  allOriginsCache = { origins: [...out], expiresAt: Date.now() + ALL_ORIGINS_TTL_MS };
  return allOriginsCache.origins;
}

/** Employee row exists in the tenant (TblEmp.TenantId). */
export async function isPublicBookingTenantEmployee(tenantId: string, empId: number): Promise<boolean> {
  if (!Number.isInteger(empId) || empId <= 0) return false;
  const db = await getPool();
  const r = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`SELECT TOP 1 1 AS ok FROM dbo.TblEmp WHERE EmpID = @empId AND TenantId = @tenantId;`);
  return (r.recordset?.length ?? 0) > 0;
}

/** Public discoverable branches that belong to the tenant (never another tenant's branches). */
export async function listPublicDiscoverableBranchesForTenant(
  tenantId: string,
): Promise<PublicDiscoverableBranch[]> {
  const [all, owned] = await Promise.all([
    listPublicDiscoverableBranches(),
    listTenantLegacyBranchIds(tenantId),
  ]);
  return all.filter((b) => owned.has(b.branchId));
}

/** Branch must be one of the tenant's active Locations (legacy BranchIDs). */
export function tenantLocationBranchSql(branchColumn: string): string {
  return `EXISTS (SELECT 1 FROM dbo.Location tl WHERE tl.LegacyBranchId = ${branchColumn} AND tl.TenantId = @tenantId AND tl.Status = N'active')`;
}
