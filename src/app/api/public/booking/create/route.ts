import { NextRequest } from 'next/server';
import { extractPublicBranchCode } from '@/lib/branch/bookingQueueOwnership';
import {
  isActiveBranchContext,
  requireBranchOperationAccess,
} from '@/lib/branch/context';
import {
  publicBookingOptionsResponse,
  PUBLIC_BOOKING_ROUTE_CORS,
} from '@/lib/booking/publicBookingCors';
import {
  PublicBookingCreateError,
  createPublicBooking,
} from '@/lib/booking/publicBookingCreate';
import { PublicBookingSelectionError } from '@/lib/booking/publicBookingSelectionEvaluator';
import {
  gatePublicBookingRoute,
  finalizePublicBookingError,
  finalizePublicBookingJson,
} from '@/lib/booking/publicBookingRouteGate';

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

    const sourceRaw = typeof body.source === 'string' ? body.source.trim().toLowerCase() : '';
    const isInternalOps = sourceRaw === 'operations' || sourceRaw === 'admin';

    let branchCode = extractPublicBranchCode(searchParams, body);
    let purpose: 'public_booking' | 'internal_preview' | undefined;
    let auth: { userId: number; canOperate?: boolean } | null = null;
    let bookingSource: 'online' | 'operations' | 'admin' = 'online';

    if (isInternalOps) {
      const branch = await requireBranchOperationAccess();
      if (!isActiveBranchContext(branch)) return branch;

      const empIdNum =
        typeof body.empId === 'number'
          ? body.empId
          : body.empId != null
            ? Number(body.empId)
            : NaN;
      const workDate =
        typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
          ? body.date
          : undefined;

      if (Number.isFinite(empIdNum) && empIdNum > 0) {
        const { resolveOpsWriteBranch } = await import('@/lib/branch/opsWriteBranch');
        const target = await resolveOpsWriteBranch({
          userId: branch.userId,
          sessionBranchId: branch.branchId,
          empId: empIdNum,
          workDate,
          requestedBranchId: body.branchId ?? body.BranchID,
        });
        branchCode = target.branchCode;
      } else {
        // Nearest / no emp yet — stay on session branch (legacy).
        branchCode = branch.branchCode;
      }

      purpose = 'internal_preview';
      auth = { userId: branch.userId, canOperate: branch.canOperate };
      bookingSource = sourceRaw === 'admin' ? 'admin' : 'operations';
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

    const result = await createPublicBooking({
      branchCode,
      date: typeof body.date === 'string' ? body.date : null,
      time: typeof body.time === 'string' ? body.time : null,
      dayOffset: body.dayOffset,
      serviceIds: body.serviceIds,
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
    });

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
    console.error('[public/booking/create]', err);
    return finalizePublicBookingError(req, gate, 'BOOKING_CREATE_FAILED', undefined, {
      outcome: 'mutation_outcome_unknown',
    });
  }
}
