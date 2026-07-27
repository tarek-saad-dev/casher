/**
 * GET /api/admin/public-booking/health
 * Phase 8D — read-only last-24h public booking health summary (admin only).
 * No tokens / customer PII in the payload.
 */
import { NextResponse } from 'next/server';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { buildPublicBookingHealthSummary } from '@/lib/booking/publicBookingHealthMetrics';
import { getPublicBookingContractMode } from '@/lib/booking/publicBookingContractMode';

export const runtime = 'nodejs';

export async function GET() {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;

  try {
    const summary = await buildPublicBookingHealthSummary({
      windowHours: 24,
      contractMode: getPublicBookingContractMode(),
    });
    return NextResponse.json({
      ok: true,
      phase: 'booking-phase-8d-post-cutover-monitoring',
      summary,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'public_booking.health_summary_failed',
        message: err instanceof Error ? err.message : 'unknown',
        timestamp: new Date().toISOString(),
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        error: 'PUBLIC_BOOKING_HEALTH_UNAVAILABLE',
        message: 'تعذر تحميل تقرير صحة الحجز العام',
      },
      { status: 503 },
    );
  }
}
