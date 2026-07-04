import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
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
  salonDateTimeToMs,
} from "@/lib/publicBookingHelpers";
import {
  getDefaultDuration,
  getServicesDuration,
} from '@/lib/queueEstimateEngine';
import {
  validateBookingSlot,
  BOOKING_SLOT_REASON_AR,
  type BookingSlotReasonCode,
} from '@/lib/bookingAvailabilityEngine';
import {
  assertEmployeeIntervalAvailable,
  ScheduleConflictError,
} from '@/lib/scheduleIntegrity';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { sendBookingWhatsAppMessage } from '@/lib/integrations/whatsapp';

export const runtime = "nodejs";

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
    return NextResponse.json(
      { error: "طلبات كثيرة — حاول لاحقاً" },
      { status: 429, headers: PUBLIC_CORS_HEADERS },
    );
  }

  try {
    const body = await req.json();
    const {
      customer,
      serviceIds = [],
      mode = "nearest",
      empId,
      date,
      time,
      notes = "",
      source = "public",
    } = body as {
      customer: { name: string; phone: string };
      serviceIds?: number[];
      mode?: "nearest" | "specific";
      empId?: number;
      date: string;
      time: string;
      notes?: string;
      source?: "public" | "operations" | "admin";
    };

    // ── Validation ───────────────────────────────────────────────────────────
    if (!customer?.name || customer.name.trim().length < 2) {
      return NextResponse.json(
        { error: "الاسم مطلوب (حرفان على الأقل)" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }
    if (!customer?.phone || !isValidPhone(customer.phone)) {
      return NextResponse.json(
        { error: "رقم الهاتف غير صالح" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }
    if (!date || !isValidDate(date)) {
      return NextResponse.json(
        { error: "التاريخ غير صالح" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }
    if (!time || !isValidTime(time)) {
      return NextResponse.json(
        { error: "الوقت غير صالح" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }
    if (mode === "specific" && !empId) {
      return NextResponse.json(
        { error: "empId مطلوب في وضع specific" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    // Determine source type early (needed for multiple checks)
    const isInternalSource = source === "operations" || source === "admin";

    const settings = await getPublicSettings();
    // Only check bookingEnabled for public bookings, skip for operations/admin
    if (!isInternalSource && !settings.bookingEnabled) {
      return NextResponse.json(
        { error: "الحجز الإلكتروني غير متاح حالياً" },
        { status: 503, headers: PUBLIC_CORS_HEADERS },
      );
    }

    // Use salon timezone-aware epoch calculation to avoid server TZ mismatches
    const timezone = settings.timezone || "Africa/Cairo";
    const slotEpochMs = salonDateTimeToMs(date, time, timezone);
    const slotDt = new Date(slotEpochMs);

    // Prevent bookings too soon (only for public bookings)
    // Operations/admin bookings can book immediately (skip minNotice)
    if (!isInternalSource) {
      const noticeMs = settings.minNoticeMinutes * 60_000;
      if (slotDt.getTime() - Date.now() < noticeMs) {
        return NextResponse.json(
          {
            error: `يجب الحجز قبل الموعد بـ ${settings.minNoticeMinutes} دقيقة على الأقل`,
          },
          { status: 400, headers: PUBLIC_CORS_HEADERS },
        );
      }
    }

    // Prevent bookings too far ahead
    const maxMs = settings.maxBookingDaysAhead * 86_400_000;
    if (slotDt.getTime() - Date.now() > maxMs) {
      return NextResponse.json(
        {
          error: `لا يمكن الحجز أكثر من ${settings.maxBookingDaysAhead} يوم مسبقاً`,
        },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    const db = await getPool();

    // ── Canonical plan validation ────────────────────────────────────────────
    // This is the single source of truth: it uses the same engine as available-slots
    // and returns the resolved barber, start/end, duration, and reason when unavailable.
    const validation = await validateBookingSlot({
      date,
      time,
      dayOffset: 0,
      serviceIds,
      mode,
      empId,
      source,
    });

    if (!validation.available || !validation.plan) {
      const reasonCode: BookingSlotReasonCode = validation.reasonCode ?? 'booking_conflict';
      return NextResponse.json(
        {
          ok: false,
          code: 'SCHEDULE_CONFLICT',
          error: validation.reasonMessage ?? BOOKING_SLOT_REASON_AR[reasonCode],
          message: validation.reasonMessage ?? BOOKING_SLOT_REASON_AR[reasonCode],
          reason: reasonCode,
          nextAvailable: validation.nextAvailable
            ? {
                startAt: validation.nextAvailable.startAt,
                endAt: validation.nextAvailable.endAt,
                empId: validation.nextAvailable.empId,
                empName: validation.nextAvailable.empName,
              }
            : null,
        },
        { status: 409, headers: PUBLIC_CORS_HEADERS },
      );
    }

    const resolvedEmpId = validation.plan.empId;
    const resolvedEmpName = validation.plan.empName;
    const endEpochMs = new Date(validation.plan.endAt).getTime();
    const startTimeStr = time + ':00';
    const endTimeStr = `${formatCairoHhmm(endEpochMs, timezone)}:00`;
    const defaultDur = await getDefaultDuration(db);
    const customerDur = await getServicesDuration(db, serviceIds, defaultDur);

    // ── Upsert customer ───────────────────────────────────────────────────
    const clientId = await upsertCustomer(customer.name, customer.phone);

    // ── Transactional conflict guard before insert ────────────────────────
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    try {
      await assertEmployeeIntervalAvailable({
        empId: resolvedEmpId!,
        startAt: slotDt,
        endAt: new Date(endEpochMs),
        operationalDate: getCairoBusinessDate(slotDt),
        transaction,
      });
    } catch (err) {
      await transaction.rollback();
      if (err instanceof ScheduleConflictError) {
        return NextResponse.json(
          {
            ok: false,
            code: 'SCHEDULE_CONFLICT',
            message: 'الوقت المختار لم يعد متاحًا',
            conflict: err.conflict,
          },
          { status: 409, headers: PUBLIC_CORS_HEADERS },
        );
      }
      throw err;
    }

    // ── Generate unique booking code ──────────────────────────────────────
    let bookingCode = generateBookingCode();
    // Check uniqueness — retry up to 3 times
    for (let attempt = 0; attempt < 3; attempt++) {
      const exists = await db
        .request()
        .query(
          `SELECT 1 FROM [dbo].[Bookings] WHERE BookingCode = N'${bookingCode}'`,
        )
        .catch(() => ({ recordset: [] }));
      if (!exists.recordset.length) break;
      bookingCode = generateBookingCode();
    }

    // ── Insert booking ────────────────────────────────────────────────────
    // BookingCode column MUST exist — fail if it doesn't
    let bookingId: number;

    try {
      const ins = await transaction
        .request()
        .input("clientId", sql.Int, clientId)
        .input("empId", sql.Int, resolvedEmpId!)
        .input("bDate", sql.Date, date)
        .input("sTime", sql.VarChar, startTimeStr)
        .input("eTime", sql.VarChar, endTimeStr)
        .input("source", sql.NVarChar, isInternalSource ? source : "online")
        .input("notes", sql.NVarChar, notes?.trim() || null)
        .input("code", sql.NVarChar, bookingCode).query(`
          INSERT INTO [dbo].[Bookings]
            (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
             Status, Source, Notes, BookingCode, CreatedByUserID)
          OUTPUT INSERTED.BookingID, INSERTED.BookingDate, INSERTED.StartTime, INSERTED.EndTime, INSERTED.Status
          VALUES
            (@clientId, @empId, @bDate, @sTime, @eTime,
             'confirmed', @source, @notes, @code, 0)
        `);
      bookingId = ins.recordset[0].BookingID as number;

      if (serviceIds.length > 0) {
        const svcRes = await transaction
          .request()
          .query(`
            SELECT ProID, ProName, SPrice1,
                   ISNULL(DurationMinutes, ${defaultDur}) AS DurationMinutes
            FROM [dbo].[TblPro]
            WHERE ProID IN (${serviceIds.join(",")})
          `);

        for (const svc of svcRes.recordset) {
          await transaction
            .request()
            .input("bId", sql.Int, bookingId)
            .input("proId", sql.Int, svc.ProID)
            .input("eId", sql.Int, resolvedEmpId!)
            .input("qty", sql.Decimal, 1)
            .input("price", sql.Decimal, svc.SPrice1 || 0)
            .input("mins", sql.Int, svc.DurationMinutes)
            .query(`
              INSERT INTO [dbo].[BookingServices]
                (BookingID, ProID, EmpID, Qty, Price, DurationMinutes)
              VALUES (@bId, @proId, @eId, @qty, @price, @mins)
            `);
        }
      }

      await transaction.commit();

      // Log inserted booking for debugging
      if (process.env.NODE_ENV !== "production") {
        console.log("[booking create] inserted booking:", {
          bookingId,
          bookingCode,
          assignedEmpId: resolvedEmpId,
          bookingDate: ins.recordset[0].BookingDate,
          startTime: ins.recordset[0].StartTime,
          endTime: ins.recordset[0].EndTime,
          status: ins.recordset[0].Status,
          durationMinutes: customerDur,
        });
      }
    } catch (err: any) {
      try {
        await transaction.rollback();
      } catch { /* ignore */ }
      // BookingCode column is missing or other critical error
      console.error("[public/booking/create] Insert failed:", err);
      const isMissingColumn =
        err?.message?.includes("BookingCode") ||
        err?.message?.includes("Invalid column");
      return NextResponse.json(
        {
          ok: false,
          error: isMissingColumn
            ? "BookingCode column is missing. Please run bookings migration before enabling public booking."
            : "فشل إنشاء الحجز — خطأ في قاعدة البيانات",
        },
        { status: 500, headers: PUBLIC_CORS_HEADERS },
      );
    }

    // ── WhatsApp booking confirmation (after commit) ──────────────────────
    const svcNames: string[] = [];
    if (serviceIds.length > 0) {
      const svcRes2 = await db
        .request()
        .query(
          `SELECT ProName FROM [dbo].[TblPro] WHERE ProID IN (${serviceIds.join(",")})`,
        )
        .catch(() => ({ recordset: [] as any[] }));
      svcNames.push(...svcRes2.recordset.map((r: any) => r.ProName));
    }
    const servicesText = svcNames.join(", ") || "خدمة عامة";

    if (process.env.NODE_ENV !== "production") {
      console.log("[public/booking/create] created", {
        bookingId,
        bookingCode,
        clientId,
        empId: resolvedEmpId,
      });
    }

    // ── WhatsApp booking confirmation (after commit) ──────────────────────────────────
    let whatsappResult: Record<string, unknown> = { sent: false, skipped: true, reason: 'development_only' };
    try {
      whatsappResult = await sendBookingWhatsAppMessage({
        phone: customer.phone,
        customerName: customer.name,
        bookingId,
        bookingDate: date,
        bookingTime: time,
        barberName: resolvedEmpName || undefined,
        services: svcNames.length > 0 ? svcNames : undefined,
      });
    } catch (waErr) {
      console.log(
        `[public/booking/create] WhatsApp error (non-critical): ${
          waErr instanceof Error ? waErr.message : String(waErr)
        }`,
      );
    }

    return NextResponse.json(
      {
        ok: true,
        booking: {
          id: bookingId,
          code: bookingCode,
          status: "confirmed",
          customerName: customer.name,
          customerPhone: customer.phone,
          barberName: resolvedEmpName!,
          servicesText,
          date,
          startTime: time,
          endTime: endTimeStr.slice(0, 5),
        },
        message: "تم تأكيد الحجز بنجاح",
        whatsapp: whatsappResult,
      },
      { status: 201, headers: PUBLIC_CORS_HEADERS },
    );
  } catch (err) {
    console.error("[public/booking/create]", err);
    return NextResponse.json(
      { error: "فشل إنشاء الحجز" },
      { status: 500, headers: PUBLIC_CORS_HEADERS },
    );
  }
}

function formatCairoHhmm(epochMs: number, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(epochMs));
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${h}:${m}`;
  } catch {
    const d = new Date(epochMs);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
}
