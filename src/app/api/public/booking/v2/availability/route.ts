/**
 * POST /api/public/booking/v2/availability
 * Compact FreeMask matrix for Emp×Branch×BusinessDate (Booking V2).
 */
import { NextRequest } from 'next/server';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['v2-availability'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

export async function POST(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'v2-availability');
  if (blocked) return blocked;

  try {
    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const { buildPublicAvailabilityMatrix, BookingV2MatrixError } = await import(
      '@/lib/booking/v2Frontend/buildAvailabilityMatrix'
    );

    const toNumArr = (v: unknown): number[] | undefined => {
      if (v == null) return undefined;
      if (Array.isArray(v)) {
        return v.map(Number).filter((n) => Number.isInteger(n) && n > 0);
      }
      if (typeof v === 'string') {
        return v
          .split(',')
          .map((x) => Number(x.trim()))
          .filter((n) => Number.isInteger(n) && n > 0);
      }
      return undefined;
    };
    const toStrArr = (v: unknown): string[] | undefined => {
      if (v == null) return undefined;
      if (Array.isArray(v)) return v.map(String).filter(Boolean);
      if (typeof v === 'string') {
        return v.split(',').map((x) => x.trim()).filter(Boolean);
      }
      return undefined;
    };

    const result = await buildPublicAvailabilityMatrix({
      employeeIds: toNumArr(body.employeeIds),
      employeeId: body.employeeId != null ? Number(body.employeeId) : undefined,
      branchIds: toNumArr(body.branchIds),
      branchId: body.branchId != null ? Number(body.branchId) : undefined,
      branchCodes: toStrArr(body.branchCodes),
      branchCode:
        body.branchCode != null ? String(body.branchCode) : undefined,
      fromBusinessDate: String(body.fromBusinessDate ?? body.from ?? ''),
      toBusinessDate: String(body.toBusinessDate ?? body.to ?? ''),
      serviceIds: toNumArr(body.serviceIds),
      serviceId: body.serviceId != null ? Number(body.serviceId) : undefined,
      durationMinutes:
        body.durationMinutes != null ? Number(body.durationMinutes) : undefined,
    });

    return finalizePublicBookingJson(req, gate, result.body, {
      cacheControl: 'private, max-age=15, stale-while-revalidate=30',
    });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) {
      const code = String((err as { code: string }).code);
      return finalizePublicBookingError(req, gate, code as never);
    }
    console.error(
      '[public/booking/v2/availability]',
      err instanceof Error ? err.message : 'error',
    );
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}
