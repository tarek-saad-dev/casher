import { NextResponse } from 'next/server';
import { isAuthResult } from '@/lib/api-auth';
import { getPool } from '@/lib/db';
import { listPlans, getTenantSubscription } from '@/platform/commercial/planRepository';
import { availablePlanOffers, PlanRequestError, type BillingCycle } from '@/platform/commercial/planRequestPolicy';
import { getTenantPlanRequests, submitTenantPlanRequest } from '@/platform/commercial/planRequestService';
import { requireTenantBillingAdmin } from '@/platform/commercial/tenantBillingAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const auth = await requireTenantBillingAdmin();
  if (!isAuthResult(auth)) return auth;
  try {
    const pool = await getPool();
    const [subscription, plans, requests] = await Promise.all([
      getTenantSubscription(pool, auth.tenantId),
      listPlans(pool),
      getTenantPlanRequests(pool, auth.tenantId),
    ]);
    if (!subscription) return NextResponse.json({ error: 'لا يوجد اشتراك', code: 'SUBSCRIPTION_NOT_FOUND' }, { status: 404 });
    return NextResponse.json({
      subscription: {
        planCode: subscription.planCode,
        status: subscription.status,
        revision: subscription.revision,
        trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
        currentPeriodEndsAt: subscription.currentPeriodEndsAt?.toISOString() ?? null,
      },
      plans: availablePlanOffers(plans),
      requests,
      paymentMode: 'manual_review_only',
      protectedTenant: auth.tenant.tenantCode === 'CASHER_BOOT',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[api/tenant/billing] GET error', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'تعذر تحميل بيانات الاشتراك', code: 'BILLING_UNAVAILABLE' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireTenantBillingAdmin();
  if (!isAuthResult(auth)) return auth;
  if (auth.tenant.tenantCode === 'CASHER_BOOT') {
    return NextResponse.json({ error: 'حساب المنصة محمي من تغيير الاشتراكات', code: 'BOOTSTRAP_TENANT_PROTECTED' }, { status: 409 });
  }
  let input: { planCode: string; billingCycle: BillingCycle; expectedRevision: number };
  try {
    const value: unknown = await req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('not object');
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some((k) => !['planCode','billingCycle','expectedRevision'].includes(k))) throw Error('unknown field');
    if (typeof body.planCode !== 'string' || !['starter','growth','pro'].includes(body.planCode)) throw Error('bad plan');
    if (body.billingCycle !== 'monthly' && body.billingCycle !== 'annual') throw Error('bad cycle');
    if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) throw Error('bad revision');
    input = { planCode: body.planCode, billingCycle: body.billingCycle, expectedRevision: Number(body.expectedRevision) };
  } catch {
    return NextResponse.json({ error: 'اختيارات الاشتراك غير صحيحة', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  try {
    const request = await submitTenantPlanRequest({ tenantId: auth.tenantId,
      actorUserId: auth.userId, ...input });
    return NextResponse.json({ request, paymentMode: 'manual_review_only', subscriptionChanged: false, paid: false }, {
      status: 202, headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    if (err instanceof PlanRequestError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error('[api/tenant/billing] POST error', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'تعذر تسجيل الطلب', code: 'BILLING_UNAVAILABLE' }, { status: 500 });
  }
}
