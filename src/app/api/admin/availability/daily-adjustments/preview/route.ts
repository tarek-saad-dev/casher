/**
 * POST /api/admin/availability/daily-adjustments/preview
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireWorkforceAvailabilityAccess } from '@/lib/api-auth';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch/context';
import {
  isDailyAdjustmentType,
  isValidBusinessDate,
  type DailyAdjustmentType,
} from '@/lib/availability/dailyAdjustments';
import { previewDailyAdjustmentMutation } from '@/lib/availability/dailyAdjustmentPreview';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const auth = await requireWorkforceAvailabilityAccess();
  if (!isAuthResult(auth)) return auth;

  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const empId = Number(body.empId);
    const businessDate = typeof body.businessDate === 'string' ? body.businessDate : '';
    const adjustmentType = body.adjustmentType;

    if (!isValidBusinessDate(businessDate) || !Number.isInteger(empId) || empId <= 0) {
      return NextResponse.json(
        { ok: false, code: 'INVALID_INPUT', error: 'مدخلات غير صالحة' },
        { status: 400 },
      );
    }
    if (!isDailyAdjustmentType(adjustmentType)) {
      return NextResponse.json(
        { ok: false, code: 'INVALID_ADJUSTMENT_TYPE', error: 'نوع التعديل غير صالح' },
        { status: 400 },
      );
    }

    const windowsRaw = Array.isArray(body.windows) ? body.windows : undefined;
    const windows = windowsRaw?.map((w) => {
      const row = w as Record<string, unknown>;
      return {
        start: String(row.start ?? ''),
        end: String(row.end ?? ''),
        endDayOffset:
          row.endDayOffset === 1 || row.endDayOffset === 0
            ? (row.endDayOffset as 0 | 1)
            : undefined,
      };
    });

    const preview = await previewDailyAdjustmentMutation({
      branchId: branch.branchId,
      empId,
      businessDate,
      adjustmentType: adjustmentType as DailyAdjustmentType,
      windows,
    });

    return NextResponse.json({ ok: true, preview });
  } catch (err) {
    console.error('[daily-adjustments/preview]', err);
    return NextResponse.json(
      { ok: false, error: 'فشل معاينة التعديل' },
      { status: 500 },
    );
  }
}
