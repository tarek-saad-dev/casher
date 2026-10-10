/**
 * DRVO-015 — anonymous catalog callers name the salon through its public branch (branchCode, or
 * the existing single-public-branch compatibility rule). The catalog is that branch's tenant
 * catalog; an unknown or unmapped branch resolves to null (caller answers "not found").
 */
import 'server-only';
import {
  extractPublicBranchCode,
  resolvePublicBranchCode,
} from '@/lib/branch/bookingQueueOwnership';
import { BranchDomainError } from '@/lib/branch/types';
import { resolvePublicTenantForBranchId } from '@/lib/booking/publicBookingTenant';

export async function resolvePublicCatalogTenantId(
  searchParams: URLSearchParams,
  route: string,
): Promise<string | null> {
  try {
    const branch = await resolvePublicBranchCode(extractPublicBranchCode(searchParams), { route });
    const tenant = await resolvePublicTenantForBranchId(branch.branchId, route);
    return tenant?.tenantId ?? null;
  } catch (err) {
    if (err instanceof BranchDomainError) return null;
    throw err;
  }
}
