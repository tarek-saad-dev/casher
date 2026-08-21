import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { checkBarberAvailableForBooking } from "@/lib/queueEstimateEngine";
import { normalizeBookingTimes } from "@/lib/bookingDateTime";
import { requireActiveBranchContext, isActiveBranchContext } from "@/lib/branch/context";
import { isEmployeeEligibleForBranchBookings } from "@/lib/branch/bookingQueueOwnership";
import { getPublicSettings } from "@/lib/publicBookingHelpers";
import {
  isLegacyBookingsCreateEnabled,
  isCanonicalCreateEligibleShape,
  logLegacyBookingCreate,
  legacyBookingCreateDisabledBody,
} from "@/lib/availability/legacyBookingCreateFence";

export const runtime = "nodejs";

// GET /api/bookings?date=&dateFrom=&dateTo=&empId=&status=&source=&clientSearch=
export async function GET(req: NextRequest) {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const { searchParams } = new URL(req.url);
    const date       = searchParams.get("date");
    const dateFrom   = searchParams.get("dateFrom");
    const dateTo     = searchParams.get("dateTo");
    const empId      = searchParams.get("empId");
    const status     = searchParams.get("status");
    const source     = searchParams.get("source");
    const clientSrch = searchParams.get("clientSearch");

    const db = await getPool();
    const request = db.request();
    const conditions: string[] = ["b.BranchID = @branchId"];
    request.input("branchId", sql.Int, branch.branchId);

    if (date) {
      request.input("date", sql.Date, date);
      conditions.push("b.BookingDate = @date");
    } else {
      if (dateFrom) { request.input("df", sql.Date, dateFrom); conditions.push("b.BookingDate >= @df"); }
      if (dateTo)   { request.input("dt", sql.Date, dateTo);   conditions.push("b.BookingDate <= @dt"); }
    }
    if (empId)  { request.input("empId",  sql.Int,     parseInt(empId));  conditions.push("b.AssignedEmpID = @empId");  }
    if (status && status !== "all") { request.input("status", sql.NVarChar, status); conditions.push("b.Status = @status"); }
    if (source && source !== "all") { request.input("source", sql.NVarChar, source); conditions.push("b.Source = @source"); }
    if (clientSrch) {
      request.input("srch", sql.NVarChar, `%${clientSrch}%`);
      conditions.push("(c.[Name] LIKE @srch OR c.Mobile LIKE @srch)");
    }

    const where = `WHERE ${conditions.join(" AND ")}`;

    const result = await request.query(`
      SELECT
        b.BookingID, b.BookingCode, b.ClientID, b.AssignedEmpID, b.BookingDate,
        b.StartTime, b.EndTime, b.Status, b.Source, b.Notes,
        b.QueueTicketID, b.OldInvID, b.OldInvType,
        b.ConvertedInvID, b.ConvertedInvType,
        b.CreatedAt, b.UpdatedAt, b.CancelledAt, b.CancelReason,
        c.[Name] AS ClientName, c.Mobile AS ClientMobile,
        e.EmpName,
        (SELECT COUNT(*)
         FROM [dbo].[BookingServices] bs
         WHERE bs.BookingID = b.BookingID) AS ServiceCount,
        (SELECT STRING_AGG(p.ProName, ', ')
         FROM [dbo].[BookingServices] bs2
         LEFT JOIN [dbo].[TblPro] p ON p.ProID = bs2.ProID
         WHERE bs2.BookingID = b.BookingID) AS ServiceNames,
        (SELECT ISNULL(SUM(bs3.Price * bs3.Qty), 0)
         FROM [dbo].[BookingServices] bs3
         WHERE bs3.BookingID = b.BookingID) AS TotalPrice,
        (SELECT ISNULL(SUM(bs4.DurationMinutes), 0)
         FROM [dbo].[BookingServices] bs4
         WHERE bs4.BookingID = b.BookingID) AS TotalDuration
      FROM [dbo].[Bookings] b
      LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
      LEFT JOIN [dbo].[TblEmp]    e ON e.EmpID    = b.AssignedEmpID
      ${where}
      ORDER BY b.BookingDate ASC, b.StartTime ASC
    `);

    // Normalize times for each booking
    const enrichedBookings = result.recordset.map((booking: any) => {
      const totalDuration = booking.TotalDuration || 30;
      const normalized = normalizeBookingTimes(
        booking.BookingDate,
        booking.StartTime,
        booking.EndTime,
        totalDuration,
        booking.BookingID
      );

      return {
        ...booking,
        startDateTimeCairo: normalized.startDateTimeCairo,
        endDateTimeCairo: normalized.endDateTimeCairo,
        startTimeDisplay: normalized.startTimeDisplay,
        endTimeDisplay: normalized.endTimeDisplay,
        dateDisplay: normalized.dateDisplay,
        durationMinutes: normalized.durationMinutes,
      };
    });

    return NextResponse.json({ bookings: enrichedBookings });
  } catch (err) {
    console.error("[bookings GET]", err);
    return NextResponse.json({ error: "فشل تحميل الحجوزات" }, { status: 500 });
  }
}

/**
 * @deprecated LEGACY booking create — non-transactional insert path.
 * Prefer POST /api/public/booking/create (source=operations|admin) which uses
 * createPublicBooking + SERIALIZABLE scheduleIntegrity.
 * Phase 0 fence: LEGACY_BOOKINGS_CREATE_ENABLED (default true).
 */
// POST /api/bookings
export async function POST(req: NextRequest) {
  const requestId =
    req.headers.get('x-request-id') ??
    req.headers.get('x-correlation-id') ??
    null;
  const callerSource =
    req.headers.get('x-booking-source') ??
    req.headers.get('referer') ??
    null;

  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const session = await getSession();
    const userID = session?.UserID ?? 0;
    const body = await req.json();

    const {
      clientId, empId, bookingDate, startTime, endTime,
      source = "phone", notes, services = [],
    } = body;

    const canonicalCreateEligible = isCanonicalCreateEligibleShape({
      empId,
      bookingDate,
      startTime,
      services,
    });

    if (!isLegacyBookingsCreateEnabled()) {
      logLegacyBookingCreate({
        path: '/api/bookings',
        callerSource,
        branchId: branch.branchId,
        empId: empId != null ? Number(empId) : null,
        bookingDate: bookingDate ?? null,
        startTime: startTime ?? null,
        userId: userID || null,
        requestId,
        outcome: 'blocked',
        errorCode: 'LEGACY_BOOKING_CREATE_DISABLED',
        canonicalCreateEligible,
      });
      return NextResponse.json(legacyBookingCreateDisabledBody(), { status: 410 });
    }

    logLegacyBookingCreate({
      path: '/api/bookings',
      callerSource,
      branchId: branch.branchId,
      empId: empId != null ? Number(empId) : null,
      bookingDate: bookingDate ?? null,
      startTime: startTime ?? null,
      userId: userID || null,
      requestId,
      outcome: 'allowed',
      canonicalCreateEligible,
    });

    if (!bookingDate || !startTime)
      return NextResponse.json({ error: "التاريخ والوقت مطلوبان" }, { status: 400 });

    const db = await getPool();

    // Employee must be eligible to receive bookings at the active branch.
    if (empId) {
      const eligible = await isEmployeeEligibleForBranchBookings({
        empId,
        branchId: branch.branchId,
        operationalDate: bookingDate,
      });
      if (!eligible) {
        logLegacyBookingCreate({
          path: '/api/bookings',
          callerSource,
          branchId: branch.branchId,
          empId: Number(empId),
          bookingDate,
          startTime,
          userId: userID || null,
          requestId,
          outcome: 'failure',
          errorCode: 'EMPLOYEE_NOT_ELIGIBLE',
          canonicalCreateEligible,
        });
        return NextResponse.json(
          { error: "الموظف غير متاح للحجز في هذا الفرع" },
          { status: 409 },
        );
      }
    }

    // ── Server-side availability check using shared timeline engine ─────────
    // Validates both booking conflicts AND queue ticket conflicts
    if (empId && bookingDate && startTime) {
      const bookingStart = new Date(`${bookingDate}T${startTime}`);
      const serviceIds: number[] = (services as Array<{ proId?: number }>)
        .map(s => s.proId).filter((id): id is number => !!id);
      const availCheck = await checkBarberAvailableForBooking(empId, '', bookingStart, serviceIds);
      if (!availCheck.available) {
        logLegacyBookingCreate({
          path: '/api/bookings',
          callerSource,
          branchId: branch.branchId,
          empId: Number(empId),
          bookingDate,
          startTime,
          userId: userID || null,
          requestId,
          outcome: 'failure',
          errorCode: 'AVAILABILITY_CONFLICT',
          canonicalCreateEligible,
        });
        return NextResponse.json({
          error:               availCheck.reason ?? 'الحلاق غير متاح في هذا الوقت',
          conflictType:        availCheck.conflictType,
          suggestedStartTime:  availCheck.suggestedStartTime,
          conflictingTickets:  availCheck.conflictingTickets,
          conflictingBookings: availCheck.conflictingBookings,
        }, { status: 409 });
      }
    }

    // Branch-scoped settings (cached) — used below for default service duration fallback.
    const settings = await getPublicSettings(branch.branchId);

    // Check double booking setting (legacy — kept for settings that allow double booking)
    const settingsRes = await db.request()
      .input("branchId", sql.Int, branch.branchId)
      .query(
        `SELECT TOP 1 AllowDoubleBooking FROM [dbo].[QueueBookingSettings] WHERE BranchID = @branchId`
      );
    const allowDouble = settingsRes.recordset[0]?.AllowDoubleBooking ?? 0;

    if (!allowDouble && empId && endTime) {
      const conflict = await db.request()
        .input("empId",  sql.Int,     empId)
        .input("bDate",  sql.Date,    bookingDate)
        .input("sTime",  sql.VarChar, startTime)
        .input("eTime",  sql.VarChar, endTime)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM [dbo].[Bookings]
          WHERE AssignedEmpID = @empId
            AND BookingDate   = @bDate
            AND Status NOT IN ('cancelled', 'no_show', 'rescheduled')
            AND StartTime < @eTime
            AND ISNULL(EndTime, @sTime) > @sTime
        `);
      if (conflict.recordset[0].cnt > 0) {
        logLegacyBookingCreate({
          path: '/api/bookings',
          callerSource,
          branchId: branch.branchId,
          empId: Number(empId),
          bookingDate,
          startTime,
          userId: userID || null,
          requestId,
          outcome: 'failure',
          errorCode: 'DOUBLE_BOOKING',
          canonicalCreateEligible,
        });
        return NextResponse.json({ error: "يوجد حجز متعارض لهذا الحلاق في نفس الوقت" }, { status: 409 });
      }
    }

    // Insert booking — BranchID always stamped from the active session, never client input.
    // @deprecated legacy non-TX insert — migrate callers to createPublicBooking.
    const insertRes = await db.request()
      .input("clientId",  sql.Int,      clientId || null)
      .input("empId",     sql.Int,      empId    || null)
      .input("bDate",     sql.Date,     bookingDate)
      .input("sTime",     sql.VarChar,  startTime)
      .input("eTime",     sql.VarChar,  endTime   || null)
      .input("source",    sql.NVarChar, source)
      .input("notes",     sql.NVarChar, notes     || null)
      .input("userID",    sql.Int,      userID)
      .input("branchId",  sql.Int,      branch.branchId)
      .query(`
        INSERT INTO [dbo].[Bookings]
          (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
           Status, Source, Notes, CreatedByUserID, BranchID)
        OUTPUT INSERTED.BookingID
        VALUES
          (@clientId, @empId, @bDate, @sTime, @eTime,
           'pending', @source, @notes, @userID, @branchId)
      `);

    const bookingId = insertRes.recordset[0].BookingID;

    // Insert services
    for (const svc of services) {
      await db.request()
        .input("bId",    sql.Int,         bookingId)
        .input("proId",  sql.Int,         svc.proId  || null)
        .input("eId",    sql.Int,         svc.empId  || empId || null)
        .input("qty",    sql.Decimal,     svc.qty    || 1)
        .input("price",  sql.Decimal,     svc.price  || 0)
        .input("mins",   sql.Int,         svc.durationMinutes || settings.defaultServiceDurationMinutes || null)
        .input("notes",  sql.NVarChar,    svc.notes  || null)
        .query(`
          INSERT INTO [dbo].[BookingServices]
            (BookingID, ProID, EmpID, Qty, Price, DurationMinutes, Notes)
          VALUES (@bId, @proId, @eId, @qty, @price, @mins, @notes)
        `);
    }

    logLegacyBookingCreate({
      path: '/api/bookings',
      callerSource,
      branchId: branch.branchId,
      empId: empId != null ? Number(empId) : null,
      bookingDate,
      startTime,
      userId: userID || null,
      requestId,
      outcome: 'success',
      canonicalCreateEligible,
    });

    if (empId != null && bookingDate) {
      try {
        const { AvailabilityMutationNotifier } = await import(
          '@/lib/booking/AvailabilityMutationNotifier'
        );
        await AvailabilityMutationNotifier.bookingOccupancyChanged({
          employeeId: Number(empId),
          businessDate: String(bookingDate).slice(0, 10),
          branchId: branch.branchId,
          reason: 'legacy_bookings_create',
        });
      } catch {
        /* best-effort */
      }
    }

    return NextResponse.json({ bookingId }, { status: 201 });
  } catch (err) {
    console.error("[legacy-booking-create] POST failure", err);
    logLegacyBookingCreate({
      path: '/api/bookings',
      callerSource,
      branchId: null,
      empId: null,
      bookingDate: null,
      startTime: null,
      userId: null,
      requestId,
      outcome: 'failure',
      errorCode: 'UNHANDLED',
      canonicalCreateEligible: false,
    });
    return NextResponse.json({ error: "فشل إنشاء الحجز" }, { status: 500 });
  }
}
