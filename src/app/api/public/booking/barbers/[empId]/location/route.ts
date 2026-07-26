import { NextRequest, NextResponse } from 'next/server';
import {
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import { resolveBarberLocationForDate } from '@/lib/hr/barberGlobalCalendar';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/** GET /api/public/booking/barbers/[empId]/location?date= */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ empId: string }> },
) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const { empId: empIdRaw } = await ctx.params;
    const empId = Number(empIdRaw);
    const date = new URL(req.url).searchParams.get('date') || '';
    if (!Number.isFinite(empId) || empId <= 0 || !isValidDate(date)) {
      return NextResponse.json({ error: 'معاملات غير صالحة' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    const loc = await resolveBarberLocationForDate({
      empId,
      date,
      publicOnly: true,
    });

    return NextResponse.json({ ok: true, ...loc }, { headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/barbers/location]', err);
    return NextResponse.json({ error: 'فشل تحديد الفرع' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}
