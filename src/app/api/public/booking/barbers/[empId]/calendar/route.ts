import { NextRequest, NextResponse } from 'next/server';
import {
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import { buildBarberCalendar } from '@/lib/hr/barberGlobalCalendar';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/barbers/[empId]/calendar?from=&to=&serviceIds=&branchCode=
 */
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
    if (!Number.isFinite(empId) || empId <= 0) {
      return NextResponse.json({ error: 'empId غير صالح' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    if (!isValidDate(from) || !isValidDate(to) || from > to) {
      return NextResponse.json(
        { error: 'from/to مطلوبان بصيغة YYYY-MM-DD' },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    const serviceIds = (searchParams.get('serviceIds') || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    const branchCode = searchParams.get('branchCode');

    const calendar = await buildBarberCalendar({
      empId,
      from,
      to,
      serviceIds: serviceIds.length ? serviceIds : undefined,
      branchCode,
      publicOnly: true,
    });

    return NextResponse.json(
      {
        ok: true,
        barber: calendar.barber,
        from: calendar.from,
        to: calendar.to,
        presenceOnly: calendar.presenceOnly,
        note: calendar.presenceOnly
          ? 'presence availability — not guaranteed booking slots (pass serviceIds for exact slots)'
          : undefined,
        days: calendar.days,
      },
      { headers: PUBLIC_CORS_HEADERS },
    );
  } catch (err) {
    console.error('[public/booking/barbers/calendar]', err);
    return NextResponse.json({ error: 'فشل تحميل التقويم' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}
