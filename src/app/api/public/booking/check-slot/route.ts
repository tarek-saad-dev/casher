import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  isValidTime,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import { checkBarberAvailableForBooking, cairoDateStr } from '@/lib/queueEstimateEngine';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * POST /api/public/booking/check-slot
 *
 * Body:
 *   { date, time, serviceIds, mode, empId? }
 *
 * Returns availability for the requested slot.
 * For nearest mode, picks best available barber.
 */
export async function POST(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip, 120)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const {
      date,
      time,
      serviceIds = [],
      mode       = 'nearest',
      empId,
    } = body as {
      date:        string;
      time:        string;
      serviceIds?: number[];
      mode?:       'nearest' | 'specific';
      empId?:      number;
    };

    if (!date || !isValidDate(date)) {
      return NextResponse.json({ error: 'تاريخ غير صالح' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }
    if (!time || !isValidTime(time)) {
      return NextResponse.json({ error: 'وقت غير صالح' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }
    if (mode === 'specific' && !empId) {
      return NextResponse.json({ error: 'empId مطلوب في وضع specific' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    const slotDt = new Date(`${date}T${time}:00`);
    const db     = await getPool();

    if (mode === 'specific' && empId) {
      const empRes = await db.request().query(
        `SELECT TOP 1 EmpID, EmpName FROM [dbo].[TblEmp] WHERE EmpID = ${empId}`
      ).catch(() => ({ recordset: [] as any[] }));
      const emp = empRes.recordset[0];
      if (!emp) {
        return NextResponse.json({ error: 'الحلاق غير موجود' }, { status: 404, headers: PUBLIC_CORS_HEADERS });
      }

      const check = await checkBarberAvailableForBooking(empId, emp.EmpName, slotDt, serviceIds);

      if (check.available) {
        return NextResponse.json({
          ok:        true,
          available: true,
          barber:    { id: empId, name: emp.EmpName },
          slot: {
            start:           check.startTime,
            end:             check.endTime,
            durationMinutes: check.durationMinutes,
          },
        }, { headers: PUBLIC_CORS_HEADERS });
      }

      return NextResponse.json({
        ok:                false,
        available:         false,
        reason:            check.reason,
        conflictType:      check.conflictType,
        nextAvailableTime: check.suggestedStartTime,
      }, { status: 200, headers: PUBLIC_CORS_HEADERS });
    }

    // Nearest mode — find first available barber
    const bRes = await db.request().query(`
      SELECT EmpID, EmpName FROM [dbo].[TblEmp]
      WHERE ISNULL(isActive,1)=1 AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber')
      ORDER BY EmpName
    `).catch(() => ({ recordset: [] as any[] }));

    for (const emp of bRes.recordset) {
      const check = await checkBarberAvailableForBooking(emp.EmpID, emp.EmpName, slotDt, serviceIds);
      if (check.available) {
        return NextResponse.json({
          ok:        true,
          available: true,
          barber:    { id: emp.EmpID, name: emp.EmpName },
          slot: {
            start:           check.startTime,
            end:             check.endTime,
            durationMinutes: check.durationMinutes,
          },
        }, { headers: PUBLIC_CORS_HEADERS });
      }
    }

    return NextResponse.json({
      ok:           false,
      available:    false,
      reason:       'لا يوجد حلاق متاح في هذا الموعد',
      conflictType: 'queue',
    }, { status: 200, headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/check-slot]', err);
    return NextResponse.json({ error: 'فشل التحقق من الموعد' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}
