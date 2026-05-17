import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  isValidTime,
  isValidPhone,
  generateBookingCode,
  upsertCustomer,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';
import {
  checkBarberAvailableForBooking,
  getDefaultDuration,
  getServicesDuration,
} from '@/lib/queueEstimateEngine';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * POST /api/public/booking/create
 *
 * Body:
 * {
 *   customer: { name, phone },
 *   serviceIds: number[],
 *   mode: "nearest" | "specific",
 *   empId?: number,
 *   date: "YYYY-MM-DD",
 *   time: "HH:MM",
 *   notes?: string
 * }
 *
 * Server flow:
 *   1. Validate inputs
 *   2. Re-run availability check (prevents double booking)
 *   3. Upsert customer
 *   4. Insert booking + services
 *   5. Return confirmation
 */
export async function POST(req: NextRequest) {
  const ip = getRateLimitKey(req);
  // Stricter rate limit for create: 10 per minute per IP
  if (!checkRateLimit(ip, 10)) {
    return NextResponse.json({ error: 'طلبات كثيرة — حاول لاحقاً' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const body = await req.json();
    const {
      customer,
      serviceIds = [],
      mode       = 'nearest',
      empId,
      date,
      time,
      notes      = '',
    } = body as {
      customer:    { name: string; phone: string };
      serviceIds?: number[];
      mode?:       'nearest' | 'specific';
      empId?:      number;
      date:        string;
      time:        string;
      notes?:      string;
    };

    // ── Validation ───────────────────────────────────────────────────────────
    if (!customer?.name || customer.name.trim().length < 2) {
      return NextResponse.json({ error: 'الاسم مطلوب (حرفان على الأقل)' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }
    if (!customer?.phone || !isValidPhone(customer.phone)) {
      return NextResponse.json({ error: 'رقم الهاتف غير صالح' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }
    if (!date || !isValidDate(date)) {
      return NextResponse.json({ error: 'التاريخ غير صالح' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }
    if (!time || !isValidTime(time)) {
      return NextResponse.json({ error: 'الوقت غير صالح' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }
    if (mode === 'specific' && !empId) {
      return NextResponse.json({ error: 'empId مطلوب في وضع specific' }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    const settings  = await getPublicSettings();
    if (!settings.bookingEnabled) {
      return NextResponse.json({ error: 'الحجز الإلكتروني غير متاح حالياً' }, { status: 503, headers: PUBLIC_CORS_HEADERS });
    }

    const slotDt = new Date(`${date}T${time}:00`);

    // Prevent bookings too soon
    const noticeMs = settings.minNoticeMinutes * 60_000;
    if (slotDt.getTime() - Date.now() < noticeMs) {
      return NextResponse.json({
        error: `يجب الحجز قبل الموعد بـ ${settings.minNoticeMinutes} دقيقة على الأقل`,
      }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    // Prevent bookings too far ahead
    const maxMs = settings.maxBookingDaysAhead * 86_400_000;
    if (slotDt.getTime() - Date.now() > maxMs) {
      return NextResponse.json({
        error: `لا يمكن الحجز أكثر من ${settings.maxBookingDaysAhead} يوم مسبقاً`,
      }, { status: 400, headers: PUBLIC_CORS_HEADERS });
    }

    const db = await getPool();

    // ── Resolve barber ───────────────────────────────────────────────────────
    let resolvedEmpId:   number  = 0;
    let resolvedEmpName: string  = '';

    if (mode === 'specific' && empId) {
      const empRes = await db.request().query(
        `SELECT TOP 1 EmpID, EmpName FROM [dbo].[TblEmp] WHERE EmpID = ${empId}`
      ).catch(() => ({ recordset: [] as any[] }));
      if (!empRes.recordset[0]) {
        return NextResponse.json({ error: 'الحلاق غير موجود' }, { status: 404, headers: PUBLIC_CORS_HEADERS });
      }
      resolvedEmpId   = empRes.recordset[0].EmpID   as number;
      resolvedEmpName = empRes.recordset[0].EmpName as string;
    } else {
      // Nearest: pick first available barber
      const bRes = await db.request().query(`
        SELECT EmpID, EmpName FROM [dbo].[TblEmp]
        WHERE ISNULL(isActive,1)=1 AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber')
        ORDER BY EmpName
      `).catch(() => ({ recordset: [] as any[] }));

      for (const emp of bRes.recordset) {
        const check = await checkBarberAvailableForBooking(emp.EmpID, emp.EmpName, slotDt, serviceIds);
        if (check.available) {
          resolvedEmpId   = emp.EmpID   as number;
          resolvedEmpName = emp.EmpName as string;
          break;
        }
      }
      if (!resolvedEmpId) {
        return NextResponse.json({
          ok:     false,
          error:  'لا يوجد حلاق متاح في هذا الموعد',
          reason: 'no_barber_available',
        }, { status: 409, headers: PUBLIC_CORS_HEADERS });
      }
    }

    // ── Re-run availability check (server-side guard) ─────────────────────
    const finalCheck = await checkBarberAvailableForBooking(resolvedEmpId!, resolvedEmpName!, slotDt, serviceIds);
    if (!finalCheck.available) {
      return NextResponse.json({
        ok:           false,
        error:        finalCheck.reason ?? 'الحلاق غير متاح في هذا الوقت',
        conflictType: finalCheck.conflictType,
        nextAvailable: finalCheck.suggestedStartTime,
      }, { status: 409, headers: PUBLIC_CORS_HEADERS });
    }

    // ── Compute end time ──────────────────────────────────────────────────
    const defaultDur  = await getDefaultDuration(db);
    const customerDur = await getServicesDuration(db, serviceIds, defaultDur);
    const endDt       = new Date(slotDt.getTime() + customerDur * 60_000);
    const startTimeStr = time + ':00';
    const endTimeStr   = `${String(endDt.getHours()).padStart(2,'0')}:${String(endDt.getMinutes()).padStart(2,'0')}:00`;

    // ── Upsert customer ───────────────────────────────────────────────────
    const clientId = await upsertCustomer(customer.name, customer.phone);

    // ── Generate unique booking code ──────────────────────────────────────
    let bookingCode = generateBookingCode();
    // Check uniqueness — retry up to 3 times
    for (let attempt = 0; attempt < 3; attempt++) {
      const exists = await db.request().query(
        `SELECT 1 FROM [dbo].[Bookings] WHERE BookingCode = N'${bookingCode}'`
      ).catch(() => ({ recordset: [] }));
      if (!exists.recordset.length) break;
      bookingCode = generateBookingCode();
    }

    // ── Insert booking ────────────────────────────────────────────────────
    // BookingCode column may or may not exist — try with it, fall back without
    let bookingId: number;

    try {
      const ins = await db.request()
        .input('clientId',  sql.Int,      clientId)
        .input('empId',     sql.Int,      resolvedEmpId!)
        .input('bDate',     sql.Date,     date)
        .input('sTime',     sql.VarChar,  startTimeStr)
        .input('eTime',     sql.VarChar,  endTimeStr)
        .input('source',    sql.NVarChar, 'online')
        .input('notes',     sql.NVarChar, notes?.trim() || null)
        .input('code',      sql.NVarChar, bookingCode)
        .query(`
          INSERT INTO [dbo].[Bookings]
            (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
             Status, Source, Notes, BookingCode, CreatedByUserID)
          OUTPUT INSERTED.BookingID
          VALUES
            (@clientId, @empId, @bDate, @sTime, @eTime,
             'confirmed', @source, @notes, @code, 0)
        `);
      bookingId = ins.recordset[0].BookingID;
    } catch {
      // Fallback: BookingCode column may not exist
      const ins = await db.request()
        .input('clientId',  sql.Int,      clientId)
        .input('empId',     sql.Int,      resolvedEmpId!)
        .input('bDate',     sql.Date,     date)
        .input('sTime',     sql.VarChar,  startTimeStr)
        .input('eTime',     sql.VarChar,  endTimeStr)
        .input('source',    sql.NVarChar, 'online')
        .input('notes',     sql.NVarChar, notes?.trim() || null)
        .query(`
          INSERT INTO [dbo].[Bookings]
            (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
             Status, Source, Notes, CreatedByUserID)
          OUTPUT INSERTED.BookingID
          VALUES
            (@clientId, @empId, @bDate, @sTime, @eTime,
             'confirmed', @source, @notes, 0)
        `);
      bookingId = ins.recordset[0].BookingID;
    }

    // ── Insert booking services ───────────────────────────────────────────
    if (serviceIds.length > 0) {
      const svcRes = await db.request().query(`
        SELECT ProID, ProName, SPrice1,
               ISNULL(DurationMinutes, ${defaultDur}) AS DurationMinutes
        FROM [dbo].[TblPro]
        WHERE ProID IN (${serviceIds.join(',')})
      `).catch(() => ({ recordset: [] as any[] }));

      for (const svc of svcRes.recordset) {
        await db.request()
          .input('bId',   sql.Int,     bookingId)
          .input('proId', sql.Int,     svc.ProID)
          .input('eId',   sql.Int,     resolvedEmpId!)
          .input('qty',   sql.Decimal, 1)
          .input('price', sql.Decimal, svc.SPrice1 || 0)
          .input('mins',  sql.Int,     svc.DurationMinutes)
          .query(`
            INSERT INTO [dbo].[BookingServices]
              (BookingID, ProID, EmpID, Qty, Price, DurationMinutes)
            VALUES (@bId, @proId, @eId, @qty, @price, @mins)
          `).catch(() => {});
      }
    }

    // Build services summary text
    const svcNames: string[] = [];
    if (serviceIds.length > 0) {
      const svcRes2 = await db.request().query(
        `SELECT ProName FROM [dbo].[TblPro] WHERE ProID IN (${serviceIds.join(',')})`
      ).catch(() => ({ recordset: [] as any[] }));
      svcNames.push(...svcRes2.recordset.map((r: any) => r.ProName));
    }
    const servicesText = svcNames.join(', ') || 'خدمة عامة';

    console.log('[public/booking/create] created', { bookingId, bookingCode, clientId, empId: resolvedEmpId });

    return NextResponse.json({
      ok: true,
      booking: {
        id:            bookingId,
        code:          bookingCode,
        status:        'confirmed',
        customerName:  customer.name,
        customerPhone: customer.phone,
        barberName:    resolvedEmpName!,
        servicesText,
        date,
        startTime:     time,
        endTime:       endTimeStr.slice(0, 5),
      },
      message: 'تم تأكيد الحجز بنجاح',
    }, { status: 201, headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/create]', err);
    return NextResponse.json({ error: 'فشل إنشاء الحجز' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}
