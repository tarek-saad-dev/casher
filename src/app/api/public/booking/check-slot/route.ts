import { NextRequest, NextResponse } from 'next/server';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import {
  readInternalOpsBookingSource,
  resolveInternalOpsBookingRequest,
} from '@/lib/booking/internalOpsBookingRequest';
import { PUBLIC_BOOKING_ERROR_CATALOG } from '@/lib/booking/publicBookingErrorCatalog';
import {
  PublicBookingSelectionError,
  evaluatePublicBookingSelection,
} from '@/lib/booking/publicBookingSelectionEvaluator';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
  attachPublicBookingReadTelemetry,
  publicBookingTenantOptionsResponse,
  requirePublicBookingRouteTenancy,
} from '@/lib/booking/publicBookingRouteGate';
import {
  runWithPublicBookingReadTelemetry,
  setAvailabilityMs,
} from '@/lib/booking/publicBookingReadTelemetry';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  return publicBookingTenantOptionsResponse(req, 'check-slot');
}

/**
 * POST /api/public/booking/check-slot
 * Canonical Phase-5 selection evaluation (strong/fresh busy). Does not reserve.
 *
 * Business unavailability → HTTP 200 { ok:true, available:false, reason }
 * (compatibility with prior check-slot clients).
 * Internal ops/admin (`source=operations|admin`): same branch resolution as create.
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

    let branchCode = extractPublicBranchCode(searchParams, body);
    const internalSource = readInternalOpsBookingSource(body);
    let internalAuth: { userId: number; canOperate?: boolean } | null = null;
    if (internalSource) {
      const internal = await resolveInternalOpsBookingRequest(body, internalSource);
      if (internal instanceof NextResponse) return internal;
      branchCode = internal.branchCode;
      internalAuth = internal.auth;
    }
    const tenancy = await requirePublicBookingRouteTenancy(req, gate, { branchCode });
    if (tenancy instanceof NextResponse) return tenancy;

    const { result: evaluation, telemetry } = await runWithPublicBookingReadTelemetry(
      async () => {
        const t0 = Date.now();
        const out = await evaluatePublicBookingSelection({
          branchCode,
          date: typeof body.date === 'string' ? body.date : null,
          time: typeof body.time === 'string' ? body.time : null,
          dayOffset: body.dayOffset,
          serviceIds: body.serviceIds,
          packageId: body.packageId,
          addonProIds: body.addonProIds ?? body.addons,
          empId: body.empId,
          mode: body.mode,
          purpose: internalAuth ? 'internal_preview' : 'check_slot',
          auth: internalAuth,
          previewQueryParam:
            searchParams.get('preview') ?? (body.preview as string | undefined) ?? null,
          expectedTenantId: tenancy.tenantId,
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
    const { opsWriteBranchErrorResponse } = await import('@/lib/branch/opsWriteBranch');
    const branchErr = opsWriteBranchErrorResponse(err);
    if (branchErr) return branchErr;
    if (err instanceof PublicBookingSelectionError) {
      return finalizePublicBookingError(req, gate, err.code, err.metadata);
    }
    console.error('[public/booking/check-slot]', err);
    return finalizePublicBookingError(req, gate, 'AVAILABILITY_UNAVAILABLE');
  }
}
