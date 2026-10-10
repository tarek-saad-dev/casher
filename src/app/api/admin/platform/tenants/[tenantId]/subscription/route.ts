import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { getPool } from '@/lib/db';
import { evaluateCommercialAccess } from '@/platform/commercial/commercialAccess';
import { getTenantSubscription, tenantExists } from '@/platform/commercial/planRepository';
import {
  changeTenantPlan,
  transitionTenantSubscription,
} from '@/platform/commercial/subscriptionService';
import {
  invalidTenantIdResponse,
  platformErrorResponse,
  readJsonBody,
} from '../../../_shared/platformErrors';

export const runtime = 'nodejs';

type RouteParams = { params: Promise<{ tenantId: string }> };

const SYSTEM_FIELDS = [
  'tenantId',
  'status',
  'origin',
  'revision',
  'trialStartedAt',
  'trialEndsAt',
  'pastDueSince',
  'suspendedAt',
  'cancelledAt',
] as const;

/** GET /api/admin/platform/tenants/:tenantId/subscription */
export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const { tenantId } = await params;
  const invalid = invalidTenantIdResponse(tenantId);
  if (invalid) return invalid;

  const pool = await getPool();
  if (!(await tenantExists(pool, tenantId))) {
    return NextResponse.json({ error: 'Tenant not found', code: 'TENANT_NOT_FOUND' }, { status: 404 });
  }
  const subscription = await getTenantSubscription(pool, tenantId);
  const access = await evaluateCommercialAccess(tenantId, { executor: pool });
  return NextResponse.json({ subscription, access });
}

/**
 * PATCH /api/admin/platform/tenants/:tenantId/subscription
 * Body: { planCode } to change plan (installed apps never change), or
 *       { action: activate|mark_past_due|suspend|cancel|reactivate, currentPeriodEndsAt? }.
 * Optional expectedRevision for optimistic concurrency.
 */
export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;

  const { tenantId } = await params;
  const invalid = invalidTenantIdResponse(tenantId);
  if (invalid) return invalid;

  try {
    const body = await readJsonBody(req);
    const forbidden = SYSTEM_FIELDS.filter((f) => f in body);
    if (forbidden.length) {
      return NextResponse.json(
        { error: `System-controlled fields are not accepted: ${forbidden.join(', ')}`, code: 'INVALID_REQUEST' },
        { status: 400 },
      );
    }
    const expectedRevision =
      body.expectedRevision != null ? Number(body.expectedRevision) : undefined;
    if (expectedRevision !== undefined && !Number.isInteger(expectedRevision)) {
      return NextResponse.json(
        { error: 'expectedRevision must be an integer', code: 'INVALID_REQUEST' },
        { status: 400 },
      );
    }
    if (
      body.currentPeriodEndsAt !== undefined &&
      !(body.action === 'activate' || body.action === 'reactivate')
    ) {
      return NextResponse.json(
        { error: 'currentPeriodEndsAt is only accepted with action activate or reactivate', code: 'INVALID_REQUEST' },
        { status: 400 },
      );
    }
    const actor = { actorUserId: auth.userId };

    if (body.planCode != null && body.action != null) {
      return NextResponse.json(
        { error: 'Send either planCode or action, not both', code: 'INVALID_REQUEST' },
        { status: 400 },
      );
    }

    let subscription;
    if (body.planCode != null) {
      subscription = await changeTenantPlan(tenantId, String(body.planCode).trim().toLowerCase(), {
        actor,
        expectedRevision,
      });
    } else if (body.action != null) {
      let currentPeriodEndsAt: Date | null | undefined;
      if (body.currentPeriodEndsAt === null) currentPeriodEndsAt = null;
      else if (body.currentPeriodEndsAt != null) {
        const parsed = new Date(String(body.currentPeriodEndsAt));
        if (Number.isNaN(parsed.getTime())) {
          return NextResponse.json(
            { error: 'currentPeriodEndsAt must be an ISO date', code: 'INVALID_REQUEST' },
            { status: 400 },
          );
        }
        currentPeriodEndsAt = parsed;
      }
      subscription = await transitionTenantSubscription(tenantId, String(body.action), {
        actor,
        expectedRevision,
        currentPeriodEndsAt,
      });
    } else {
      return NextResponse.json(
        { error: 'planCode or action is required', code: 'INVALID_REQUEST' },
        { status: 400 },
      );
    }

    const access = await evaluateCommercialAccess(tenantId);
    return NextResponse.json({ subscription, access });
  } catch (err) {
    const mapped = platformErrorResponse(err);
    if (mapped) return mapped;
    console.error('[api/admin/platform/tenants/subscription] PATCH error:', err);
    return NextResponse.json({ error: 'Subscription update failed' }, { status: 500 });
  }
}
