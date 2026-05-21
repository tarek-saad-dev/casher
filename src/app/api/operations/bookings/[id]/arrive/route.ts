/**
 * POST /api/operations/bookings/[id]/arrive
 *
 * Handle booking arrival:
 * 1. Update Booking.Status = 'queued'
 * 2. Create QueueTicket (Status='waiting') linked to BookingID
 * 3. Priority = 1 (reserved_booking)
 * 4. Prevent duplicate QueueTicket for same BookingID
 * 5. EstimatedStartTime = booking's original slot time (Cairo local)
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import {
  buildQueueIntervals,
  buildBookingIntervals,
  getDefaultDuration,
  findFirstFreeSlot,
} from "@/lib/queueEstimateEngine";

// ── Date helpers ──────────────────────────────────────────────────────────────

/**
 * Extract "HH:mm" from a SQL `time` column value.
 * mssql driver returns `time` columns as Date objects anchored to 1970-01-01 UTC.
 * Also handles plain strings like "10:30:00".
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
 * Extract "YYYY-MM-DD" from a SQL `date` column value.
 * mssql driver returns `date` columns as Date objects with time zeroed at UTC midnight.
 */
function extractDateStr(value: unknown): string | null {
  if (value instanceof Date && !isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const mo = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${mo}-${d}`;
  }
  if (typeof value === 'string') {
    const m = value.match(/(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Build a valid Date for a salon datetime by treating YYYY-MM-DD + HH:mm
 * as Africa/Cairo local time, converting to UTC correctly via Intl offset.
 *
 * Uses the same algorithm as /api/public/booking/plan's salonDateTimeToMs.
 */
function buildSalonDateTime(dateStr: string, hhmm: string, tz = 'Africa/Cairo'): Date | null {
  try {
    const [h, m] = hhmm.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) return null;
    // Get TZ offset for noon on this date (avoids DST edge at midnight)
    const noonUtc = new Date(`${dateStr}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(noonUtc);
    const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT+0';
    const match = offsetPart.match(/GMT([+-]\d+(?::\d+)?)/);
    let offsetMinutes = 0;
    if (match) {
      const segs = match[1].split(':');
      offsetMinutes = parseInt(segs[0], 10) * 60 +
        (segs[1] ? parseInt(segs[1], 10) * Math.sign(parseInt(segs[0], 10)) : 0);
    }
    const midnightUtcMs = new Date(`${dateStr}T00:00:00Z`).getTime();
    const ms = midnightUtcMs - offsetMinutes * 60_000 + (h * 60 + m) * 60_000;
    const dt = new Date(ms);
    return isNaN(dt.getTime()) ? null : dt;
  } catch {
    return null;
  }
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
    const createdTime = now.toLocaleTimeString("en-GB", {
      timeZone: "Africa/Cairo",
      hour12: false,
    });

    // Derive the operational date from the booking's own date (not necessarily today)
    const bookingDateStr = extractDateStr(booking.BookingDate);
    if (!bookingDateStr) {
      return NextResponse.json(
        { ok: false, error: 'invalid_booking_date', bookingId,
          raw: String(booking.BookingDate), message: 'Cannot extract YYYY-MM-DD from BookingDate' },
        { status: 422 }
      );
    }
    // QueueDate = booking's calendar date (used to group tickets per day)
    const queueDate = bookingDateStr;

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

    // Extract HH:mm from SQL time columns (returned as 1970-based Date objects)
    const startHHMM = extractHHMM(booking.StartTime);
    const endHHMM   = extractHHMM(booking.EndTime);

    console.log('[arrive] booking raw fields', {
      bookingId,
      bookingDateStr,
      StartTime:       booking.StartTime,
      EndTime:         booking.EndTime,
      AssignedEmpID:   booking.AssignedEmpID,
      Status:          booking.Status,
      startHHMM,
      endHHMM,
    });

    // Build Cairo-local DateTimes for start and end
    const bookingStart = startHHMM ? buildSalonDateTime(bookingDateStr, startHHMM) : null;
    const bookingEnd   = endHHMM   ? buildSalonDateTime(bookingDateStr, endHHMM)   : null;

    console.log('[arrive] computed datetime', {
      computedEstStart: bookingStart?.toISOString() ?? null,
      computedEstEnd:   bookingEnd?.toISOString()   ?? null,
      isValidEstStart:  bookingStart ? !isNaN(bookingStart.getTime()) : false,
      isValidEstEnd:    bookingEnd   ? !isNaN(bookingEnd.getTime())   : false,
    });

    // Guard: if we cannot build a valid start datetime, return 422 instead of 500
    if (!bookingStart) {
      return NextResponse.json(
        {
          ok: false,
          error: 'invalid_est_start',
          bookingId,
          bookingDateStr,
          rawStartTime: String(booking.StartTime),
          extractedHHMM: startHHMM,
          message: 'Cannot build valid EstimatedStartTime — check BookingDate + StartTime',
        },
        { status: 422 }
      );
    }

    if (booking.AssignedEmpID) {
      const defaultDur = await getDefaultDuration(db);

      const bookingDuration = (bookingEnd && bookingStart)
        ? Math.max(1, Math.round((bookingEnd.getTime() - bookingStart.getTime()) / 60000))
        : defaultDur;

      // Build timeline for the barber on the booking's date
      const qIvs = await buildQueueIntervals(
        db, booking.AssignedEmpID, bookingDateStr, now, defaultDur
      );
      const bIvs = await buildBookingIntervals(
        db, booking.AssignedEmpID, bookingDateStr, defaultDur
      );

      // Exclude this booking's own interval (it's being converted)
      const otherBookings = bIvs.filter(iv => iv.id !== bookingId);
      const allIvs = [...qIvs, ...otherBookings].sort(
        (a, b) => a.start.getTime() - b.start.getTime()
      );

      // Always preserve the booking's original time slot as EstimatedStartTime.
      // The booking already blocked this slot — we respect that.
      estimatedStartTime = bookingStart;
      estimatedWaitMinutes = Math.max(
        0,
        Math.round((bookingStart.getTime() - now.getTime()) / 60000)
      );

      // If the slot is somehow no longer free (e.g. manual override), find next free
      const slotEnd = new Date(bookingStart.getTime() + bookingDuration * 60_000);
      const slotBlocked = allIvs.some(iv => bookingStart < iv.end && slotEnd > iv.start);
      if (slotBlocked) {
        console.warn('[arrive] booking slot blocked by another ticket — finding next free slot');
        estimatedStartTime = findFirstFreeSlot(now, bookingDuration, allIvs);
        estimatedWaitMinutes = Math.max(
          0,
          Math.round((estimatedStartTime.getTime() - now.getTime()) / 60000)
        );
      }
    } else {
      // No barber assigned — still use booking start time
      estimatedStartTime = bookingStart;
      estimatedWaitMinutes = Math.max(
        0,
        Math.round((bookingStart.getTime() - now.getTime()) / 60000)
      );
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
        .input("qDate", sql.Date, queueDate)
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
        .input("qDate", sql.Date, queueDate)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM [dbo].[QueueTickets]
          WHERE EmpID = @empId
            AND QueueDate = @qDate
            AND Status IN ('waiting','called','arrived','in_service')
        `);
      const waitingCountAtCreation = waitingCountRes.recordset[0]?.cnt ?? 0;

      // Insert queue ticket — Status='waiting' (not 'arrived'; 'arrived' is not a valid QueueTicket status)
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
           @qDate, @cTime, 'waiting', 'booking', @priority, @userID, @notes
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
        .input("qDate", sql.Date, queueDate)
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

      // Update booking status to 'queued' (UpdatedByUserID does not exist on this table)
      await transaction
        .request()
        .input("bid", sql.Int, bookingId)
        .query(`
          UPDATE [dbo].[Bookings]
          SET Status = 'queued',
              UpdatedAt = GETDATE()
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
      .input("notes", sql.NVarChar, `تم الاستقبال من حجز #${bookingId}`)
      .query(`
        INSERT INTO [dbo].[QueueTicketHistory]
          (QueueTicketID, OldStatus, NewStatus, ActionType, ActionByUserID, Notes)
        VALUES (@ticketId, NULL, 'waiting', 'booking_arrived', @userId, @notes)
      `)
      .catch((e) => console.error("[booking arrive] history failed:", e));

    // 8. Load booking services and copy to QueueTicketServices (if table exists)
    try {
      const svcTableCheck = await db.request().query(
        `SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='QueueTicketServices'`
      );
      if (svcTableCheck.recordset.length) {
        // BookingServices uses ProID (not ServiceID), join TblPro for name
        const servicesRes = await db
          .request()
          .input("bid", sql.Int, bookingId)
          .query(`
            SELECT bs.ProID, p.ProName, bs.DurationMinutes, bs.Price
            FROM [dbo].[BookingServices] bs
            LEFT JOIN [dbo].[TblPro] p ON p.ProID = bs.ProID
            WHERE bs.BookingID = @bid
          `);

        for (const svc of servicesRes.recordset) {
          await db
            .request()
            .input("ticketId", sql.Int, newTicketId)
            .input("proId", sql.Int, svc.ProID ?? null)
            .input("proName", sql.NVarChar, svc.ProName ?? null)
            .input("dur", sql.Int, svc.DurationMinutes ?? null)
            .input("price", sql.Decimal(10, 2), svc.Price ?? null)
            .query(`
              INSERT INTO [dbo].[QueueTicketServices]
                (QueueTicketID, ProID, ProName, Qty, DurationMinutes, Price)
              VALUES (@ticketId, @proId, @proName, 1, @dur, @price)
            `)
            .catch((e) => console.error("[booking arrive] service insert failed:", e));
        }
      } else {
        console.warn('[booking arrive] QueueTicketServices table missing — skipping service copy');
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
