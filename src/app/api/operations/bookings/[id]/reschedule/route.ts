import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { rescheduleBookingMove } from '@/lib/bookingRescheduleCore';
import { ScheduleConflictError } from '@/lib/scheduleIntegrity';
import { isBookingSchedulingPortEnabled, rescheduleOpsBooking } from '@/apps/booking/public';
import {
  buildSchedulingPortHooksForActor,
  buildStaffActorContext,
} from '@/lib/bookingSchedulingComposition';
import { BookingCreateLockError } from '@/lib/booking/publicBookingCreateLocks';
import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const { id } = await context.params;
    const bookingId = parseInt(id, 10);
    if (Number.isNaN(bookingId)) {
      return NextResponse.json({ error: 'معرف حجز غير صالح' }, { status: 400 });
    }

    const body = await req.json();
    const { newStartAt, operationalDate, source = 'operations_drag_drop', targetEmpId } = body;

    if (!newStartAt || !operationalDate) {
      return NextResponse.json(
        { error: 'يجب تحديد newStartAt و operationalDate' },
        { status: 400 },
      );
    }

    const moveInput = {
      bookingId,
      newStartAt,
      operationalDate,
      source,
      userId: session.UserID,
      targetEmpId: targetEmpId != null ? parseInt(String(targetEmpId), 10) : undefined,
    };

    const result = isBookingSchedulingPortEnabled()
      ? await (async () => {
          const actor = await buildStaffActorContext(session.UserID);
          const schedulingPortHooks = await buildSchedulingPortHooksForActor(actor);
          return rescheduleOpsBooking({ ...moveInput, schedulingPortHooks });
        })()
      : await rescheduleBookingMove(moveInput);

    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    if (err instanceof ScheduleConflictError) {
      return NextResponse.json(
        {
          ok: false,
          code: err.code,
          message: err.message,
          details: err.conflict?.empId
            ? { employeeId: err.conflict.empId }
            : undefined,
          conflict: err.conflict,
        },
        { status: 409 },
      );
    }

    if (err instanceof BookingCreateLockError) {
      const def = PUBLIC_BOOKING_ERROR_CATALOG[err.code];
      return NextResponse.json(
        {
          ok: false,
          code: def.code,
          message: def.messageAr,
        },
        { status: def.httpStatus },
      );
    }

    console.error('[reschedule]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'فشل نقل الموعد' },
      { status: 500 },
    );
  }
}
