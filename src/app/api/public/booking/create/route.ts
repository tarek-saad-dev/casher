import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  isValidTime,
  isValidPhone,
  isUsableCustomerPhone,
  generateBookingCode,
  upsertCustomer,
  PUBLIC_CORS_HEADERS,
  salonDateTimeToMs,
} from "@/lib/publicBookingHelpers";
import { buildSequentialServicePlanFromLines, ServicePlanError, calculateServicePlanDuration } from '@/lib/servicePlan';
import {
  validateBookingSlot,
  BOOKING_SLOT_REASON_AR,
  type BookingSlotReasonCode,
} from '@/lib/bookingAvailabilityEngine';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { scheduleBookingWhatsAppAfterCommit } from '@/lib/bookingPostCommitNotification';
import { createDevTimer } from '@/lib/devRequestTiming';
import {
  assertEmployeeIntervalAvailable,
  findNextAvailableForEmployee,
  ScheduleConflictError,
  lastScheduleLockMs,
} from '@/lib/scheduleIntegrity';
import { requireActiveBranchContext, isActiveBranchContext } from '@/lib/branch/context';
import {
  extractPublicBranchCode,
  resolvePublicBranchCode,
  publicBranchRequiredResponse,
  publicInvalidBranchResponse,
} from '@/lib/branch/bookingQueueOwnership';
import { BranchDomainError } from '@/lib/branch/types';

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
  const timer = createDevTimer('booking_create');
  const ip = getRateLimitKey(req);
  // Stricter rate limit for create: 10 per minute per IP
  if (!checkRateLimit(ip, 10)) {
    return NextResponse.json(
      { error: "طلبات كثيرة — حاول لاحقاً" },
      { status: 429, headers: PUBLIC_CORS_HEADERS },
    );
  }
  timer.mark('authMs'); // public route: rate-limit + CORS only (no session)

  try {
    const body = await req.json();
    timer.mark('parseMs');
    const {
      customer,
      serviceIds = [],
      mode = "nearest",
      empId,
      date,
      time,
      dayOffset = 0,
      notes = "",
      source = "public",
    } = body as {
      customer: { name: string; phone?: string | null };
      serviceIds?: number[];
      mode?: "nearest" | "specific";
      empId?: number;
      date: string;
      time: string;
      dayOffset?: 0 | 1;
      notes?: string;
      source?: "public" | "operations" | "admin";
    };

    // Determine source early — ops/admin allow walk-in without phone
    const isInternalSource = source === "operations" || source === "admin";
    const customerPhone = (customer?.phone ?? "").trim();

    // ── Validation ───────────────────────────────────────────────────────────
    if (!customer?.name || customer.name.trim().length < 2) {
      return NextResponse.json(
        { error: "الاسم مطلوب (حرفان على الأقل)" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }
    if (!customerPhone) {
      if (!isInternalSource) {
        return NextResponse.json(
          { error: "رقم الهاتف مطلوب" },
          { status: 400, headers: PUBLIC_CORS_HEADERS },
        );
      }
    } else if (!isValidPhone(customerPhone)) {
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

    // ── Resolve branch: internal callers use the authenticated session branch;
    // public callers must supply branchCode (never a silent default). ────────
    let branchId: number;
    let branchName: string | undefined;
    if (isInternalSource) {
      const branchCtx = await requireActiveBranchContext();
      if (!isActiveBranchContext(branchCtx)) return branchCtx;
      branchId = branchCtx.branchId;
      branchName = branchCtx.branchName;
    } else {
      const { searchParams } = new URL(req.url);
      const branchCode = extractPublicBranchCode(searchParams, body);
      try {
        const branch = await resolvePublicBranchCode(branchCode);
        branchId = branch.branchId;
        branchName = branch.branchName;
      } catch (err) {
        if (err instanceof BranchDomainError) {
          return err.code === 'BRANCH_REQUIRED'
            ? publicBranchRequiredResponse()
            : publicInvalidBranchResponse();
        }
        throw err;
      }
    }

    const settings = await getPublicSettings(branchId);
    // Only check bookingEnabled for public bookings, skip for operations/admin
    if (!isInternalSource && !settings.bookingEnabled) {
      return NextResponse.json(
        { error: "الحجز الإلكتروني غير متاح حالياً" },
        { status: 503, headers: PUBLIC_CORS_HEADERS },
      );
    }

    // Use salon timezone-aware epoch calculation to avoid server TZ mismatches
    const timezone = settings.timezone || "Africa/Cairo";
    const actualDate = dayOffset === 1 ? nextDate(date) : date;
    const slotEpochMs = salonDateTimeToMs(actualDate, time, timezone);
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
    timer.mark('validationMs');

    const db = await getPool();
    timer.mark('poolMs');

    if (!serviceIds.length) {
      return NextResponse.json(
        { error: 'يجب اختيار خدمة واحدة على الأقل' },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    // Load services — specific mode uses assigned emp overrides immediately.
    let resolvedServices;
    try {
      resolvedServices = await calculateServicePlanDuration(serviceIds, {
        empId: mode === 'specific' && empId ? empId : null,
      });
    } catch (planErr) {
      if (planErr instanceof ServicePlanError) {
        return NextResponse.json(
          { ok: false, code: planErr.code, message: planErr.message },
          { status: planErr.status, headers: PUBLIC_CORS_HEADERS },
        );
      }
      return NextResponse.json(
        { error: planErr instanceof Error ? planErr.message : 'خطأ في خطة الخدمات' },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }
    timer.mark('servicePlanMs');

    // ── Canonical plan validation ────────────────────────────────────────────
    const validation = await validateBookingSlot({
      date,
      time,
      dayOffset,
      serviceIds,
      mode,
      empId,
      source,
      servicePlan: resolvedServices,
      // Let the engine apply per-barber duration overrides (do not force catalog sum)
      skipNextAvailableWhenOk: true,
      branchId,
    });
    timer.mark('availabilityMs');

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

    // Insert lines always use the assigned barber's duration overrides
    let insertServices = resolvedServices;
    if (resolvedEmpId && resolvedServices.empId !== resolvedEmpId) {
      try {
        insertServices = await calculateServicePlanDuration(serviceIds, {
          empId: resolvedEmpId,
        });
      } catch {
        insertServices = resolvedServices;
      }
    }

    const servicePlan = buildSequentialServicePlanFromLines({
      lines: insertServices.services,
      startAt: slotDt,
      empId: resolvedEmpId!,
    });

    const customerDur = servicePlan.totalDurationMinutes;
    if (validation.plan.durationMinutes !== customerDur) {
      return NextResponse.json(
        {
          ok: false,
          code: 'DURATION_MISMATCH',
          error: `مدة الموعد (${validation.plan.durationMinutes} د) لا تطابق الخدمات المختارة (${customerDur} د)`,
        },
        { status: 409, headers: PUBLIC_CORS_HEADERS },
      );
    }

    const endEpochMs = new Date(servicePlan.endAt).getTime();
    const startTimeStr = time + ':00';
    const endTimeStr = `${formatCairoHhmm(endEpochMs, timezone)}:00`;

    // ── Upsert customer ───────────────────────────────────────────────────
    const clientId = await upsertCustomer(customer.name, customerPhone);
    timer.mark('customerMs');

    // ── Transactional conflict guard before insert ────────────────────────
    const transaction = new sql.Transaction(db);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    timer.mark('transactionBeginMs');

    try {
      const guardStart = Date.now();
      await assertEmployeeIntervalAvailable({
        empId: resolvedEmpId!,
        startAt: slotDt,
        endAt: new Date(endEpochMs),
        operationalDate: getCairoBusinessDate(slotDt),
        transaction,
      });
      timer.setAbsolute('transactionalGuardMs', Date.now() - guardStart);
      timer.setAbsolute('scheduleLockMs', lastScheduleLockMs);
    } catch (err) {
      await transaction.rollback();
      if (err instanceof ScheduleConflictError) {
        const nextAvailable = await findNextAvailableForEmployee({
          empId: resolvedEmpId!,
          operationalDate: getCairoBusinessDate(slotDt),
          candidateStart: slotDt,
          durationMinutes: customerDur,
        });
        timer.log('[booking/create perf]', { outcome: 'conflict_409' });
        return NextResponse.json(
          {
            ok: false,
            code: 'SCHEDULE_CONFLICT',
            message: err.message || 'الوقت المختار لم يعد متاحًا',
            conflict: err.conflict,
            nextAvailable,
          },
          {
            status: 409,
            headers: {
              ...PUBLIC_CORS_HEADERS,
              ...(timer.serverTimingHeader()
                ? { 'Server-Timing': timer.serverTimingHeader() }
                : {}),
            },
          },
        );
      }
      throw err;
    }

    // ── Insert booking (booking code unique constraint is final guarantee) ─
    let bookingCode = generateBookingCode();
    let bookingId: number;

    try {
      const insStart = Date.now();
      const bookingsHasBranchId = await hasColumn(transaction, 'Bookings', 'BranchID');
      let ins: { recordset: any[] } | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const insReq = transaction
            .request()
            .input("clientId", sql.Int, clientId)
            .input("empId", sql.Int, resolvedEmpId!)
            .input("bDate", sql.Date, actualDate)
            .input("sTime", sql.VarChar, startTimeStr)
            .input("eTime", sql.VarChar, endTimeStr)
            .input("source", sql.NVarChar, isInternalSource ? source : "online")
            .input("notes", sql.NVarChar, notes?.trim() || null)
            .input("code", sql.NVarChar, bookingCode);
          if (bookingsHasBranchId) insReq.input("branchId", sql.Int, branchId);
          ins = await insReq.query(`
              INSERT INTO [dbo].[Bookings]
                (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
                 Status, Source, Notes, BookingCode, CreatedByUserID${bookingsHasBranchId ? ", BranchID" : ""})
              OUTPUT INSERTED.BookingID, INSERTED.BookingDate, INSERTED.StartTime, INSERTED.EndTime, INSERTED.Status
              VALUES
                (@clientId, @empId, @bDate, @sTime, @eTime,
                 'confirmed', @source, @notes, @code, 0${bookingsHasBranchId ? ", @branchId" : ""})
            `);
          break;
        } catch (codeErr: any) {
          const msg = String(codeErr?.message ?? '');
          const isDup =
            msg.includes('BookingCode') ||
            msg.includes('UNIQUE') ||
            msg.includes('duplicate') ||
            codeErr?.number === 2627 ||
            codeErr?.number === 2601;
          if (!isDup || attempt === 2) throw codeErr;
          bookingCode = generateBookingCode();
        }
      }
      if (!ins?.recordset?.[0]) {
        throw new Error('Booking insert returned no row');
      }
      bookingId = ins.recordset[0].BookingID as number;
      timer.setAbsolute('bookingInsertMs', Date.now() - insStart);

      const svcInsStart = Date.now();
      if (serviceIds.length > 0) {
        for (const line of servicePlan.lines) {
          await transaction
            .request()
            .input('bId', sql.Int, bookingId)
            .input('proId', sql.Int, line.serviceId)
            .input('eId', sql.Int, resolvedEmpId!)
            .input('qty', sql.Decimal, 1)
            .input('price', sql.Decimal, line.price)
            .input('mins', sql.Int, line.durationMinutes)
            .query(`
              INSERT INTO [dbo].[BookingServices]
                (BookingID, ProID, EmpID, Qty, Price, DurationMinutes)
              VALUES (@bId, @proId, @eId, @qty, @price, @mins)
            `);
        }
      }
      timer.setAbsolute('serviceInsertMs', Date.now() - svcInsStart);

      const commitStart = Date.now();
      await transaction.commit();
      timer.setAbsolute('commitMs', Date.now() - commitStart);

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

    // ── Post-commit: build response + schedule WhatsApp after HTTP 201 ────
    const svcNames = insertServices.services.map((s) => s.serviceName).filter(Boolean);
    const servicesText = svcNames.join(", ") || "خدمة عامة";

    if (process.env.NODE_ENV !== "production") {
      console.log("[public/booking/create] created", {
        bookingId,
        bookingCode,
        clientId,
        empId: resolvedEmpId,
      });
      console.log('[booking/create] transaction committed', { bookingId });
    }

    // Schedule WhatsApp after the response — must not block HTTP 201.
    // Skip when ops walk-in has no real phone (avoids messaging smoke-test placeholders).
    if (isUsableCustomerPhone(customerPhone)) {
      const schedStart = Date.now();
      scheduleBookingWhatsAppAfterCommit({
        phone: customerPhone,
        customerName: customer.name,
        bookingId,
        bookingDate: actualDate,
        bookingTime: time,
        barberName: resolvedEmpName || undefined,
        services: svcNames.length > 0 ? svcNames : undefined,
        branchName,
      });
      timer.setAbsolute('notificationSchedulingMs', Date.now() - schedStart);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[booking/create] post-response notification scheduled', {
          bookingId,
          notificationSchedulingMs: timer.snapshot().notificationSchedulingMs,
        });
      }
    } else if (process.env.NODE_ENV !== 'production') {
      console.log('[booking/create] WhatsApp skipped — no usable customer phone', {
        bookingId,
      });
    }

    const respStart = Date.now();
    const headers: Record<string, string> = { ...PUBLIC_CORS_HEADERS };
    timer.setAbsolute('responseBuildMs', Date.now() - respStart);
    const st = timer.serverTimingHeader();
    if (st) headers['Server-Timing'] = st;
    timer.log('[booking/create perf]', {
      outcome: '201',
      source: isInternalSource ? source : 'online',
      empId: resolvedEmpId,
      bookingId,
      whatsappAwaitInResponse: false,
    });
    if (process.env.NODE_ENV !== 'production') {
      console.log('[booking/create] HTTP response returned', {
        bookingId,
        totalMs: timer.totalMs(),
      });
    }

    return NextResponse.json(
      {
        ok: true,
        booking: {
          id: bookingId,
          code: bookingCode,
          status: "confirmed",
          customerName: customer.name,
          customerPhone: customerPhone || null,
          barberName: resolvedEmpName!,
          servicesText,
          date,
          actualDate,
          startTime: time,
          endTime: endTimeStr.slice(0, 5),
        },
        message: "تم تأكيد الحجز بنجاح",
        whatsapp: {
          sent: false,
          skipped: false,
          scheduled: true,
          reason: 'post_response',
        },
      },
      { status: 201, headers },
    );
  } catch (err) {
    console.error("[public/booking/create]", err);
    timer.log('[booking/create perf]', { outcome: '500' });
    return NextResponse.json(
      { error: "فشل إنشاء الحجز" },
      { status: 500, headers: PUBLIC_CORS_HEADERS },
    );
  }
}

async function hasColumn(
  transaction: sql.Transaction,
  table: string,
  column: string,
): Promise<boolean> {
  const res = await new sql.Request(transaction)
    .query(`SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`)
    .catch(() => ({ recordset: [] as any[] }));
  return res.recordset.length > 0;
}

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
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
