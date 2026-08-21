/**
 * Admin/internal — Booking V2 isolated write-test diagnostics.
 * Only when HAWAI_DB_CLASS=isolated|test|local AND BOOKING_V2_WRITE_TEST_OK=1.
 * Never exposes production SoT; no mutations.
 */
import { NextResponse } from 'next/server';
import { assertBookingV2WriteTestSafety } from '@/lib/booking/bookingV2WriteSafety';
import { getDbConnectionInfo } from '@/lib/db';

export const runtime = 'nodejs';

function allowed(): boolean {
  const safety = assertBookingV2WriteTestSafety();
  return safety.ok;
}

export async function GET() {
  if (!allowed()) {
    return NextResponse.json(
      { ok: false, error: 'ISOLATED_DIAGNOSTICS_DENIED' },
      { status: 404 },
    );
  }

  const { getSlotClaimShadowStats } = await import(
    '@/lib/booking/claims/slotClaimShadowTelemetry'
  );
  const { getShadowParityStats } = await import(
    '@/lib/booking/projection/availabilityShadowParity'
  );

  let hot: unknown = null;
  try {
    const { getHotAvailabilityCache } = await import(
      '@/lib/booking/cache/HotAvailabilityCache'
    );
    hot = getHotAvailabilityCache().metrics();
  } catch {
    hot = null;
  }

  const info = getDbConnectionInfo();
  return NextResponse.json({
    ok: true,
    contract: 'booking-v2-isolated-diagnostics',
    safety: assertBookingV2WriteTestSafety(),
    db: info,
    slotClaimShadow: getSlotClaimShadowStats(),
    availabilityShadow: getShadowParityStats(),
    hotCache: hot,
  });
}
