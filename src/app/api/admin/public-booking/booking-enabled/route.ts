/**
 * POST /api/admin/public-booking/booking-enabled
 * Phase 9A — audited pause/resume of QueueBookingSettings.BookingEnabled (GLEEM only).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import type { SessionUser } from '@/lib/session-types';
import {
  PublicBookingOpsError,
  setPublicBookingOpsEnabled,
} from '@/lib/booking/publicBookingOperations';

export const runtime = 'nodejs';

function toSessionUser(auth: {
  userId: number;
  userName: string;
  userLevel: string;
  activeBranchId: number;
  activeBranchCode: string;
}): SessionUser {
  return {
    UserID: auth.userId,
    UserName: auth.userName,
    UserLevel: auth.userLevel === 'admin' ? 'admin' : 'user',
    ActiveBranchID: auth.activeBranchId,
    ActiveBranchCode: auth.activeBranchCode,
    BranchSessionVersion: 1,
  };
}

export async function POST(req: NextRequest) {
  const auth = await requirePageAccess('/admin/booking/operations');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const branchCode = typeof body.branchCode === 'string' ? body.branchCode : '';
    const reason = typeof body.reason === 'string' ? body.reason : '';

    if (typeof body.bookingEnabled !== 'boolean') {
      return NextResponse.json(
        { ok: false, error: 'INVALID_REQUEST', message: 'bookingEnabled مطلوب (boolean)' },
        { status: 400 },
      );
    }

    // Reject any attempt to flip PublicBookingEnabled / lifecycle via this endpoint.
    if (
      body.publicBookingEnabled != null ||
      body.PublicBookingEnabled != null ||
      body.lifecycleStatus != null ||
      body.LifecycleStatus != null
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: 'LIFECYCLE_FIELDS_FORBIDDEN',
          message: 'لا يمكن تغيير PublicBookingEnabled أو LifecycleStatus من هذه الواجهة',
        },
        { status: 400 },
      );
    }

    const result = await setPublicBookingOpsEnabled({
      branchCode,
      bookingEnabled: body.bookingEnabled,
      reason,
      user: toSessionUser(auth),
      request: req,
    });

    return NextResponse.json({
      ok: true,
      ...result,
      message: result.bookingEnabled
        ? 'تم استئناف الحجز العام'
        : 'تم إيقاف الحجز العام',
    });
  } catch (err) {
    if (err instanceof PublicBookingOpsError) {
      return NextResponse.json(
        { ok: false, error: err.code, message: err.message },
        { status: err.httpStatus },
      );
    }
    console.error('[admin/public-booking/booking-enabled]', err);
    return NextResponse.json(
      { ok: false, error: 'BOOKING_OPS_FAILED', message: 'فشل تحديث حالة الحجز العام' },
      { status: 500 },
    );
  }
}
