import { NextRequest } from 'next/server';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import { publicBookingErrorResponse } from '@/lib/booking/publicBookingErrorCatalog';
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
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['plan'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * POST /api/public/booking/plan
 * Phase-5 read-only booking plan. Does NOT create bookings or holds.
 * Create remains POST /create (Booking Phase 6).
 */
export async function POST(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'plan');
  if (blocked) return blocked;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { searchParams } = new URL(req.url);
    void body.BranchID;
    void body.price;
    void body.duration;
    void body.durationMinutes;
    void body.endTime;
    void body.timezone;
    void body.includeBusy;
    void body.customer; // ignored — plan is selection-only
    void searchParams.get('preview');

    const branchCode = extractPublicBranchCode(searchParams, body);
    const evaluation = await evaluatePublicBookingSelection({
      branchCode,
      date: typeof body.date === 'string' ? body.date : null,
      time: typeof body.time === 'string' ? body.time : null,
      dayOffset: body.dayOffset,
      serviceIds: body.serviceIds,
      empId: body.empId,
      mode: body.mode,
      purpose: 'plan',
      previewQueryParam: searchParams.get('preview') ?? (body.preview as string | undefined) ?? null,
    });

    if (!evaluation.available) {
      const code = evaluation.availabilityCode ?? 'BOOKING_PLAN_UNAVAILABLE';
      const planCode =
        code === 'SLOT_UNAVAILABLE' || code === 'CHECK_SLOT_UNAVAILABLE'
          ? 'BOOKING_PLAN_UNAVAILABLE'
          : code;
      return finalizePublicBookingError(req, gate, planCode, {
        ...evaluation.safeMetadata,
        availabilityCode: code,
        messageHint: evaluation.availabilityMessage,
      });
    }

    const branch = evaluation.branchContext;
    return finalizePublicBookingJson(
      req,
      gate,
      {
        ok: true,
        plan: {
          contractVersion: evaluation.contractVersion,
          branch: {
            branchCode: branch.branchCode,
            branchName: branch.branchName,
            address: branch.address,
            phone: branch.phone,
          },
          mode: evaluation.mode,
          assignmentStrategy: evaluation.assignmentStrategy,
          barber:
            evaluation.mode === 'specific_barber' && evaluation.specificBarber
              ? {
                  empId: evaluation.specificBarber.empId,
                  nameAr: evaluation.specificBarber.nameAr,
                  imageUrl: evaluation.specificBarber.imageUrl,
                }
              : null,
          candidateBarbers: evaluation.candidateBarbers,
          date: evaluation.workDate,
          time: evaluation.requestedTime,
          dayOffset: evaluation.requestedDayOffset,
          startDateTime: evaluation.startDateTime,
          endDateTime: evaluation.endDateTime,
          services: evaluation.selectedServices.map((s) => ({
            serviceId: s.serviceId,
            nameAr: s.nameAr,
            nameEn: s.nameEn,
            price: s.price,
            durationMinutes: s.durationMinutes,
          })),
          totalDurationMinutes: evaluation.totalDurationMinutes,
          subtotal: evaluation.subtotal,
          discount: 0,
          total: evaluation.subtotal,
          currency: 'EGP',
          pricingScope: evaluation.pricingScope,
          planFingerprint: evaluation.planFingerprint,
          planToken: evaluation.planToken,
          planExpiresAt: evaluation.planExpiresAt,
          evaluatedAt: evaluation.evaluatedAt,
          evaluationMode: evaluation.evaluationMode,
        },
      }
    );
  } catch (err) {
    if (err instanceof PublicBookingSelectionError) {
      return finalizePublicBookingError(req, gate, err.code, err.metadata);
    }
    console.error('[public/booking/plan]', err);
    return finalizePublicBookingError(req, gate, 'BOOKING_PLAN_GENERATION_FAILED');
  }
}
