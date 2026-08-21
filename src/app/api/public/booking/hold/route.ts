/**
 * POST /api/public/booking/hold — create 5-minute slot hold (Phase G)
 * DELETE — release hold by holdKey
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  createBookingHold,
  releaseBookingHold,
  HOLD_CONFLICT,
  BOOKING_HOLD_TTL_MS,
} from '@/lib/booking/bookingHold';
import { resolvePublicBookingBranchContext } from '@/lib/booking/publicBookingBranchContext';
import { logBookingAvailabilityMetric } from '@/lib/availability/bookingAvailabilityMetrics';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const branchCode = String(body.branchCode ?? '').trim();
    const empId = Number(body.empId);
    const businessDate = String(body.date ?? body.businessDate ?? '');
    const startAt = new Date(String(body.startAt ?? ''));
    const endAt = new Date(String(body.endAt ?? ''));
    const holdKey = String(body.holdKey ?? '').trim();
    const sessionKey =
      typeof body.sessionKey === 'string' ? body.sessionKey.slice(0, 120) : null;

    if (!branchCode || !holdKey || !Number.isInteger(empId) || empId <= 0) {
      return NextResponse.json(
        { ok: false, code: 'INVALID_INPUT', messageAr: 'بيانات الحجز المؤقت غير صالحة' },
        { status: 400 },
      );
    }
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      return NextResponse.json(
        { ok: false, code: 'INVALID_INTERVAL', messageAr: 'الفترة غير صالحة' },
        { status: 400 },
      );
    }

    const ctx = await resolvePublicBookingBranchContext({
      branchCode,
      purpose: 'public_booking',
    });
    if (!ctx.bookingEnabled || !ctx.publicBookingEnabled) {
      logBookingAvailabilityMetric({
        event: 'public_booking_gate_failure',
        reasonCode: 'BOOKING_TEMPORARILY_DISABLED',
        branchCode,
      });
      return NextResponse.json(
        {
          ok: false,
          code: 'BOOKING_TEMPORARILY_DISABLED',
          messageAr: 'الحجز متوقف مؤقتًا لهذا الفرع',
        },
        { status: 409 },
      );
    }

    const hold = await createBookingHold({
      branchId: ctx.branchId,
      empId,
      businessDate,
      startAt,
      endAt,
      holdKey,
      sessionKey,
      clientRequestId:
        typeof body.clientRequestId === 'string' ? body.clientRequestId : null,
      ttlMs: BOOKING_HOLD_TTL_MS,
    });

    return NextResponse.json({
      ok: true,
      hold: {
        holdId: hold.holdId,
        holdKey: hold.holdKey,
        expiresAt: hold.expiresAt.toISOString(),
        ttlMs: BOOKING_HOLD_TTL_MS,
      },
    });
  } catch (err) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? String((err as { code: string }).code)
        : err instanceof Error
          ? err.message
          : 'HOLD_FAILED';
    if (code === HOLD_CONFLICT) {
      return NextResponse.json(
        {
          ok: false,
          code: HOLD_CONFLICT,
          messageAr: 'هذه الفترة محجوزة مؤقتًا — اختر موعدًا آخر أو أعد المحاولة بعد دقائق',
          recoverySuggestionAr: 'اختر وقتًا آخر أو انتظر انتهاء الحجز المؤقت',
        },
        { status: 409 },
      );
    }
    if (
      code === 'OUTSIDE_WORKING_WINDOW' ||
      code === 'outside_working_hours' ||
      code === 'insufficient_continuous_time' ||
      code === 'booking_conflict' ||
      code === 'queue_conflict' ||
      code === 'break' ||
      code === 'BLOCKED_BY_RANGE' ||
      code === 'EMPLOYEE_ABSENT' ||
      code === 'BRANCH_CLOSED' ||
      code === 'SLOT_TOO_SOON' ||
      code === 'SLOT_TOO_FAR' ||
      code === 'SLOT_UNAVAILABLE' ||
      code === 'NOT_ASSIGNED_TO_BRANCH' ||
      code === 'EMPLOYEE_OFF_DAY' ||
      code === 'DAY_CLOSED' ||
      code === 'EMPLOYEE_INACTIVE' ||
      code === 'SCHEDULE_NOT_CONFIGURED' ||
      code === 'MIN_NOTICE_NOT_MET' ||
      code === 'MAX_AHEAD'
    ) {
      return NextResponse.json(
        {
          ok: false,
          code,
          messageAr: 'هذه الفترة غير متاحة للحجز حسب سياسة العمل',
          recoverySuggestionAr: 'اختر وقتًا داخل ساعات العمل الفعلية للموظف',
        },
        { status: 409 },
      );
    }
    console.error('[public/booking/hold]', err);
    return NextResponse.json(
      { ok: false, code: 'HOLD_FAILED', messageAr: 'تعذر إنشاء الحجز المؤقت' },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const holdKey = searchParams.get('holdKey') ?? '';
    if (!holdKey) {
      return NextResponse.json({ ok: false, code: 'INVALID_INPUT' }, { status: 400 });
    }
    const released = await releaseBookingHold(holdKey);
    return NextResponse.json({ ok: true, released });
  } catch (err) {
    console.error('[public/booking/hold DELETE]', err);
    return NextResponse.json({ ok: false, code: 'HOLD_RELEASE_FAILED' }, { status: 500 });
  }
}
