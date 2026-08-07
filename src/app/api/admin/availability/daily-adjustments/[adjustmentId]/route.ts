/**
 * DELETE /api/admin/availability/daily-adjustments/[adjustmentId]
 * Soft-cancel (IsActive=0, CancelledAt set). Branch-scoped.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireWorkforceAvailabilityAccess } from '@/lib/api-auth';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch/context';
import {
  cancelDailyAdjustment,
  DailyAdjustmentServiceError,
} from '@/lib/availability/dailyAdjustmentService';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ adjustmentId: string }> };

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const auth = await requireWorkforceAvailabilityAccess();
  if (!isAuthResult(auth)) return auth;

  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  try {
    const { adjustmentId: raw } = await context.params;
    const adjustmentId = Number(raw);
    if (!Number.isInteger(adjustmentId) || adjustmentId <= 0) {
      return NextResponse.json(
        { ok: false, code: 'ADJUSTMENT_NOT_FOUND', error: 'التعديل غير موجود' },
        { status: 404 },
      );
    }

    const result = await cancelDailyAdjustment({
      branchId: branch.branchId,
      adjustmentId,
      cancelledBy: auth.userId,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof DailyAdjustmentServiceError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: err.status },
      );
    }
    console.error('[admin/availability/daily-adjustments DELETE]', err);
    return NextResponse.json(
      { ok: false, error: 'فشل إلغاء التعديل اليومي' },
      { status: 500 },
    );
  }
}
