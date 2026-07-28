/**
 * GET /api/admin/public-booking/operations
 * Phase 9A — branch public-booking status + recent anonymized health samples.
 */
import { NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  listPublicBookingOpsBranchStatuses,
  listRecentPublicBookingHealthSamples,
} from '@/lib/booking/publicBookingOperations';
import { getPublicBookingContractMode } from '@/lib/booking/publicBookingContractMode';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requirePageAccess('/admin/booking/operations');
  if (!isAuthResult(auth)) return auth;

  try {
    const [branches, recentSamples] = await Promise.all([
      listPublicBookingOpsBranchStatuses(),
      listRecentPublicBookingHealthSamples(25),
    ]);

    const sampleCount = recentSamples.length;
    const timingSampleHint = sampleCount === 0;

    return NextResponse.json({
      ok: true,
      phase: 'booking-phase-9a-operations-dashboard',
      contractMode: getPublicBookingContractMode(),
      branches,
      recentSamples,
      monitoring: {
        samplesPopulated: sampleCount > 0,
        warning: timingSampleHint
          ? 'بيانات المراقبة الزمنية (عينات الصحة) غير متاحة بعد — تأكد من نشر Phase 8D على الإنتاج.'
          : null,
      },
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'public_booking.operations_status_failed',
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        error: 'PUBLIC_BOOKING_OPS_UNAVAILABLE',
        message: 'تعذر تحميل حالة تشغيل الحجز العام',
      },
      { status: 503 },
    );
  }
}
