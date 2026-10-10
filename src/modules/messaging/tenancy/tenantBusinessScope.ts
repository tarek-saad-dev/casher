import { getPool, sql } from '@/lib/db';
import { TenantScopedMemo } from '@/platform/tenant/tenantMemo';
import { assertLegacyUserInTenant, isTenantContextError } from '@/platform/tenant/tenantContext';
import { requireMessagingTenantId } from './messagingTenantScope';
import { getCurrentTenantAiConfig } from './tenantAiConfig';

type TenantLocation = { legacyBranchId: number; branchCode: string };

async function loadTenantLocations(tenantId: string): Promise<TenantLocation[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT LegacyBranchId, BranchCode FROM dbo.Location
      WHERE TenantId = @tenantId AND Status = N'active';
    `);
  return (result.recordset as Array<{ LegacyBranchId: number; BranchCode: string }>).map((r) => ({
    legacyBranchId: Number(r.LegacyBranchId),
    branchCode: String(r.BranchCode),
  }));
}

const locationsMemo = new TenantScopedMemo<TenantLocation[]>('messaging-locations', 30_000);
let locationLoader: (tenantId: string) => Promise<TenantLocation[]> = loadTenantLocations;

/** Test seam (pass null to restore SQL). */
export function setTenantLocationLoaderForTests(
  next: ((tenantId: string) => Promise<TenantLocation[]>) | null,
): void {
  locationLoader = next ?? loadTenantLocations;
  locationsMemo.clear();
}

async function currentTenantLocations(): Promise<TenantLocation[]> {
  const tenantId = requireMessagingTenantId('currentTenantLocations');
  return locationsMemo.getOrLoad(tenantId, ['active'], () => locationLoader(tenantId));
}

/** Legacy branch ids of the current messaging tenant's active locations. */
export async function currentTenantLegacyBranchIds(): Promise<Set<number>> {
  return new Set((await currentTenantLocations()).map((l) => l.legacyBranchId));
}

/** Branch codes of the current messaging tenant's active locations (upper-case). */
export async function currentTenantBranchCodes(): Promise<Set<string>> {
  return new Set((await currentTenantLocations()).map((l) => l.branchCode.toUpperCase()));
}

/** True when the branch (by legacy id or code) is an active location of the current tenant. */
export async function isBranchInCurrentTenant(ref: {
  branchId?: number | null;
  branchCode?: string | null;
}): Promise<boolean> {
  const locations = await currentTenantLocations();
  const code = ref.branchCode ? String(ref.branchCode).trim().toUpperCase() : null;
  return locations.some(
    (l) =>
      (ref.branchId != null && l.legacyBranchId === Number(ref.branchId)) ||
      (code !== null && l.branchCode.toUpperCase() === code),
  );
}

/** Keeps only rows whose branch belongs to the current tenant. */
export async function filterToCurrentTenantBranches<T>(
  rows: readonly T[],
  ref: (row: T) => { branchId?: number | null; branchCode?: string | null },
): Promise<T[]> {
  const locations = await currentTenantLocations();
  const ids = new Set(locations.map((l) => l.legacyBranchId));
  const codes = new Set(locations.map((l) => l.branchCode.toUpperCase()));
  return rows.filter((row) => {
    const r = ref(row);
    if (r.branchId != null && ids.has(Number(r.branchId))) return true;
    return r.branchCode != null && codes.has(String(r.branchCode).trim().toUpperCase());
  });
}

/**
 * Staff actor the AI receptionist books as: TenantAiConfig.BookingActorUserId, which must be a
 * member of the tenant. Null when unconfigured or not a member — booking then fails closed.
 */
export async function resolveCurrentTenantBookingActor(): Promise<number | null> {
  const tenantId = requireMessagingTenantId('resolveCurrentTenantBookingActor');
  const config = await getCurrentTenantAiConfig();
  const actor = config?.bookingActorUserId ?? null;
  if (actor == null) return null;
  try {
    await assertLegacyUserInTenant(tenantId, actor);
    return actor;
  } catch (err) {
    if (isTenantContextError(err)) return null;
    throw err;
  }
}

export function resetTenantBusinessScopeCaches(): void {
  locationsMemo.clear();
}
