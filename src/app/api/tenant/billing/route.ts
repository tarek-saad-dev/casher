import { NextResponse } from 'next/server';
import { isAuthResult } from '@/lib/api-auth';
import { getPool } from '@/lib/db';
import { getTenantSubscription } from '@/platform/commercial/planRepository';
import { getTenantPlanRequests } from '@/platform/commercial/planRequestService';
import { requireTenantBillingAdmin } from '@/platform/commercial/tenantBillingAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store' };

/**
 * During the migration away from fixed named tiers, show the existing subscription
 * and historical requests honestly. Never advertise or quote obsolete plan prices.
 */
export async function GET() {
  const auth = await requireTenantBillingAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    const pool = await getPool();
    const [subscription, requests] = await Promise.all([
      getTenantSubscription(pool, auth.tenantId),
      getTenantPlanRequests(pool, auth.tenantId),
    ]);
    if (!subscription) return NextResponse.json({
      error: 'لا يوجد اشتراك', code: 'SUBSCRIPTION_NOT_FOUND',
    }, { status: 404, headers: NO_STORE });
    return NextResponse.json({
      subscription: {
        planCode: subscription.planCode, // Historical technical code, NOT a new offer
        status: subscription.status,
        revision: subscription.revision,
        trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt?.toISOString() ?? null,
      },
      requests, // Historical/manual-review requests only
      commercialModel: 'modular_transition',
      newPaidRequestsEnabled: false,
      paymentMode: 'no_checkout',
      protectedTenant: auth.tenant.tenantCode === 'CASHER_BOOT',
    }, { headers: NO_STORE });
  } catch (err) {
    console.error('[api/tenant/billing] GET error', err instanceof Error ? err.message : err);
    return NextResponse.json({
      error: 'تعذر تحميل بيانات الاشتراك', code: 'BILLING_UNAVAILABLE',
    }, { status: 500, headers: NO_STORE });
  }
}

/**
 * Old Starter/Growth/Pro requests are withdrawn from new sales.
 * Auth is still enforced (even if trial expired). This endpoint performs NO writes.
 * Pending historical requests remain visible to tenant and operator for reconciliation.
 */
export async function POST(_req: Request) {
  const auth = await requireTenantBillingAdmin();
  if (!isAuthResult(auth)) return auth;
  return NextResponse.json({
    error: 'نظام الباقات القديمة متوقف. التسعير الجديد حسب التطبيقات ما زال قيد الاعتماد.',
    code: 'LEGACY_PLAN_REQUESTS_CLOSED',
    paid: false,
    subscriptionChanged: false,
    commercialModel: 'modular_transition',
  }, { status: 409, headers: NO_STORE });
}
