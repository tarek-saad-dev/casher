import { NextResponse } from 'next/server';
import { getEmployeePortalIdentity } from '@/lib/employee-portal/auth';
import {
  normalizeHandoffServices,
  upsertEmployeeHandoff,
} from '@/lib/booking/cashierHandoff';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const identity = await getEmployeePortalIdentity();
  if (!identity) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
  }
  if (identity.mustChangePassword) {
    return NextResponse.json({ error: 'يجب تغيير كلمة المرور أولاً' }, { status: 403 });
  }

  const { id } = await params;
  const bookingId = Number(id);
  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return NextResponse.json({ error: 'حجز غير صالح' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'طلب غير صالح' }, { status: 400 });
  }

  const servicesRaw = (body as { services?: unknown })?.services;
  if (!Array.isArray(servicesRaw)) {
    return NextResponse.json({ error: 'اختر خدمة واحدة على الاقل' }, { status: 400 });
  }

  const services = normalizeHandoffServices(
    servicesRaw.map((row) => {
      const r = row as { proId?: unknown; qty?: unknown; source?: unknown };
      return {
        proId: Number(r.proId),
        qty: Number(r.qty ?? 1),
        source: typeof r.source === 'string' ? r.source : 'booked',
      };
    }),
  );

  if (services.length === 0) {
    return NextResponse.json({ error: 'اختر خدمة واحدة على الاقل' }, { status: 400 });
  }

  try {
    const result = await upsertEmployeeHandoff({
      bookingId,
      empId: identity.empId,
      tenantId: identity.tenantId,
      services,
    });

    if (!result.ok) {
      const map: Record<typeof result.error, { status: number; message: string }> = {
        not_found: { status: 404, message: 'الحجز غير موجود' },
        forbidden: { status: 403, message: 'غير مصرح لهذا الحجز' },
        not_sendable: { status: 409, message: 'لا يمكن ارسال هذا الحجز' },
        already_charged: { status: 409, message: 'تم التحصيل مسبقا' },
        empty_services: { status: 400, message: 'اختر خدمة واحدة على الاقل' },
      };
      const mapped = map[result.error];
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    return NextResponse.json({
      ok: true,
      handoffId: result.handoffId,
      updated: result.updated,
    });
  } catch (error) {
    console.error('[employee-portal/handoff]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر ارسال الطلب للكاشير' }, { status: 500 });
  }
}
