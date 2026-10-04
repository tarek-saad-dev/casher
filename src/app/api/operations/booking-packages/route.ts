/**
 * GET /api/operations/booking-packages?branchCode=GLEEM
 * Packages for the ops booking workspace, resolved for the branch (price / duration /
 * services from the DB via the public booking package resolver).
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch/context';
import { listUserOpsVisibleBranchIds } from '@/lib/branch/opsWriteBranch';
import { getBranchByCode } from '@/lib/branch/repository';
import { PublicBookingBranchContextError } from '@/lib/booking/publicBookingBranchContext';
import { listOpsBookablePackages } from '@/lib/operations/opsBookablePackages';
import type { OpsBookablePackagesResponse } from '@/lib/operations/opsBookablePackagesTypes';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  const requested = req.nextUrl.searchParams.get('branchCode')?.trim().toUpperCase();
  const branchCode = requested || branch.branchCode;

  try {
    if (branchCode !== branch.branchCode.toUpperCase()) {
      const target = await getBranchByCode(branchCode);
      const visible = target ? await listUserOpsVisibleBranchIds(branch.userId) : null;
      if (!target || !visible?.has(target.branchId)) {
        return NextResponse.json(
          { ok: false, error: 'لا تملك صلاحية على هذا الفرع', code: 'NO_BRANCH_ACCESS' },
          { status: 403 },
        );
      }
    }


    const result = await listOpsBookablePackages({
      branchCode,
      auth: { userId: branch.userId, canOperate: branch.canOperate },
    });
    const body: OpsBookablePackagesResponse = { ok: true, ...result };
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    if (err instanceof PublicBookingBranchContextError) {
      return NextResponse.json(
        { ok: false, error: err.message, code: err.code },
        { status: err.httpStatus },
      );
    }
    console.error('[api/operations/booking-packages]', err);
    return NextResponse.json(
      { ok: false, error: 'تعذر تحميل الباكدجات' },
      { status: 500 },
    );
  }
}
