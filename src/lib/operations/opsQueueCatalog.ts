/**
 * Ops Queue catalog resolution — prefer Booking V2 bootstrap, fallback to /api/services.
 * Presentation/orchestration only; does not change queue domain APIs.
 */

import type { BookingSelectService } from '@/components/operations/BookingServiceSelect';
import type { V2PublicBootstrapResponse } from '@/lib/booking/v2Frontend/publicSafeDtos';

export type OpsQueueCatalogSource = 'bootstrap' | 'api' | 'pending';

export function mapBootstrapServiceToOpsPicker(s: {
  serviceId: number;
  nameAr: string;
  nameEn: string;
  name: string;
  price: number;
  durationMinutes: number;
  categoryId: string;
  categoryNameAr: string;
  categoryNameEn: string;
}): BookingSelectService {
  return {
    ProID: s.serviceId,
    ProName: s.nameAr || s.name || s.nameEn,
    ProNameEn: s.nameEn || null,
    SPrice: s.price,
    DurationMinutes: s.durationMinutes,
    CatName: s.categoryNameAr || s.categoryNameEn || null,
    CatID: s.categoryId || null,
  };
}

export function servicesFromBootstrapBranch(
  bootstrap: V2PublicBootstrapResponse | null | undefined,
  branchCode: string | null | undefined,
): BookingSelectService[] {
  if (!bootstrap || !branchCode) return [];
  const key = branchCode.toUpperCase();
  const list =
    bootstrap.servicesByBranch[key]
    ?? bootstrap.servicesByBranch[branchCode]
    ?? [];
  return list.map(mapBootstrapServiceToOpsPicker);
}

/**
 * Decide whether Queue UI should wait / use bootstrap / hit /api/services.
 * Pure helper for tests + hook.
 */
export function resolveOpsQueueCatalogDecision(args: {
  branchCode: string | null | undefined;
  bootstrap: V2PublicBootstrapResponse | null | undefined;
  bootstrapStatus: 'idle' | 'loading' | 'ready' | 'error';
  bootstrapServicesCount: number;
}): { action: 'use_bootstrap' | 'wait' | 'fetch_api'; reason: string } {
  const { bootstrapStatus, bootstrapServicesCount } = args;
  if (bootstrapStatus === 'ready' && bootstrapServicesCount > 0) {
    return { action: 'use_bootstrap', reason: 'warm_bootstrap' };
  }
  if (bootstrapStatus === 'idle' || bootstrapStatus === 'loading') {
    return { action: 'wait', reason: 'bootstrap_pending' };
  }
  return { action: 'fetch_api', reason: bootstrapStatus === 'error' ? 'bootstrap_error' : 'empty_branch_catalog' };
}

export async function fetchOpsQueueServicesFallback(
  fetchImpl: typeof fetch = fetch,
): Promise<BookingSelectService[]> {
  const res = await fetchImpl('/api/services?active=true&bookable=true');
  const d = await res.json();
  const raw = (d.services ?? d ?? []) as Array<BookingSelectService & { SPrice1?: number; isDeleted?: boolean }>;
  return raw
    .filter((s) => !s.isDeleted)
    .map((s) => ({
      ...s,
      SPrice: s.SPrice ?? s.SPrice1 ?? 0,
    }));
}
