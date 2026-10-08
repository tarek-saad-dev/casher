/**
 * POST /api/public/booking/:code/cancel
 * Phase 7B — preferred code-route cancel via canonical cancelPublicBooking.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  cancelPublicBooking,
  PublicBookingCancelError,
} from '@/lib/booking/publicBookingCancellation';
import { cancelBooking, isBookingSchedulingPortEnabled } from '@/apps/booking/public';
import {
  buildCustomerActorContext,
  buildSchedulingPortHooksForActor,
} from '@/lib/bookingSchedulingComposition';
import {
  describePlatformBootstrapFailure,
  isPlatformBootstrapFailure,
} from '@/lib/booking/platformBootstrapErrors';
import { resolvePublicBookingClientIp } from '@/lib/booking/publicBookingClientIp';
import { digestPublicBookingRateSubject } from '@/lib/booking/publicBookingRateLimitPolicy';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
  publicBookingTenantOptionsResponse,
  requirePublicBookingCodeTenancy,
} from '@/lib/booking/publicBookingRouteGate';

export const runtime = 'nodejs';

type RouteContext = { params: Promise<{ code: string }> };

export async function OPTIONS(req: NextRequest) {
  return publicBookingTenantOptionsResponse(req, 'cancel-by-code');
}

export async function POST(req: NextRequest, context: RouteContext) {
  const { code } = await context.params;
  const subjectDigest = digestPublicBookingRateSubject('code', code);
  const { gate, blocked } = gatePublicBookingRoute(req, 'cancel-by-code', subjectDigest);
  if (blocked) return blocked;
  const clientIp = resolvePublicBookingClientIp(req);

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (body.bookingId != null || body.BookingID != null) {
      return finalizePublicBookingError(req, gate, 'INVALID_BOOKING_CODE', {
        reason: 'numeric_booking_id_rejected',
      });
    }

    const idempotencyKey =
      (typeof body.clientRequestId === 'string' && body.clientRequestId) ||
      (typeof body.idempotencyKey === 'string' && body.idempotencyKey) ||
      req.headers.get('idempotency-key') ||
      null;

    const tenancy = await requirePublicBookingCodeTenancy(req, gate, code, {
      invalid: 'INVALID_BOOKING_CODE',
      notFound: 'BOOKING_NOT_FOUND_OR_UNAUTHORIZED',
    });
    if (tenancy instanceof NextResponse) return tenancy;

    const cancelInput = {
      tenantId: tenancy.tenantId,
      code,
      phone: body.phone != null ? String(body.phone) : null,
      accessToken:
        body.bookingAccessToken != null
          ? String(body.bookingAccessToken)
          : body.accessToken != null
            ? String(body.accessToken)
            : null,
      reasonCode: body.reasonCode != null ? String(body.reasonCode) : null,
      reasonText: body.reasonText != null ? String(body.reasonText) : null,
      clientRequestId: idempotencyKey,
      idempotencyKey,
      requestContext: {
        ip: clientIp,
        userAgent: req.headers.get('user-agent') || undefined,
      },
    };

    const result = isBookingSchedulingPortEnabled()
      ? await (async () => {
          const actor = await buildCustomerActorContext(tenancy.tenantId);
          const schedulingPortHooks = await buildSchedulingPortHooksForActor(actor);
          return cancelBooking({
            ...cancelInput,
            schedulingPortHooks,
          });
        })()
      : await cancelPublicBooking(cancelInput);

    const replay =
      (result.body as { cancellation?: { idempotentReplay?: boolean } } | null)
        ?.cancellation?.idempotentReplay === true;
    return finalizePublicBookingJson(req, gate, result.body, {
      status: result.httpStatus,
      telemetry: {
        outcome: replay ? 'idempotent_replay' : 'success',
      },
    });
  } catch (err) {
    if (err instanceof PublicBookingCancelError) {
      return finalizePublicBookingError(req, gate, err.code, err.metadata);
    }
    if (isPlatformBootstrapFailure(err)) {
      console.error(
        '[public/booking/:code/cancel] PLATFORM_BOOTSTRAP_REQUIRED',
        describePlatformBootstrapFailure(err),
        err,
      );
      return finalizePublicBookingError(req, gate, 'PLATFORM_BOOTSTRAP_REQUIRED');
    }
    console.error('[public/booking/:code/cancel]', err);
    return finalizePublicBookingError(req, gate, 'BOOKING_CANCELLATION_FAILED', undefined, {
      outcome: 'mutation_outcome_unknown',
    });
  }
}
