import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  GroomPackageBookingError,
  resolveGroomPackageBooking,
} from '@/lib/booking/groomPackageBooking';

/**
 * POST /api/pos/groom-packages/resolve
 * Direct POS package sale — same resolver as groom booking.
 * Body: { packageId, addonProIds?: number[] }
 * Does not trust client prices.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const resolved = await resolveGroomPackageBooking({
      packageId: body.packageId,
      addonProIds: body.addonProIds,
      clientServiceIds: body.clientServiceIds,
    });

    return NextResponse.json({
      ok: true,
      packageId: resolved.packageId,
      nameEn: resolved.nameEn,
      nameAr: resolved.nameAr,
      packagePrice: resolved.packagePrice,
      packageDurationMinutes: resolved.packageDurationMinutes,
      totalDurationMinutes: resolved.totalDurationMinutes,
      requiredServiceIds: resolved.requiredServiceIds,
      addonProIds: resolved.addonProIds,
      addonTotal: resolved.addonTotal,
      totalPrice: resolved.totalPrice,
      metadataNote: resolved.metadataNote,
      services: resolved.services.map((s) => ({
        serviceId: s.serviceId,
        nameEn: s.nameEn,
        nameAr: s.nameAr,
        price: s.price,
        durationMinutes: s.durationMinutes,
      })),
    });
  } catch (err: unknown) {
    if (err instanceof GroomPackageBookingError) {
      return NextResponse.json(
        {
          ok: false,
          error: err.code,
          code: err.code,
          metadata: err.metadata,
        },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/pos/groom-packages/resolve] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
