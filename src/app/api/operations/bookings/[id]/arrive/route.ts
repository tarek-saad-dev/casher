/**
 * POST /api/operations/bookings/[id]/arrive
 *
 * Handle booking arrival:
 * 1. Update Booking.Status = 'arrived' or 'queued'
 * 2. Create QueueTicket linked to BookingID
 * 3. PriorityType = reserved_booking
 * 4. Prevent duplicate QueueTicket for same BookingID
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  buildQueueIntervals,
  buildBookingIntervals,
  getDefaultDuration,
  findFirstFreeSlot,
  cairoDateStr,
} from "@/lib/queueEstimateEngine";

/**
 * SQL Server `time` columns arrive as Date objects anchored to 1970-01-01.
 * SQL Server `date` columns arrive as Date objects with time zeroed (UTC midnight).
 * This helper extracts HH:mm safely from either a Date (1970-based) or a string.
 */
function extractHHMM(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const h = String(value.getUTCHours()).padStart(2, '0');
    const m = String(value.getUTCMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  if (typeof value === 'string') {
    const match = value.match(/^(\d{1,2}):(\d{2})/);
    if (match) return `${match[1].padStart(2, '0')}:${match[2]}`;
  }
  console.warn('[arrive] extractHHMM: unknown value type', typeof value, value);
  return null;
}

/**
 * Build a proper local Date from a SQL `date` column value and a SQL `time` column value.
 * Combines the calendar date from dateValue with the HH:mm from timeValue.
 */
function buildDateTimeFromSqlDateAndTime(dateValue: unknown, timeValue: unknown): Date | null {
  // Extract YYYY-MM-DD from dateValue
  let dateStr: string | null = null;
  if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
    const y = dateValue.getUTCFullYear();
    const mo = String(dateValue.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateValue.getUTCDate()).padStart(2, '0');
    dateStr = `${y}-${mo}-${d}`;
  } else if (typeof dateValue === 'string') {
    const m = dateValue.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) dateStr = m[1];
  }
  if (!dateStr) return null;

  const hhmm = extractHHMM(timeValue);
  if (!hhmm) return null;

  const dt = new Date(`${dateStr}T${hhmm}:00.000Z`);
  return isNaN(dt.getTime()) ? null : dt;
}

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export interface BookingArriveRequest {
  notes?: string;
  priority?: number; // 0 = normal, 1 = high, 2 = manual priority
}

export interface BookingArriveResponse {
  ok: boolean;
  queueTicketId: number;
  ticketCode: string;
  estimatedStartTime: string | null;
  message: string;
}

export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "يجب تسجيل الدخول أولاً" },
        { status: 401 }
      );
    }

    const { id } = await params;
    const bookingId = parseInt(id);
    if (isNaN(bookingId)) {
      return NextResponse.json(
        { error: "معرف الحجز غير صالح" },
        { status: 400 }
      );
    }

    const body = (await req.json()) as BookingArriveRequest;
    const { notes, priority = 1 } = body; // Default priority 1 for reserved bookings

    const db = await getPool();

    // 1. Load booking details
    const bookingRes = await db
      .request()
      .input("bid", sql.Int, bookingId)
      .query(`
        SELECT
          b.BookingID,
          b.ClientID,
          b.AssignedEmpID,
          b.BookingDate,
          b.StartTime,
          b.EndTime,
          b.Status,
          b.Notes AS BookingNotes,
          c.Name AS ClientName,
          e.EmpName
        FROM [dbo].[Bookings] b
        LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
        LEFT JOIN [dbo].[TblEmp] e ON e.EmpID = b.AssignedEmpID
        WHERE b.BookingID = @bid
      `);

    if (!bookingRes.recordset.length) {
      return NextResponse.json(
        { error: "الحجز غير موجود" },
        { status: 404 }
      );
    }

    const booking = bookingRes.recordset[0];

    // 2. Validate booking status - must be confirmed or arrived
    const validStatuses = ["confirmed", "arrived", "queued"];
    if (!validStatuses.includes(booking.Status)) {
      return NextResponse.json(
        { error: `لا يمكن استقبال الحجز - الحالة الحالية "${booking.Status}" غير صالحة للاستقبال` },
        { status: 400 }
      );
    }

    // 3. Check if QueueTicket already exists for this booking
    const existingTicketRes = await db
      .request()
      .input("bid", sql.Int, bookingId)
      .query(`
        SELECT QueueTicketID, TicketCode, Status
        FROM [dbo].[QueueTickets]
        WHERE BookingID = @bid
          AND Status NOT IN ('cancelled', 'skipped', 'done')
      `);

    if (existingTicketRes.recordset.length > 0) {
      const existing = existingTicketRes.recordset[0];
      return NextResponse.json(
        {
          error: "تم استقبال صاحب الحجز مسبقاً",
          existingTicket: {
            queueTicketId: existing.QueueTicketID,
            ticketCode: existing.TicketCode,
            status: existing.Status,
          },
        },
        { status: 409 }
      );
    }

    const userID = session.UserID ?? 0;
    const now = new Date();
    const today = cairoDateStr(now);
    const createdTime = now.toLocaleTimeString("en-GB", {
      timeZone: "Africa/Cairo",
      hour12: false,
    });

    // 4. Load queue settings for ticket code generation
    let prefix = "A";
    let startNumber = 1;
    try {
      const settRes = await db.request().query(`
        SELECT TOP 1 QueuePrefix, QueueStartNumber
        FROM [dbo].[QueueBookingSettings]
      `);
      if (settRes.recordset.length) {
        prefix = settRes.recordset[0].QueuePrefix ?? "A";
        startNumber = settRes.recordset[0].QueueStartNumber ?? 1;
      }
    } catch {
      // Fallback to defaults
    }

    // 5. Calculate estimate for the barber
    let estimatedStartTime: Date | null = null;
    let estimatedWaitMinutes: number | null = null;

    // Debug log raw booking fields before any date computation
    const startHHMM = extractHHMM(booking.StartTime);
    const endHHMM   = extractHHMM(booking.EndTime);
    console.log('[arrive] booking raw fields', {
      bookingId,
      BookingDate:       booking.BookingDate,
      StartTime:         booking.StartTime,
      EndTime:           booking.EndTime,
      AssignedEmpID:     booking.AssignedEmpID,
      Status:            booking.Status,
      typeofBookingDate: typeof booking.BookingDate,
      typeofStartTime:   typeof booking.StartTime,
      isStartTimeDate:   booking.StartTime instanceof Date,
      startHHMM,
      endHHMM,
    });

    if (booking.AssignedEmpID) {
      const defaultDur = await getDefaultDuration(db);

      // Build timeline for the barber
      const qIvs = await buildQueueIntervals(
        db,
        booking.AssignedEmpID,
        today,
        now,
        defaultDur
      );
      const bIvs = await buildBookingIntervals(
        db,
        booking.AssignedEmpID,
        today,
        defaultDur
      );

      // This booking's own interval should be excluded (it's being converted to queue)
      const otherBookings = bIvs.filter((b) => b.id !== bookingId);
      const allIvs = [...qIvs, ...otherBookings].sort(
        (a, b) => a.start.getTime() - b.start.getTime()
      );

      // Use buildDateTimeFromSqlDateAndTime to safely combine SQL `date` + SQL `time` values
      const bookingStart = buildDateTimeFromSqlDateAndTime(booking.BookingDate, booking.StartTime);
      const bookingEnd   = buildDateTimeFromSqlDateAndTime(booking.BookingDate, booking.EndTime);

      console.log('[arrive] computed datetime', {
        computedEstStart:   bookingStart?.toISOString() ?? null,
        computedEstEnd:     bookingEnd?.toISOString() ?? null,
        isValidEstStart:    bookingStart ? !isNaN(bookingStart.getTime()) : false,
        isValidEstEnd:      bookingEnd   ? !isNaN(bookingEnd.getTime())   : false,
      });

      // Guard: if we cannot build a valid start datetime, return 400 instead of 500
      if (!bookingStart) {
        return NextResponse.json(
          {
            ok: false,
            error: 'invalid_est_start',
            bookingId,
            BookingDate:   booking.BookingDate,
            StartTime:     booking.StartTime,
            extractedDate: (() => {
              if (booking.BookingDate instanceof Date) return booking.BookingDate.toISOString();
              return String(booking.BookingDate);
            })(),
            extractedTime: startHHMM,
            message: 'Cannot build valid EstimatedStartTime from booking date/time',
          },
          { status: 400 }
        );
      }

      const fallbackDuration = defaultDur;
      const bookingDuration = (bookingEnd && bookingStart)
        ? Math.max(1, Math.round((bookingEnd.getTime() - bookingStart.getTime()) / 60000))
        : fallbackDuration;

      // Find first free slot - but we want to prioritize the booking's original time
      // Check if booking's original slot is still available
      const slotAvailable = !allIvs.some(
        (iv) =>
          bookingStart < iv.end &&
          new Date(bookingStart.getTime() + bookingDuration * 60000) > iv.start
      );

      if (slotAvailable) {
        // Use original booking time
        estimatedStartTime = bookingStart;
        estimatedWaitMinutes = Math.max(
          0,
          Math.round((bookingStart.getTime() - now.getTime()) / 60000)
        );
      } else {
        // Find next available slot
        estimatedStartTime = findFirstFreeSlot(now, bookingDuration, allIvs);
        estimatedWaitMinutes = Math.max(
          0,
          Math.round((estimatedStartTime.getTime() - now.getTime()) / 60000)
        );
      }
    }

    // 6. Create QueueTicket in transaction
    const transaction = db.transaction();
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

    let newTicketId: number;
    let ticketCode: string;
    let ticketNumber: number;

    try {
      // Generate ticket number
      const numRes = await transaction
        .request()
        .input("qDate", sql.Date, today)
        .query(`
          SELECT ISNULL(MAX(TicketNumber), ${startNumber - 1}) + 1 AS NextNum
          FROM [dbo].[QueueTickets] WITH (UPDLOCK, HOLDLOCK)
          WHERE QueueDate = @qDate
        `);

      ticketNumber = numRes.recordset[0].NextNum;
      ticketCode = `${prefix}${ticketNumber}`;

      // Check for estimate columns
      const colCheck = await transaction.request().query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'QueueTickets'
          AND COLUMN_NAME IN ('EstimatedStartTime','EstimatedWaitMinutes','WaitingCountAtCreation')
      `);
      const existingCols = new Set(
        colCheck.recordset.map((r: { COLUMN_NAME: string }) => r.COLUMN_NAME)
      );

      const hasEst = existingCols.has("EstimatedStartTime");
      const hasWait = existingCols.has("EstimatedWaitMinutes");
      const hasWCount = existingCols.has("WaitingCountAtCreation");

      // Count waiting tickets before this one
      const waitingCountRes = await transaction
        .request()
        .input("empId", sql.Int, booking.AssignedEmpID)
        .input("qDate", sql.Date, today)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM [dbo].[QueueTickets]
          WHERE EmpID = @empId
            AND QueueDate = @qDate
            AND Status IN ('waiting','called','arrived','in_service')
        `);
      const waitingCountAtCreation = waitingCountRes.recordset[0]?.cnt ?? 0;

      // Insert queue ticket
      const insertSql = `
        INSERT INTO [dbo].[QueueTickets]
          (TicketCode, TicketNumber, TicketPrefix, ClientID, EmpID, BookingID,
           QueueDate, CreatedTime, Status, Source, Priority, CreatedByUserID, Notes
           ${hasEst ? ", EstimatedStartTime" : ""}
           ${hasWait ? ", EstimatedWaitMinutes" : ""}
           ${hasWCount ? ", WaitingCountAtCreation" : ""})
        OUTPUT INSERTED.QueueTicketID
        VALUES
          (@code, @num, @prefix, @clientId, @empId, @bookingId,
           @qDate, @cTime, 'arrived', 'booking', @priority, @userID, @notes
           ${hasEst ? ", @estStart" : ""}
           ${hasWait ? ", @estWait" : ""}
           ${hasWCount ? ", @waitCount" : ""})
      `;

      const insReq = transaction
        .request()
        .input("code", sql.NVarChar, ticketCode)
        .input("num", sql.Int, ticketNumber)
        .input("prefix", sql.NVarChar, prefix)
        .input("clientId", sql.Int, booking.ClientID)
        .input("empId", sql.Int, booking.AssignedEmpID)
        .input("bookingId", sql.Int, bookingId)
        .input("qDate", sql.Date, today)
        .input("cTime", sql.VarChar, createdTime)
        .input("priority", sql.Int, priority)
        .input("userID", sql.Int, userID)
        .input("notes", sql.NVarChar, notes || booking.BookingNotes || null);

      if (hasEst)
        insReq.input("estStart", sql.DateTime2, estimatedStartTime);
      if (hasWait)
        insReq.input("estWait", sql.Int, estimatedWaitMinutes);
      if (hasWCount)
        insReq.input("waitCount", sql.Int, waitingCountAtCreation);

      const insertRes = await insReq.query(insertSql);
      newTicketId = insertRes.recordset[0].QueueTicketID;

      // Update booking status to queued
      await transaction
        .request()
        .input("bid", sql.Int, bookingId)
        .input("userId", sql.Int, userID)
        .query(`
          UPDATE [dbo].[Bookings]
          SET Status = 'queued',
              UpdatedAt = GETDATE(),
              UpdatedByUserID = @userId
          WHERE BookingID = @bid
        `);

      await transaction.commit();
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }

    // 7. Create history entry (outside transaction)
    await db
      .request()
      .input("ticketId", sql.Int, newTicketId)
      .input("userId", sql.Int, userID)
      .query(`
        INSERT INTO [dbo].[QueueTicketHistory]
          (QueueTicketID, OldStatus, NewStatus, ActionType, ActionByUserID, Notes)
        VALUES (@ticketId, NULL, 'arrived', 'booking_arrived', @userId, N'تم الاستقبال من حجز #${bookingId}')
      `)
      .catch((e) => console.error("[booking arrive] history failed:", e));

    // 8. Load booking services and copy to QueueTicketServices
    try {
      const servicesRes = await db
        .request()
        .input("bid", sql.Int, bookingId)
        .query(`
          SELECT bs.ServiceID, bs.ServiceName, bs.DurationMinutes, bs.Price
          FROM [dbo].[BookingServices] bs
          WHERE bs.BookingID = @bid
        `);

      for (const svc of servicesRes.recordset) {
        await db
          .request()
          .input("ticketId", sql.Int, newTicketId)
          .input("proId", sql.Int, svc.ServiceID)
          .input("proName", sql.NVarChar, svc.ServiceName)
          .input("dur", sql.Int, svc.DurationMinutes)
          .input("price", sql.Decimal(10, 2), svc.Price)
          .query(`
            INSERT INTO [dbo].[QueueTicketServices]
              (QueueTicketID, ProID, ProName, Qty, DurationMinutes, Price)
            VALUES (@ticketId, @proId, @proName, 1, @dur, @price)
          `)
          .catch((e) => console.error("[booking arrive] service insert failed:", e));
      }
    } catch (e) {
      console.error("[booking arrive] services copy failed:", e);
    }

    const response: BookingArriveResponse = {
      ok: true,
      queueTicketId: newTicketId,
      ticketCode,
      estimatedStartTime: estimatedStartTime?.toISOString() || null,
      message: `تم استقبال صاحب الحجز وإنشاء دور ${ticketCode}`,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    console.error("[operations/bookings/arrive] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "فشل استقبال صاحب الحجز" },
      { status: 500 }
    );
  }
}
