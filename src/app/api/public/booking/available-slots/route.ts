import { NextRequest } from 'next/server';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import { publicBookingErrorResponse } from '@/lib/booking/publicBookingErrorCatalog';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBookingAvailabilityError,
  getPublicAvailableSlots,
} from '@/lib/booking/publicBookingAvailability';
import { requireActiveBranchContext, isActiveBranchContext } from '@/lib/branch/context';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['available-slots'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * GET /api/public/booking/available-slots
 * Public: branchCode + date + serviceIds (+ optional empId)
 * Internal operations/admin: session branch + source=operations|admin (legacy path via engine still available through this wrapper for public)
 */
export async function GET(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'available-slots');
  if (blocked) return blocked;

  try {
    const { searchParams } = new URL(req.url);
    void searchParams.get('BranchID');
    void searchParams.get('includeTest');
    void searchParams.get('duration');
    void searchParams.get('includeBusy');
    const preview = searchParams.get('preview');
    const source = (searchParams.get('source') ?? 'public').toLowerCase();
    const isInternal = source === 'operations' || source === 'admin';

    // Internal callers keep session branch; public must use branchCode + Phase 4 contract.
    if (isInternal) {
      const branchCtx = await requireActiveBranchContext();
      if (!isActiveBranchContext(branchCtx)) return branchCtx;
      // Delegate to legacy engine path for ops UI compatibility
      const { listAvailableBookingSlots } = await import('@/lib/bookingAvailabilityEngine');
      const { isValidDate } = await import('@/lib/publicBookingHelpers');
      const date = searchParams.get('date') ?? '';
      const serviceIds = (searchParams.get('serviceIds') ?? '')
        .split(',')
        .map(Number)
        .filter((n) => n > 0);
      const mode = (searchParams.get('mode') ?? 'nearest') as 'nearest' | 'specific';
      const empIdParam = searchParams.get('empId');
      const empId = empIdParam ? Number(empIdParam) : null;
      if (!isValidDate(date)) {
        return finalizePublicBookingError(req, gate, 'INVALID_DATE');
      }
      const result = await listAvailableBookingSlots({
        date,
        serviceIds,
        mode,
        empId,
        source: source as 'operations' | 'admin',
        branchId: branchCtx.branchId,
      });
      return finalizePublicBookingJson(
        req,
        gate,
        {
          ok: true,
          date: result.date,
          mode: result.mode,
          serviceDurationMinutes: result.durationMinutes,
          durationSource: result.durationSource,
          empId: result.empId ?? null,
          slots: result.slots,
          availableSlots: result.availableSlots,
          noSlotsReason: result.noSlotsReason,
          gapNotice: result.gapNotice,
          nextAvailable: result.nextAvailable,
          alternativeBarbers: result.alternativeBarbers,
          debug: result.debug,
        }
      );
    }

    const branchCode = extractPublicBranchCode(searchParams);
    const date = searchParams.get('date') ?? '';
    const serviceIds = searchParams.get('serviceIds');
    const empIdRaw = searchParams.get('empId');
    const empId = empIdRaw ? Number(empIdRaw) : null;

    if (!serviceIds?.trim()) {
      return finalizePublicBookingError(req, gate, 'SERVICE_NOT_AVAILABLE_AT_BRANCH');
    }
    if (empIdRaw && (!Number.isFinite(empId) || (empId ?? 0) <= 0)) {
      return finalizePublicBookingError(req, gate, 'BARBER_NOT_FOUND');
    }

    const result = await getPublicAvailableSlots({
      branchCode,
      date,
      serviceIds,
      empId,
      previewQueryParam: preview,
    });

    return finalizePublicBookingJson(req, gate, result);
  } catch (err) {
    if (err instanceof PublicBookingAvailabilityError) {
      return finalizePublicBookingError(req, gate, err.code);
    }
    console.error('[public/booking/available-slots]', err instanceof Error ? err.message : 'error');
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}
