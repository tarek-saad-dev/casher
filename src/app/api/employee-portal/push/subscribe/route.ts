import { NextRequest, NextResponse } from 'next/server';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import {
  deletePortalPushSubscription,
  upsertPortalPushSubscription,
} from '@/lib/employee-portal/pushSubscriptions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SubscribeBody = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

function parseBody(raw: unknown): SubscribeBody {
  return raw && typeof raw === 'object' ? (raw as SubscribeBody) : {};
}

export async function POST(req: NextRequest) {
  const identity = await getEmployeePortalIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }
  if (identity.mustChangePassword) {
    return NextResponse.json({ error: 'يجب تغيير كلمة المرور أولاً' }, { status: 403 });
  }

  const body = parseBody(await req.json().catch(() => null));
  const endpoint = String(body.endpoint ?? '').trim();
  const p256dh = String(body.keys?.p256dh ?? '').trim();
  const auth = String(body.keys?.auth ?? '').trim();
  if (!endpoint || !p256dh || !auth || endpoint.length > 1000) {
    return NextResponse.json({ error: 'اشتراك غير صالح' }, { status: 400 });
  }

  try {
    await upsertPortalPushSubscription({
      empId: identity.empId,
      tenantId: identity.tenantId,
      endpoint,
      p256dh,
      auth,
      userAgent: req.headers.get('user-agent'),
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[employee-portal/push/subscribe POST]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر حفظ الاشتراك' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const identity = await getEmployeePortalIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }

  const body = parseBody(await req.json().catch(() => null));
  const endpoint = String(body.endpoint ?? '').trim();
  if (!endpoint) {
    return NextResponse.json({ error: 'endpoint مطلوب' }, { status: 400 });
  }

  try {
    const removed = await deletePortalPushSubscription({
      empId: identity.empId,
      tenantId: identity.tenantId,
      endpoint,
    });
    return NextResponse.json({ ok: true, removed });
  } catch (error) {
    console.error('[employee-portal/push/subscribe DELETE]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر حذف الاشتراك' }, { status: 500 });
  }
}
