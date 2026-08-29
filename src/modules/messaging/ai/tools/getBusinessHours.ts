import 'server-only';
import {
  listPublicDiscoverableBranches,
  resolvePublicBookingBranchContext,
  PublicBookingBranchContextError,
} from '@/lib/booking/publicBookingBranchContext';
import { getBranchById } from '@/lib/branch/repository';
import type { AiToolCallRequest, AiToolResult } from './types';

export async function executeGetBusinessHours(
  request: AiToolCallRequest,
): Promise<Omit<AiToolResult, 'durationMs'>> {
  let branchCode = request.branchCode?.trim() || null;
  if (!branchCode) {
    const pubs = await listPublicDiscoverableBranches();
    if (pubs.length === 1) branchCode = pubs[0]!.branchCode;
  }
  const input = { branchCode };

  if (!branchCode) {
    return {
      name: 'get_business_hours',
      ok: false,
      input,
      errorCode: 'BRANCH_REQUIRED',
      errorMessage: 'Specify which branch for opening hours',
    };
  }

  try {
    const ctx = await resolvePublicBookingBranchContext({
      branchCode,
      purpose: 'public_discovery',
    });
    const full = await getBranchById(ctx.branchId);
    return {
      name: 'get_business_hours',
      ok: true,
      input,
      data: {
        branchId: ctx.branchId,
        branchCode: ctx.branchCode,
        branchName: ctx.branchName,
        timeZone: ctx.timezone,
        openTime: ctx.operatingHours.openTime ?? full?.defaultOpenTime ?? null,
        closeTime: ctx.operatingHours.closeTime ?? full?.defaultCloseTime ?? null,
        publicBookingEnabled: ctx.publicBookingEnabled,
        bookingEnabled: ctx.bookingEnabled,
      },
    };
  } catch (err) {
    const code =
      err instanceof PublicBookingBranchContextError ? err.code : 'HOURS_LOOKUP_FAILED';
    return {
      name: 'get_business_hours',
      ok: false,
      input,
      errorCode: code,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
