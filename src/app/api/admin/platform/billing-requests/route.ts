import { NextResponse } from 'next/server';
import { isAuthResult, requirePlatformOperator } from '@/lib/api-auth';
import { getPendingPlanRequests, reviewTenantPlanRequest } from '@/platform/commercial/planRequestService';
import { PlanRequestError } from '@/platform/commercial/planRequestPolicy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET() {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;
  try {
    return NextResponse.json({ requests: await getPendingPlanRequests() }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[api/admin/platform/billing-requests] GET', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'تعذر تحميل طلبات الاشتراك' }, { status: 500 });
  }
}

/** Review-only. Never collects money, marks paid, or changes TenantSubscription. */
export async function PATCH(req: Request) {
  const auth = await requirePlatformOperator();
  if (!isAuthResult(auth)) return auth;
  let input: { requestId: string; action: 'contacted' | 'rejected'; note: string };
  try {
    const value: unknown = await req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('not object');
    const x = value as Record<string, unknown>;
    if (Object.keys(x).some((k) => !['requestId','action','note'].includes(k))) throw Error('unknown field');
    if (typeof x.requestId !== 'string' || !UUID.test(x.requestId) || (x.action !== 'contacted' && x.action !== 'rejected') ||
        typeof x.note !== 'string' || !x.note.trim() || x.note.length > 500) throw Error('invalid');
    input = { requestId: x.requestId, action: x.action, note: x.note.trim() };
  } catch {
    return NextResponse.json({ error: 'بيانات المراجعة غير صحيحة', code: 'INVALID_REQUEST' }, { status: 400 });
  }
  try {
    await reviewTenantPlanRequest({ ...input, actorUserId: auth.userId });
    return NextResponse.json({ ok: true, paid: false, subscriptionChanged: false });
  } catch (err) {
    if (err instanceof PlanRequestError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    console.error('[api/admin/platform/billing-requests] PATCH', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'تعذر مراجعة الطلب' }, { status: 500 });
  }
}
