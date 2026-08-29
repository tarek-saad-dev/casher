import 'server-only';
import { listPublicDiscoverableBranches } from '@/lib/booking/publicBookingBranchContext';
import { getBranchById } from '@/lib/branch/repository';
import type { AiToolCallRequest, AiToolResult } from './types';

export async function executeListBranches(
  request: AiToolCallRequest,
): Promise<Omit<AiToolResult, 'durationMs'>> {
  const input = {
    branchCode: request.branchCode ?? null,
  };
  const branches = await listPublicDiscoverableBranches();
  let filtered = branches;
  if (request.branchCode) {
    const code = request.branchCode.trim().toUpperCase();
    filtered = branches.filter(
      (b) =>
        b.branchCode.toUpperCase() === code ||
        b.branchName.includes(request.branchCode!) ||
        (b.shortName != null && b.shortName.includes(request.branchCode!)),
    );
  }

  const enriched = await Promise.all(
    filtered.slice(0, 20).map(async (b) => {
      const full = await getBranchById(b.branchId);
      return {
        branchId: b.branchId,
        branchCode: b.branchCode,
        branchName: b.branchName,
        shortName: b.shortName,
        address: b.address,
        phone: b.phone,
        timeZone: b.timeZone,
        openTime: full?.defaultOpenTime ?? null,
        closeTime: full?.defaultCloseTime ?? null,
        publicBookingEnabled: true,
      };
    }),
  );

  return {
    name: 'list_branches',
    ok: true,
    input,
    data: {
      count: enriched.length,
      branches: enriched,
    },
  };
}
