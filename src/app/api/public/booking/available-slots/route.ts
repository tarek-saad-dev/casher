import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import {
  checkBarberAvailableForBooking,
  getDefaultDuration,
  getServicesDuration,
} from '@/lib/queueEstimateEngine';
import { getBarberAvailabilityReason } from '@/lib/barberAvailability';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/available-slots
 *
 * Query params:
 *   date       = "2026-05-17"
 *   serviceIds = "9,10"
 *   mode       = "nearest" | "specific"
 *   empId      = number (required for mode=specific)
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const { searchParams } = new URL(req.url);
    const date         = searchParams.get('date') ?? '';
    const serviceParam = searchParams.get('serviceIds') ?? '';
    const mode         = (searchParams.get('mode') ?? 'nearest') as 'nearest' | 'specific';
    const empIdParam   = searchParams.get('empId');

    if (!date || !isValidDate(date)) {
      return NextResponse.json({ error: 'تاريخ غير صالح' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    const serviceIds = serviceParam
      ? serviceParam.split(',').map(Number).filter(n => n > 0)
      : [];
    const empId = empIdParam ? Number(empIdParam) : null;

    if (mode === 'specific' && !empId) {
      return NextResponse.json({ error: 'empId مطلوب في وضع specific' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    const settings = await getPublicSettings();
    const db       = await getPool();

    // Resolve service duration
    const defaultDur  = await getDefaultDuration(db);
    const customerDur = await getServicesDuration(db, serviceIds, defaultDur);

    // Determine working window for slot generation
    // Use first available barber's schedule (or default 09:00–23:00 fallback)
    const targetEmpId = empId ?? await getFirstBarber(db);
    let windowStart = '09:00';
    let windowEnd   = '23:00';

    if (targetEmpId) {
      const noonDt   = new Date(`${date}T12:00:00`);
      const avail    = await getBarberAvailabilityReason(targetEmpId, noonDt);
      if (avail.startTime) windowStart = avail.startTime;
      if (avail.endTime)   windowEnd   = avail.endTime;
    }

    // Generate slot times from window
    const slotTimes  = generateSlots(date, windowStart, windowEnd, settings.slotIntervalMinutes);
    const minNotice  = settings.minNoticeMinutes;
    const nowMs      = Date.now();

    // For nearest: collect all barber IDs
    let barberIds: number[] = empId ? [empId] : await getAllBarberIds(db);

    // Build slots
    const slots: any[] = [];

    for (const time of slotTimes) {
      const slotDt = new Date(`${date}T${time}:00`);

      // Skip slots in the past or within min notice
      if (slotDt.getTime() - nowMs < minNotice * 60_000) {
        continue;
      }

      if (mode === 'specific' && empId) {
        const check = await checkBarberAvailableForBooking(empId, '', slotDt, serviceIds);
        slots.push(check.available
          ? { time, available: true }
          : {
              time,
              available:         false,
              reason:            check.reason,
              nextAvailableTime: check.suggestedStartTime
                ? new Date(check.suggestedStartTime)
                    .toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Cairo' })
                : null,
            }
        );
      } else {
        // Nearest: find first available barber for this slot
        let bestBarber: { id: number; name: string } | null = null;
        let availCount = 0;

        const names = await getBarberNames(db, barberIds);
        for (const bid of barberIds) {
          const check = await checkBarberAvailableForBooking(bid, names[bid] ?? '', slotDt, serviceIds);
          if (check.available) {
            availCount++;
            if (!bestBarber) bestBarber = { id: bid, name: names[bid] ?? '' };
          }
        }

        slots.push(bestBarber
          ? { time, available: true, bestBarber, availableBarbersCount: availCount }
          : { time, available: false, reason: 'لا يوجد حلاق متاح' }
        );
      }
    }

    return NextResponse.json({
      ok:   true,
      date,
      mode,
      ...(mode === 'specific' && empId ? { empId } : {}),
      slots,
    }, { headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/available-slots]', err);
    return NextResponse.json({ error: 'فشل تحميل المواعيد' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateSlots(date: string, start: string, end: string, intervalMin: number): string[] {
  const times: string[] = [];
  let [sh, sm] = start.split(':').map(Number);
  let [eh, em] = end.split(':').map(Number);

  // Handle overnight
  const overnight = eh * 60 + em <= sh * 60 + sm;
  const endTotal  = overnight ? (eh + 24) * 60 + em : eh * 60 + em;

  let cur = sh * 60 + sm;
  while (cur < endTotal) {
    const hh = String(cur % (24 * 60) < 0 ? (cur % (24 * 60)) + 24 * 60 : cur % (24 * 60))
      .padStart(4, '0');
    const totalMinsOfDay = cur % (24 * 60);
    const hStr = String(Math.floor(totalMinsOfDay / 60)).padStart(2, '0');
    const mStr = String(totalMinsOfDay % 60).padStart(2, '0');
    times.push(`${hStr}:${mStr}`);
    cur += intervalMin;
  }
  return times;
}

async function getFirstBarber(db: any): Promise<number | null> {
  const res = await db.request().query(`
    SELECT TOP 1 EmpID FROM [dbo].[TblEmp]
    WHERE ISNULL(isActive,1)=1 AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber')
  `).catch(() => ({ recordset: [] }));
  return res.recordset[0]?.EmpID ?? null;
}

async function getAllBarberIds(db: any): Promise<number[]> {
  const res = await db.request().query(`
    SELECT EmpID FROM [dbo].[TblEmp]
    WHERE ISNULL(isActive,1)=1 AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber')
    ORDER BY EmpName
  `).catch(() => ({ recordset: [] }));
  return res.recordset.map((r: any) => r.EmpID as number);
}

async function getBarberNames(db: any, ids: number[]): Promise<Record<number, string>> {
  if (!ids.length) return {};
  const res = await db.request().query(`
    SELECT EmpID, EmpName FROM [dbo].[TblEmp]
    WHERE EmpID IN (${ids.join(',')})
  `).catch(() => ({ recordset: [] }));
  const map: Record<number, string> = {};
  for (const r of res.recordset) map[r.EmpID] = r.EmpName;
  return map;
}
