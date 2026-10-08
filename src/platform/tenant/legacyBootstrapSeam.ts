import 'server-only';
import { getPool, sql } from '@/lib/db';
import { BOOTSTRAP_TENANT_CODE } from './types';
import { TenantContextError } from './tenantContext';

/**
 * Named CASHER_BOOT compatibility seams. These are the ONLY places allowed to resolve the
 * bootstrap tenant by code. Each one exists because the data it touches has no TenantId and
 * belongs to CASHER_BOOT only, or because CASHER_BOOT is the platform-owner tenant.
 * Never use this to default a request that lacks tenant context.
 */
export const LEGACY_BOOTSTRAP_SEAMS = {
  /** Platform operators must be members of the platform-owner tenant. */
  'platform-operator-tenant': 'CASHER_BOOT owns the DRVOERP control plane',
  /**
   * Staff features over global legacy tables with neither TenantId nor BranchID (e.g. TblBudgetMonth,
   * the cross-branch daily HR WhatsApp report over TblEmp).
   */
  'legacy-global-data': 'global legacy tables are CASHER_BOOT-only until tenant-owned',
  /** TblAutoGenLog (payroll auto-generate / nightly-close log) has no TenantId and holds CASHER_BOOT runs only. */
  'legacy-payroll-job-log': 'TblAutoGenLog is a CASHER_BOOT-only legacy table',
  /** Staging smoke scripts that explicitly exercise the CASHER_BOOT tenant (never request paths). */
  'casher-boot-staging-smoke': 'staging smoke scripts target CASHER_BOOT by name',
  /** Operator CLI scripts that provision CASHER_BOOT branches by name (never request paths). */
  'casher-boot-operator-script': 'operator scripts provision CASHER_BOOT branches by name',
  /**
   * cutsaloon.com public booking widget calls that historically carried no branch code (global
   * barbers, upcoming-by-phone). Only reachable when branchCode is absent AND the request Origin is
   * absent or on CUT's legacy allowlist; every other tenant must name its branch.
   */
  'public-booking-cut-compat': 'CUT public booking widget predates branch-scoped tenancy',
} as const;

export type LegacyBootstrapSeam = keyof typeof LEGACY_BOOTSTRAP_SEAMS;

let cached: { tenantId: string; expiresAt: number } | null = null;
const TTL_MS = 60_000;

export async function resolveLegacyBootstrapTenantId(seam: LegacyBootstrapSeam): Promise<string> {
  if (!(seam in LEGACY_BOOTSTRAP_SEAMS)) {
    throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', `Unknown legacy seam ${String(seam)}`);
  }
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.tenantId;
  const db = await getPool();
  const result = await db
    .request()
    .input('code', sql.NVarChar(64), BOOTSTRAP_TENANT_CODE)
    .query(`SELECT TenantId FROM dbo.Tenant WHERE Code = @code AND Status = N'active';`);
  const id = result.recordset[0]?.TenantId;
  if (!id) {
    throw new TenantContextError('TENANT_CONTEXT_UNRESOLVED', `${BOOTSTRAP_TENANT_CODE} is not active (${seam})`);
  }
  cached = { tenantId: String(id).toLowerCase(), expiresAt: now + TTL_MS };
  return cached.tenantId;
}

/** Test-only. */
export function resetLegacyBootstrapSeamCache(): void {
  cached = null;
}
