import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getAvailableBarbers } from '@/lib/barberAvailability';
import {
  checkBarberAvailableForBooking,
  BookingAvailability,
  cairoDateStr,
} from '@/lib/queueEstimateEngine';
import type { BookingBarberResult } from '@/lib/operationsTypes';

export const runtime = 'nodejs';

/**
 * POST /api/bookings/estimate
 *
 * Accepts:
 *   { mode, empId?, serviceIds?, bookingDate, bookingTime }
 *   mode = 'specific' | 'nearest' | 'all'
 *
 * bookingDate: "YYYY-MM-DD"
 * bookingTime: "HH:MM"  (local Cairo time)
 *
 * Returns BookingEstimateResponse with barbers[] for mode='all'/'nearest',
 * or single barber result for mode='specific'.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      mode = 'all',
      empId,
      serviceIds = [],
      bookingDate,
      bookingTime,
      bookingDateTime,   // legacy alias
    } = body as {
      mode?:            'nearest' | 'specific' | 'all';
      empId?:           number;
      serviceIds?:      number[];
      bookingDate?:     string;
      bookingTime?:     string;
      bookingDateTime?: string;
    };

    // Build the booking start Date from bookingDate+bookingTime or legacy bookingDateTime
    let dt: Date;
    if (bookingDate && bookingTime) {
      dt = new Date(`${bookingDate}T${bookingTime}:00`);
    } else if (bookingDateTime) {
      dt = new Date(bookingDateTime);
    } else {
      return NextResponse.json({ error: 'bookingDate + bookingTime مطلوبان' }, { status: 400 });
    }

    const resolvedDate = bookingDate ?? cairoDateStr(dt);
    const resolvedTime = bookingTime ?? `${String(dt.getHours()).padStart(2,'0')}:${String(dt.getMinutes()).padStart(2,'0')}`;

    console.log('[booking estimate] bookingDate', resolvedDate);
    console.log('[booking estimate] bookingTime', resolvedTime);
    console.log('[booking estimate] serviceIds', serviceIds);
    console.log('[booking estimate] mode', mode);

    /** Convert BookingAvailability → BookingBarberResult */
    function toResult(r: BookingAvailability, workingWindow: string | null = null): BookingBarberResult {
      return {
        empId:               r.empId,
        empName:             r.empName,
        available:           r.available,
        statusText:          r.available ? 'متاح في هذا الموعد' : buildStatusText(r),
        reason:              r.reason,
        conflictType:        r.conflictType,
        workingWindow,
        nextAvailableTime:   r.suggestedStartTime,
        startTime:           r.startTime,
        endTime:             r.endTime,
        durationMinutes:     r.durationMinutes,
        conflictingTickets:  r.conflictingTickets,
        conflictingBookings: r.conflictingBookings,
      };
    }

    function buildStatusText(r: BookingAvailability): string {
      if (r.conflictType === 'day_off')       return 'غير متاح — إجازة';
      if (r.conflictType === 'working_hours') return 'غير متاح — خارج مواعيد العمل';
      if (r.conflictType === 'queue')         return `غير متاح — ${r.reason ?? 'لديه أدوار متوقعة'}`;
      if (r.conflictType === 'booking')       return 'غير متاح — لديه حجز آخر في هذا الموعد';
      return r.reason ?? 'غير متاح';
    }

    // ── Specific barber mode ───────────────────────────────────────────────
    if (mode === 'specific') {
      if (!empId) {
        return NextResponse.json({ error: 'empId مطلوب في الوضع المحدد' }, { status: 400 });
      }
      const db = await getPool();
      const empRes = await db.request()
        .input('id', sql.Int, empId)
        .query(`SELECT EmpID, EmpName, WorkingStartTime, WorkingEndTime
                FROM dbo.TblEmp e
                LEFT JOIN dbo.TblEmpWorkSchedule ws
                  ON ws.EmpID = e.EmpID AND ws.DayOfWeek = DATEPART(WEEKDAY, GETDATE()) - 1
                WHERE e.EmpID = @id`).catch(() =>
          db.request().input('id', sql.Int, empId)
            .query(`SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = @id`)
        );
      const emp = empRes.recordset[0];
      if (!emp) return NextResponse.json({ error: 'الموظف غير موجود' }, { status: 404 });

      const ww = emp.WorkingStartTime && emp.WorkingEndTime
        ? `${String(emp.WorkingStartTime).slice(0,5)} – ${String(emp.WorkingEndTime).slice(0,5)}`
        : null;

      const check = await checkBarberAvailableForBooking(empId, emp.EmpName, dt, serviceIds);
      const result = toResult(check, ww);

      console.log('[booking estimate] barber results', [result]);

      return NextResponse.json({
        ok:           result.available,
        barbers:      [result],
        best:         result.available ? result : null,
        alternatives: [],
        unavailable:  result.available ? [] : [result],
        reason:       result.reason,
        conflictType: result.conflictType,
        suggestedStartTime:  check.suggestedStartTime,
        conflictingTickets:  check.conflictingTickets,
        conflictingBookings: check.conflictingBookings,
      });
    }

    // ── All / Nearest mode — check every barber ────────────────────────────
    // Use getAvailableBarbers as base list (returns ALL barbers by Job=حلاق/مساعد)
    // regardless of schedule so we can show "خارج مواعيد العمل" on the card.
    const db = await getPool();
    const allEmpRes = await db.request().query(`
      SELECT e.EmpID, e.EmpName
      FROM dbo.TblEmp e
      WHERE e.Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
        AND ISNULL(e.IsActive, 1) = 1
      ORDER BY e.EmpName
    `).catch(() => ({ recordset: [] as Array<{EmpID:number;EmpName:string}> }));

    const allEmps = allEmpRes.recordset.length > 0
      ? allEmpRes.recordset
      : await getAvailableBarbers(dt).then(b => b.map(x => ({ EmpID: x.EmpID, EmpName: x.EmpName })));

    const checks = await Promise.all(
      allEmps.map(b => checkBarberAvailableForBooking(b.EmpID, b.EmpName, dt, serviceIds))
    );

    const barbers: BookingBarberResult[] = checks.map(c => toResult(c));

    const available   = barbers.filter(b => b.available);
    const unavailable = barbers.filter(b => !b.available);
    const [best, ...alternatives] = available;

    console.log('[booking estimate] barber results', barbers.map(b => ({
      empId: b.empId, empName: b.empName, available: b.available, conflictType: b.conflictType,
    })));

    return NextResponse.json({
      ok:           available.length > 0,
      barbers,
      best:         best ?? null,
      alternatives: alternatives ?? [],
      unavailable,
    });
  } catch (err) {
    console.error('[bookings/estimate]', err);
    return NextResponse.json({ error: 'فشل التحقق من توفر الحلاق' }, { status: 500 });
  }
}
