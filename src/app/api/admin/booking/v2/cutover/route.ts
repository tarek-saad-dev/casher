/**
 * Admin — Booking V2 B7B cutover metrics / decision probe.
 * GET /api/admin/booking/v2/cutover
 */
import { NextResponse } from 'next/server';
import { requireActiveBranchContext, isActiveBranchContext } from '@/lib/branch/context';

export const runtime = 'nodejs';

function allowed(): boolean {
  if (process.env.BOOKING_V2_INTERNAL_API === '1') return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

export async function GET() {
  if (!allowed()) {
    return NextResponse.json({ ok: false, error: 'V2_INTERNAL_DISABLED' }, { status: 404 });
  }
  const branchCtx = await requireActiveBranchContext();
  if (!isActiveBranchContext(branchCtx)) return branchCtx;

  const {
    getBookingV2ReadCutoverMetrics,
    resolveBookingV2ReadDecision,
    bookingV2CanaryBucket,
  } = await import('@/lib/booking/projection/bookingV2ReadCutover');
  const { getShadowParityStats, evaluateReadCutoverReadiness } = await import(
    '@/lib/booking/projection/availabilityShadowParity'
  );

  const sampleKeys = ['client-a', 'client-b', 'client-c', 'session-1', 'session-2'];
  const sticky = sampleKeys.map((k) => ({
    key: k,
    bucket: bookingV2CanaryBucket(k),
    decision: resolveBookingV2ReadDecision({ canaryKey: k }),
  }));

  return NextResponse.json({
    ok: true,
    contract: 'booking-v2-cutover-metrics',
    cutover: false,
    writePathUnchanged: true,
    recommendedInitialPercent: 10,
    rolloutSteps: [10, 25, 50, 100],
    note: 'Percent steps are manual env changes — never auto-advanced.',
    metrics: getBookingV2ReadCutoverMetrics(),
    shadow: getShadowParityStats(),
    readiness: evaluateReadCutoverReadiness({ minSamples: 20 }),
    stickyCanaryDemo: sticky,
  });
}
