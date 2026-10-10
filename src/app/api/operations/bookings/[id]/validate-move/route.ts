import { NextRequest, NextResponse } from 'next/server';
import {
  validateBookingMove,
  loadBookingForReschedule,
} from '@/lib/bookingRescheduleCore';
import { requireTenantSession } from '@/lib/api-auth';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const session = await requireTenantSession();
    if (session instanceof NextResponse) return session;

    const { id } = await context.params;
    const bookingId = parseInt(id, 10);
    if (Number.isNaN(bookingId)) {
      return NextResponse.json({ error: 'معرف حجز غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const { newStartAt, newEndAt: _ignoredEnd, operationalDate, targetEmpId } = body;

    if (!newStartAt || !operationalDate) {
      return NextResponse.json(
        { error: 'يجب تحديد newStartAt و operationalDate' },
        { status: 400 },
      );
    }

    const booking = await loadBookingForReschedule(bookingId);
    if (!booking) {
      return NextResponse.json({ error: 'حجز غير موجود' }, { status: 404 });
    }

    const result = await validateBookingMove({
      bookingId,
      newStartAt,
      operationalDate,
      targetEmpId: targetEmpId != null ? parseInt(String(targetEmpId), 10) : undefined,
    });

    if (result.valid) {
      return NextResponse.json({
        valid: true,
        targetEmpId: result.targetEmpId,
        targetEmpName: result.targetEmpName,
        newStartAt: result.newStartAt,
        newEndAt: result.newEndAt,
        durationMinutes: result.durationMinutes,
      });
    }

    return NextResponse.json({
      valid: false,
      code: result.code ?? 'SCHEDULE_CONFLICT',
      message: result.message,
      details: result.details,
      conflict: result.conflict,
      nextAvailable: result.nextAvailable,
    });
  } catch (err) {
    console.error('[validate-move]', err);
    return NextResponse.json({ error: 'فشل التحقق من الموعد' }, { status: 500 });
  }
}
