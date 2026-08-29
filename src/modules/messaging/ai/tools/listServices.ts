import 'server-only';
import {
  listPublicDiscoverableBranches,
  resolvePublicBookingBranchContext,
  PublicBookingBranchContextError,
} from '@/lib/booking/publicBookingBranchContext';
import { getPublicBookingServicesCatalog } from '@/lib/booking/publicBookingServices';
import { MAX_SERVICES_RETURNED, type AiToolCallRequest, type AiToolResult } from './types';
import { textMatchesQuery } from './dateText';

async function resolveBranchCode(branchCode?: string | null): Promise<string | null> {
  if (branchCode && branchCode.trim()) return branchCode.trim().toUpperCase();
  const pubs = await listPublicDiscoverableBranches();
  if (pubs.length === 1) return pubs[0]!.branchCode;
  return pubs[0]?.branchCode ?? null;
}

export async function executeListServices(
  request: AiToolCallRequest,
): Promise<Omit<AiToolResult, 'durationMs'>> {
  const branchCode = await resolveBranchCode(request.branchCode);
  const input = {
    branchCode,
    serviceQuery: request.serviceQuery ?? null,
  };
  if (!branchCode) {
    return {
      name: 'list_services',
      ok: false,
      input,
      errorCode: 'BRANCH_REQUIRED',
      errorMessage: 'No public branch available for service lookup',
    };
  }

  try {
    const ctx = await resolvePublicBookingBranchContext({
      branchCode,
      purpose: 'public_booking',
    });
    const catalog = await getPublicBookingServicesCatalog(ctx);
    let services = catalog.services.map((s) => ({
      serviceId: s.serviceId,
      name: s.name,
      nameAr: s.nameAr,
      nameEn: s.nameEn,
      price: s.price,
      durationMinutes: s.durationMinutes,
      categoryNameAr: s.categoryNameAr,
      bookable: s.bookable,
    }));

    if (request.serviceQuery && request.serviceQuery.trim()) {
      const q = request.serviceQuery.trim();
      services = services.filter(
        (s) =>
          textMatchesQuery(s.nameAr, q) ||
          textMatchesQuery(s.nameEn || '', q) ||
          textMatchesQuery(s.name, q) ||
          textMatchesQuery(s.categoryNameAr, q),
      );
    }

    const bounded = services.slice(0, MAX_SERVICES_RETURNED);
    return {
      name: 'list_services',
      ok: true,
      input,
      data: {
        branchCode: ctx.branchCode,
        branchName: ctx.branchName,
        matched: Boolean(request.serviceQuery),
        count: bounded.length,
        services: bounded,
        priceDetermined: bounded.every((s) => Number.isFinite(s.price)),
      },
    };
  } catch (err) {
    const code =
      err instanceof PublicBookingBranchContextError ? err.code : 'SERVICE_LOOKUP_FAILED';
    return {
      name: 'list_services',
      ok: false,
      input,
      errorCode: code,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
