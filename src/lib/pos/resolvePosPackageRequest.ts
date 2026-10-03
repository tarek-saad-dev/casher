import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  GroomPackageBookingError,
  resolveGroomPackageBooking,
} from '@/lib/booking/groomPackageBooking';
import type { PackageKind } from '@/lib/migrations/ensureServicePackages';

export async function resolvePosPackageRequest(
  req: NextRequest,
  allowedKinds: readonly PackageKind[],
  logTag: string,
) {
  const auth = await requirePageAccess('/income/pos');
  if (!isAuthResult(auth)) return auth;

  try {
    const body = await req.json();
    const resolved = await resolveGroomPackageBooking({
      packageId: body.packageId,
      addonProIds: body.addonProIds,
      clientServiceIds: body.clientServiceIds,
      allowedKinds,
    });

    return NextResponse.json({
      ok: true,
      packageId: resolved.packageId,
      packageKind: resolved.packageKind,
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
    console.error(`${logTag} POST error:`, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
