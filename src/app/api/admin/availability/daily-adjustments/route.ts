/**
 * GET /api/admin/availability/daily-adjustments?date=YYYY-MM-DD&empId=
 * POST /api/admin/availability/daily-adjustments
 *
 * Branch-scoped; never trusts client branchId.
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
import {
  createDailyAdjustment,
  DailyAdjustmentServiceError,
  listDailyAdjustmentHistory,
  listDailyAdjustments,
} from '@/lib/availability/dailyAdjustmentService';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const auth = await requireWorkforceAvailabilityAccess();
  if (!isAuthResult(auth)) return auth;

  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date') ?? '';
    const empIdRaw = searchParams.get('empId');
    const statusRaw = searchParams.get('status') ?? 'active';
    const status =
      statusRaw === 'cancelled' || statusRaw === 'all' || statusRaw === 'active'
        ? statusRaw
        : null;

    if (!isValidBusinessDate(date)) {
      return NextResponse.json(
        { ok: false, code: 'INVALID_DATE', error: 'تاريخ العمل غير صالح' },
        { status: 400 },
      );
    }
    if (!status) {
      return NextResponse.json(
        { ok: false, code: 'INVALID_STATUS', error: 'حالة غير صالحة (active|cancelled|all)' },
        { status: 400 },
      );
    }

    let empId: number | null = null;
    if (empIdRaw != null && empIdRaw !== '') {
      empId = Number(empIdRaw);
      if (!Number.isInteger(empId) || empId <= 0) {
        return NextResponse.json(
          { ok: false, code: 'INVALID_EMP', error: 'معرف الموظف غير صالح' },
          { status: 400 },
        );
      }
    }

    const adjustments =
      status === 'active'
        ? await listDailyAdjustments({
            branchId: branch.branchId,
            businessDate: date,
            empId,
            status: 'active',
          })
        : await listDailyAdjustmentHistory({
            branchId: branch.branchId,
            businessDate: date,
            empId,
            status,
          });

    return NextResponse.json({
      ok: true,
      businessDate: date,
      branchId: branch.branchId,
      status,
      adjustments,
    });
  } catch (err) {
    console.error('[admin/availability/daily-adjustments GET]', err);
    return NextResponse.json(
      { ok: false, error: 'فشل تحميل التعديلات اليومية' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireWorkforceAvailabilityAccess();
  if (!isAuthResult(auth)) return auth;

  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    // Never trust client branchId — session branch is authoritative.
    const empId = Number(body.empId);
    const businessDate = typeof body.businessDate === 'string' ? body.businessDate : '';
    const adjustmentType = body.adjustmentType;

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

    if (adjustmentType === 'BLOCK_WINDOW' && windows?.[0]) {
      const { assertBlockDoesNotOverlapBookings } = await import(
        '@/lib/availability/dailyAdjustmentPreview'
      );
      try {
        await assertBlockDoesNotOverlapBookings({
          branchId: branch.branchId,
          empId,
          businessDate,
          start: windows[0].start,
          end: windows[0].end,
        });
      } catch (blockErr) {
        const bookings =
          blockErr && typeof blockErr === 'object' && 'bookings' in blockErr
            ? (blockErr as { bookings: unknown }).bookings
            : [];
        return NextResponse.json(
          {
            ok: false,
            code: 'BLOCK_OVERLAPS_BOOKING',
            error: 'لا يمكن حظر فترة تتداخل مع حجز قائم',
            affectedBookings: bookings,
          },
          { status: 409 },
        );
      }
    }

    const created = await createDailyAdjustment({
      branchId: branch.branchId,
      empId,
      businessDate,
      adjustmentType: adjustmentType as DailyAdjustmentType,
      reasonCode: typeof body.reasonCode === 'string' ? body.reasonCode : null,
      reasonText: typeof body.reasonText === 'string' ? body.reasonText : null,
      source: 'admin',
      windows,
      createdBy: auth.userId,
    });

    return NextResponse.json({ ok: true, adjustment: created });
  } catch (err) {
    if (err instanceof DailyAdjustmentServiceError) {
      return NextResponse.json(
        { ok: false, code: err.code, error: err.message },
        { status: err.status },
      );
    }
    console.error('[admin/availability/daily-adjustments POST]', err);
    return NextResponse.json(
      { ok: false, error: 'فشل إنشاء التعديل اليومي' },
      { status: 500 },
    );
  }
}
