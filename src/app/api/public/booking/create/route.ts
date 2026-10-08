import { NextRequest, NextResponse } from 'next/server';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import {
  readInternalOpsBookingSource,
  resolveInternalOpsBookingRequest,
} from '@/lib/booking/internalOpsBookingRequest';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBookingCreateError,
  createPublicBooking,
} from '@/lib/booking/publicBookingCreate';
import { createBooking, isBookingSchedulingPortEnabled } from '@/apps/booking/public';
import {
  buildCustomerActorContext,
  buildStaffActorContext,
  buildSchedulingPortHooksForActor,
} from '@/lib/bookingSchedulingComposition';
import { resolvePublicTenantForBranchCode } from '@/lib/booking/publicBookingTenant';
import { PublicBookingSelectionError } from '@/lib/booking/publicBookingSelectionEvaluator';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';
import {
  describePlatformBootstrapFailure,
  isPlatformBootstrapFailure,
} from '@/lib/booking/platformBootstrapErrors';

export const runtime = 'nodejs';

export async function OPTIONS(req: NextRequest) {
  const cors = PUBLIC_BOOKING_ROUTE_CORS['create'];
  return publicBookingOptionsResponse({
    request: req,
    allowedMethods: [...cors.methods],
    allowedHeaders: cors.headers,
  });
}

/**
 * POST /api/public/booking/create
 * Phase 6 — transactional create via createPublicBooking.
 * Internal ops/admin (`source=operations|admin`): resolves write branch from
 * emp operational location (optional body.branchId) when authorized — no forced
 * session branch switch.
 */
export async function POST(req: NextRequest) {
  const { gate, blocked } = gatePublicBookingRoute(req, 'create');
  if (blocked) return blocked;

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { searchParams } = new URL(req.url);

    // Ignored / forbidden client drivers
    void body.BranchID;
    void body.price;
    void body.duration;
    void body.durationMinutes;
    void body.total;
    void body.status;
    void body.bookingCode;
    void body.endTime;
    void body.timezone;

    const internalSource = readInternalOpsBookingSource(body);
    const isInternalOps = internalSource != null;

    let branchCode = extractPublicBranchCode(searchParams, body);
    let purpose: 'public_booking' | 'internal_preview' | undefined;
    let auth: { userId: number; canOperate?: boolean; tenantId?: string } | null = null;
    let bookingSource: 'online' | 'operations' | 'admin' = 'online';

    if (internalSource) {
      const internal = await resolveInternalOpsBookingRequest(body, internalSource);
      if (internal instanceof NextResponse) return internal;
      branchCode = internal.branchCode;
      purpose = 'internal_preview';
      auth = internal.auth;
      bookingSource = internal.bookingSource;
    }

    const customer = (body.customer ?? {}) as { name?: string; phone?: string | null };
    const idempotencyKeyHeader =
      req.headers.get('Idempotency-Key') ?? req.headers.get('idempotency-key');

    const leadRaw = typeof body.leadSource === 'string' ? body.leadSource.trim().toLowerCase() : null;
    const leadSource =
      isInternalOps &&
      (leadRaw === 'phone' ||
        leadRaw === 'whatsapp' ||
        leadRaw === 'website' ||
        leadRaw === 'admin' ||
        leadRaw === 'walk_in')
        ? (leadRaw as 'phone' | 'whatsapp' | 'website' | 'admin' | 'walk_in')
        : null;

    const createInput = {
      branchCode,
      date: typeof body.date === 'string' ? body.date : null,
      time: typeof body.time === 'string' ? body.time : null,
      dayOffset: body.dayOffset,
      serviceIds: body.serviceIds,
      packageId: body.packageId,
      addonProIds: body.addonProIds ?? body.addons,
      empId: body.empId,
      mode: body.mode,
      planToken: typeof body.planToken === 'string' ? body.planToken : null,
      holdKey: typeof body.holdKey === 'string' ? body.holdKey : null,
      customer,
      notes: typeof body.notes === 'string' ? body.notes : null,
      clientRequestId:
        typeof body.clientRequestId === 'string'
          ? body.clientRequestId
          : typeof body.idempotencyKey === 'string'
            ? body.idempotencyKey
            : null,
      idempotencyKeyHeader,
      previewQueryParam:
        searchParams.get('preview') ??
        (typeof body.preview === 'string' ? body.preview : null),
      suppressNotification: body.suppressNotification === true,
      purpose,
      auth,
      bookingSource,
      leadSource,
    };

    if (isBookingSchedulingPortEnabled() && !branchCode) {
      return finalizePublicBookingError(req, gate, 'BRANCH_REQUIRED');
    }
    const publicTenant = isBookingSchedulingPortEnabled()
      ? await resolvePublicTenantForBranchCode(branchCode, 'public/booking/create', {
          staffTenantId: isInternalOps ? (auth?.tenantId ?? null) : null,
        })
      : null;
    if (isBookingSchedulingPortEnabled() && (!publicTenant || (isInternalOps && !auth?.tenantId))) {
      return finalizePublicBookingError(req, gate, 'BRANCH_NOT_FOUND');
    }

    const result = publicTenant
      ? await (async () => {
          // Operations/admin carry staff membership semantics in the staff tenant; the public
          // website is a customer actor of the tenant that owns the requested branch.
          const actor =
            isInternalOps && auth?.userId
              ? await buildStaffActorContext(auth.userId, auth.tenantId)
              : await buildCustomerActorContext(publicTenant.tenantId);
          const schedulingPortHooks = await buildSchedulingPortHooksForActor(actor);
          return createBooking({
            ...createInput,
            tenantId: publicTenant.tenantId,
            schedulingPortHooks,
          });
        })()
      : await createPublicBooking(createInput);

    const replay = result.body?.meta?.idempotentReplay === true;
    return finalizePublicBookingJson(req, gate, result.body, {
      status: result.httpStatus,
      compatibility: result.body?.compatibility ?? null,
      telemetry: {
        outcome: replay ? 'idempotent_replay' : 'success',
      },
    });
  } catch (err) {
    const { opsWriteBranchErrorResponse } = await import('@/lib/branch/opsWriteBranch');
    const branchErr = opsWriteBranchErrorResponse(err);
    if (branchErr) return branchErr;
    if (err instanceof PublicBookingCreateError) {
      return finalizePublicBookingError(req, gate, err.code, err.metadata);
    }
    if (err instanceof PublicBookingSelectionError) {
      return finalizePublicBookingError(req, gate, err.code, err.metadata);
    }
    if (isPlatformBootstrapFailure(err)) {
      console.error(
        '[public/booking/create] PLATFORM_BOOTSTRAP_REQUIRED',
        describePlatformBootstrapFailure(err),
        err,
      );
      return finalizePublicBookingError(req, gate, 'PLATFORM_BOOTSTRAP_REQUIRED');
    }
    console.error('[public/booking/create]', err);
    return finalizePublicBookingError(req, gate, 'BOOKING_CREATE_FAILED', undefined, {
      outcome: 'mutation_outcome_unknown',
    });
  }
}
