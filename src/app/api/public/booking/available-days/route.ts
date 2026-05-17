import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getBarberAvailabilityReason } from '@/lib/barberAvailability';
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import { checkBarberAvailableForBooking, cairoDateStr } from '@/lib/queueEstimateEngine';

export const runtime = 'nodejs';

const AR_DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/available-days
 *
 * Query params:
 *   serviceIds  = "9,10"
 *   mode        = "nearest" | "specific"
 *   empId       = number (required if mode=specific)
 *   fromDate    = "YYYY-MM-DD" (default: today)
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const { searchParams } = new URL(req.url);
    const serviceIdsParam  = searchParams.get('serviceIds') ?? '';
    const mode             = (searchParams.get('mode') ?? 'nearest') as 'nearest' | 'specific';
    const empIdParam       = searchParams.get('empId');
    const fromDateParam    = searchParams.get('fromDate');

    const serviceIds = serviceIdsParam
      ? serviceIdsParam.split(',').map(Number).filter(n => n > 0)
      : [];
    const empId = empIdParam ? Number(empIdParam) : null;

    const settings  = await getPublicSettings();
    const totalDays = settings.maxBookingDaysAhead;

    // Start from today (Cairo local date)
    const todayStr   = cairoDateStr(new Date());
    const startDate  = fromDateParam && isValidDate(fromDateParam) ? fromDateParam : todayStr;
    const startMs    = Date.parse(startDate);

    // Determine barber list
    const db = await getPool();
    let barberIds: number[] = [];

    if (mode === 'specific' && empId) {
      barberIds = [empId];
    } else {
      const bRes = await db.request().query(`
        SELECT EmpID FROM [dbo].[TblEmp]
        WHERE ISNULL(isActive,1)=1
          AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber')
      `).catch(() => ({ recordset: [] as any[] }));
      barberIds = bRes.recordset.map((r: any) => r.EmpID as number);
    }

    const days: Array<{ date: string; available: boolean; label: string; reason?: string }> = [];

    for (let i = 0; i < totalDays; i++) {
      const ms      = startMs + i * 86_400_000;
      const dateStr = new Date(ms).toISOString().slice(0, 10);
      const dow     = new Date(ms).getDay();
      const label   = AR_DAYS[dow];

      // For each day, check if at least one barber is working (no slots check — fast)
      let anyWorking = false;
      for (const bid of barberIds) {
        // Check working schedule for noon of that day (representative time)
        const noonDt = new Date(`${dateStr}T12:00:00`);
        const avail  = await getBarberAvailabilityReason(bid, noonDt);
        if (avail.available) { anyWorking = true; break; }
      }

      days.push({
        date:      dateStr,
        available: anyWorking,
        label,
        ...(anyWorking ? {} : { reason: 'لا يوجد حلاق متاح في هذا اليوم' }),
      });
    }

    return NextResponse.json({ ok: true, days }, { headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/available-days]', err);
    return NextResponse.json({ error: 'فشل تحميل الأيام المتاحة' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}
