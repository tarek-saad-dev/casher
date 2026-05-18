import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import { checkBarberAvailableForBooking } from '@/lib/queueEstimateEngine';

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

    // For nearest: use wide 09:00-23:00 window to cover all barbers' possible schedules.
    // For specific: use 09:00-23:00 fallback (barber availability check will reject out-of-hours slots).
    const windowStart = '09:00';
    const windowEnd   = '23:00';

    // Generate slot times from window
    const slotTimes  = generateSlots(windowStart, windowEnd, settings.slotIntervalMinutes);
    const minNotice  = settings.minNoticeMinutes;
    const nowMs      = Date.now();

    // For nearest: collect all barber IDs and names upfront
    const barberIds: number[] = empId ? [empId] : await getAllBarberIds(db);
    const names = barberIds.length > 0 ? await getBarberNames(db, barberIds) : {};

    // Build slots
    const slots: any[] = [];

    for (const time of slotTimes) {
      const slotDt = new Date(`${date}T${time}:00`);
      const label  = formatTimeLabel(time);

      // Skip slots in the past or within min notice
      if (slotDt.getTime() - nowMs < minNotice * 60_000) {
        continue;
      }

      if (mode === 'specific' && empId) {
        const check = await checkBarberAvailableForBooking(empId, names[empId] ?? '', slotDt, serviceIds);
        slots.push(check.available
          ? { time, label, available: true }
          : {
              time,
              label,
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
        // Flatten empId + barberName directly onto the slot (no nested bestBarber object)
        let bestEmpId: number | null = null;
        let bestBarberName: string   = '';

        for (const bid of barberIds) {
          const check = await checkBarberAvailableForBooking(bid, names[bid] ?? '', slotDt, serviceIds);
          if (check.available) {
            bestEmpId     = bid;
            bestBarberName = names[bid] ?? '';
            break;
          }
        }

        slots.push(bestEmpId !== null
          ? { time, label, available: true, empId: bestEmpId, barberName: bestBarberName }
          : { time, label, available: false, reason: 'لا يوجد حلاق متاح' }
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

/** Format HH:MM into a 12-hour label, e.g. "03:00 PM" */
function formatTimeLabel(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12    = h % 12 === 0 ? 12 : h % 12;
  return `${String(h12).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
}

function generateSlots(start: string, end: string, intervalMin: number): string[] {
  const times: string[] = [];
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);

  // Handle overnight
  const overnight = eh * 60 + em <= sh * 60 + sm;
  const endTotal  = overnight ? (eh + 24) * 60 + em : eh * 60 + em;

  let cur = sh * 60 + sm;
  while (cur < endTotal) {
    const totalMinsOfDay = cur % (24 * 60);
    const hStr = String(Math.floor(totalMinsOfDay / 60)).padStart(2, '0');
    const mStr = String(totalMinsOfDay % 60).padStart(2, '0');
    times.push(`${hStr}:${mStr}`);
    cur += intervalMin;
  }
  return times;
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
