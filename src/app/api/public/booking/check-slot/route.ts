import { NextRequest } from 'next/server';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import {
  publicBookingErrorResponse,
  PUBLIC_BOOKING_ERROR_CATALOG,
} from '@/lib/booking/publicBookingErrorCatalog';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBookingSelectionError,
  evaluatePublicBookingSelection,
} from '@/lib/booking/publicBookingSelectionEvaluator';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
  attachPublicBookingReadTelemetry,
} from '@/lib/booking/publicBookingRouteGate';
import {
  runWithPublicBookingReadTelemetry,
  setAvailabilityMs,
} from '@/lib/booking/publicBookingReadTelemetry';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['check-slot'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * POST /api/public/booking/check-slot
 * Canonical Phase-5 selection evaluation (strong/fresh busy). Does not reserve.
 *
 * Business unavailability → HTTP 200 { ok:true, available:false, reason }
 * (compatibility with prior check-slot clients).
 */
export async function POST(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'check-slot');
  if (blocked) return blocked;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { searchParams } = new URL(req.url);
    // Client may not drive BranchID / price / duration / timezone / preview
    void body.BranchID;
    void body.price;
    void body.duration;
    void body.durationMinutes;
    void body.endTime;
    void body.timezone;
    void body.includeBusy;
    void searchParams.get('preview');

    const branchCode = extractPublicBranchCode(searchParams, body);
    const { result: evaluation, telemetry } = await runWithPublicBookingReadTelemetry(
      async () => {
        const t0 = Date.now();
        const out = await evaluatePublicBookingSelection({
          branchCode,
          date: typeof body.date === 'string' ? body.date : null,
          time: typeof body.time === 'string' ? body.time : null,
          dayOffset: body.dayOffset,
          serviceIds: body.serviceIds,
          empId: body.empId,
          mode: body.mode,
          purpose: 'check_slot',
          previewQueryParam:
            searchParams.get('preview') ?? (body.preview as string | undefined) ?? null,
        });
        setAvailabilityMs(Date.now() - t0);
        return out;
      },
    );
    attachPublicBookingReadTelemetry(gate, telemetry);

    if (!evaluation.available) {
      const code = evaluation.availabilityCode ?? 'SLOT_UNAVAILABLE';
      const def = PUBLIC_BOOKING_ERROR_CATALOG[code];
      return finalizePublicBookingJson(
        req,
        gate,
        {
          ok: true,
          available: false,
          mode: evaluation.mode,
          assignmentStrategy: evaluation.assignmentStrategy,
          branch: {
            branchCode: evaluation.branchContext.branchCode,
            branchName: evaluation.branchContext.branchName,
          },
          slot: {
            date: evaluation.workDate,
            time: evaluation.requestedTime,
            dayOffset: evaluation.requestedDayOffset,
            startDateTime: evaluation.startDateTime,
            endDateTime: evaluation.endDateTime,
          },
          services: {
            serviceIds: evaluation.selectedServices.map((s) => s.serviceId),
            totalDurationMinutes: evaluation.totalDurationMinutes,
            subtotal: evaluation.subtotal,
          },
          barber: evaluation.specificBarber
            ? {
                empId: evaluation.specificBarber.empId,
                nameAr: evaluation.specificBarber.nameAr,
                nameEn: evaluation.specificBarber.nameEn,
                imageUrl: evaluation.specificBarber.imageUrl,
              }
            : null,
          candidateBarbers: evaluation.candidateBarbers,
          reason: {
            code,
            message: evaluation.availabilityMessage ?? def.messageAr,
          },
          meta: {
            evaluationMode: evaluation.evaluationMode,
            evaluatedAt: evaluation.evaluatedAt,
            ...(evaluation.safeMetadata.expectedDayOffset != null
              ? { expectedDayOffset: evaluation.safeMetadata.expectedDayOffset }
              : {}),
          },
        },
        { status: 200 },
      );
    }

    return finalizePublicBookingJson(
      req,
      gate,
      {
        ok: true,
        available: true,
        mode: evaluation.mode,
        assignmentStrategy: evaluation.assignmentStrategy,
        branch: {
          branchCode: evaluation.branchContext.branchCode,
          branchName: evaluation.branchContext.branchName,
        },
        slot: {
          date: evaluation.workDate,
          time: evaluation.requestedTime,
          dayOffset: evaluation.requestedDayOffset,
          startDateTime: evaluation.startDateTime,
          endDateTime: evaluation.endDateTime,
        },
        services: {
          serviceIds: evaluation.selectedServices.map((s) => s.serviceId),
          totalDurationMinutes: evaluation.totalDurationMinutes,
          subtotal: evaluation.subtotal,
        },
        barber: evaluation.specificBarber
          ? {
              empId: evaluation.specificBarber.empId,
              nameAr: evaluation.specificBarber.nameAr,
              nameEn: evaluation.specificBarber.nameEn,
              imageUrl: evaluation.specificBarber.imageUrl,
            }
          : null,
        candidateBarbers: evaluation.candidateBarbers,
        meta: {
          evaluationMode: evaluation.evaluationMode,
          evaluatedAt: evaluation.evaluatedAt,
        },
      }
    );
  } catch (err) {
    if (err instanceof PublicBookingSelectionError) {
      return finalizePublicBookingError(req, gate, err.code, err.metadata);
    }
    console.error('[public/booking/check-slot]', err);
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}
