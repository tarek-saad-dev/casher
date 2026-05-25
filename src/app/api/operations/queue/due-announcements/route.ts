import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { detectQueueTicketsSchema } from "@/lib/queueSchema";
import {
  buildAnnouncementSequence,
  buildBookingAnnouncementSequence,
  getChairNumber,
  getChairDisplayText,
} from "@/lib/chairMapping";

export const runtime = "nodejs";

// ── Helper to get Cairo date string ───────────────────────────────────────────
function cairoDateStr(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

// GET /api/operations/queue/due-announcements?date=YYYY-MM-DD
// Returns queue tickets + bookings due for announcement, ordered by time (bookings first on tie)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || cairoDateStr(new Date());

    const db = await getPool();

    // Detect QueueTickets schema
    const schema = await detectQueueTicketsSchema();

    // Detect Bookings announce columns
    const bColRes = await db.request().query(`
      SELECT
        MAX(CASE WHEN name='AnnouncedAt' THEN 1 ELSE 0 END) AS hasAnnouncedAt,
        MAX(CASE WHEN name='CalledAt'    THEN 1 ELSE 0 END) AS hasCalledAt
      FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Bookings')
    `);
    const bCols = bColRes.recordset[0] ?? {};
    const bookingHasAnnouncedAt = !!bCols.hasAnnouncedAt;
    const bookingHasCalledAt = !!bCols.hasCalledAt;

    const cairoNow = new Date(
      new Date().toLocaleString("en-US", { timeZone: "Africa/Cairo" }),
    );

    // ── A) Queue Tickets due ─────────────────────────────────────────────────
    const announcedCheck = schema.hasAnnouncedAt
      ? "AND (qt.AnnouncedAt IS NULL OR qt.Status != 'called')"
      : "AND qt.Status != 'called'";

    const qResult = await db.request().input("date", sql.Date, date).query(`
      WITH RankedTickets AS (
        SELECT
          qt.QueueTicketID,
          qt.TicketCode,
          qt.Status,
          c.Name AS CustomerName,
          c.Mobile AS CustomerMobile,
          qt.EmpID,
          e.EmpName,
          qt.EstimatedStartTime,
          qt.QueueDate,
          ROW_NUMBER() OVER (
            PARTITION BY qt.QueueTicketID
            ORDER BY qt.EstimatedStartTime ASC, qt.QueueTicketID ASC
          ) AS rn
        FROM dbo.QueueTickets qt
        LEFT JOIN dbo.TblClient c ON c.ClientID = qt.ClientID
        LEFT JOIN dbo.TblEmp e ON e.EmpID = qt.EmpID
        WHERE qt.QueueDate = @date
          AND qt.Status = 'waiting'
          AND qt.EmpID IS NOT NULL
          AND qt.EstimatedStartTime IS NOT NULL
          AND qt.EstimatedStartTime <= GETDATE()
          ${announcedCheck}
      )
      SELECT * FROM RankedTickets WHERE rn = 1
    `);

    // ── B) Bookings due ──────────────────────────────────────────────────────
    const bookingNotAnnouncedClause = bookingHasAnnouncedAt
      ? "AND b.AnnouncedAt IS NULL"
      : bookingHasCalledAt
        ? "AND b.CalledAt IS NULL"
        : ""; // no columns yet — still return them (frontend won't loop, backend won't mark)

    const bResult = await db.request().input("bdate", sql.Date, date).query(`
      SELECT
        b.BookingID,
        b.BookingCode,
        b.Status,
        c.Name  AS CustomerName,
        c.Mobile AS CustomerMobile,
        b.AssignedEmpID AS EmpID,
        e.EmpName,
        CONVERT(varchar(5), TRY_CONVERT(time, b.StartTime), 108) AS ScheduledTime,
        DATEADD(
          SECOND,
          DATEDIFF(SECOND, CAST('00:00:00' AS time), TRY_CONVERT(time, b.StartTime)),
          CAST(b.BookingDate AS datetime)
        ) AS DueDateTime
      FROM dbo.Bookings b
      LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
      LEFT JOIN dbo.TblEmp   e ON e.EmpID    = b.AssignedEmpID
      WHERE b.BookingDate = @bdate
        AND b.Status IN ('confirmed', 'arrived')
        AND b.AssignedEmpID IS NOT NULL
        AND TRY_CONVERT(time, b.StartTime) IS NOT NULL
        AND DATEADD(
              SECOND,
              DATEDIFF(SECOND, CAST('00:00:00' AS time), TRY_CONVERT(time, b.StartTime)),
              CAST(b.BookingDate AS datetime)
            ) <= GETDATE()
        ${bookingNotAnnouncedClause}
    `);

    // ── Build queue ticket announcements ─────────────────────────────────────
    const queueAnnouncements = qResult.recordset.map((row) => {
      const chairNumber = getChairNumber(row.EmpName);
      const chairDisplayText = getChairDisplayText(row.EmpName);
      const announcementSequence = buildAnnouncementSequence({
        ticketCode: row.TicketCode,
        customerName: row.CustomerName,
        empName: row.EmpName,
      });
      return {
        type: "queue_ticket" as const,
        queueTicketId: row.QueueTicketID,
        ticketCode: row.TicketCode,
        customerName: row.CustomerName,
        customerMobile: row.CustomerMobile,
        empId: row.EmpID,
        empName: row.EmpName,
        chairNumber,
        chairDisplayText,
        dueTime: row.EstimatedStartTime as Date,
        estimatedStartTime: row.EstimatedStartTime,
        announcementText: announcementSequence[0]?.text ?? "",
        announcementTextAr: announcementSequence[0]?.text ?? "",
        announcementTextEn: announcementSequence[1]?.text ?? "",
        announcementSequence,
      };
    });

    // ── Build booking announcements ───────────────────────────────────────────
    const bookingAnnouncements = bResult.recordset
      .filter((row) => {
        if (!row.ScheduledTime || !row.DueDateTime) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[due-announcements] booking ${row.BookingID} skipped: TRY_CONVERT(time, '${row.StartTime}') returned NULL`,
            );
          }
          return false;
        }
        return true;
      })
      .map((row) => {
        const chairNumber = getChairNumber(row.EmpName);
        const chairDisplayText = getChairDisplayText(row.EmpName);
        const announcementSequence = buildBookingAnnouncementSequence({
          bookingCode: row.BookingCode ?? null,
          customerName: row.CustomerName,
          empName: row.EmpName,
        });
        return {
          type: "booking" as const,
          bookingId: row.BookingID,
          ticketCode: row.BookingCode ?? `BK-${row.BookingID}`,
          customerName: row.CustomerName,
          customerMobile: row.CustomerMobile,
          empId: row.EmpID,
          empName: row.EmpName,
          chairNumber,
          chairDisplayText,
          dueTime: row.DueDateTime as Date,
          scheduledTime: row.ScheduledTime,
          announcementText: announcementSequence[0]?.text ?? "",
          announcementTextAr: announcementSequence[0]?.text ?? "",
          announcementTextEn: announcementSequence[1]?.text ?? "",
          announcementSequence,
        };
      });

    // ── Merge + sort: by dueTime ASC; on tie bookings first ───────────────────
    const all = [
      ...bookingAnnouncements, // bookings first so they win tie-breaks
      ...queueAnnouncements,
    ].sort((a, b) => {
      const tA =
        a.dueTime instanceof Date
          ? a.dueTime.getTime()
          : new Date(a.dueTime).getTime();
      const tB =
        b.dueTime instanceof Date
          ? b.dueTime.getTime()
          : new Date(b.dueTime).getTime();
      if (tA !== tB) return tA - tB;
      // Same time: booking wins (type=booking sorts before queue_ticket)
      return a.type === "booking" ? -1 : 1;
    });

    // Strip internal dueTime from response
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const announcements = all.map(({ dueTime: _dt, ...rest }) => rest);

    console.log(
      `[due-announcements] ${date}: ${queueAnnouncements.length} queue + ${bookingAnnouncements.length} booking = ${announcements.length} total`,
    );

    return NextResponse.json({
      ok: true,
      announcements,
      schema: {
        hasAnnouncedAt: schema.hasAnnouncedAt,
        hasCreatedAt: schema.hasCreatedAt,
        hasCreatedTime: schema.hasCreatedTime,
        hasQueueTime: schema.hasQueueTime,
        bookingHasAnnouncedAt,
        bookingHasCalledAt,
      },
      serverTime: cairoNow.toISOString(),
    });
  } catch (err) {
    console.error("[due-announcements] error:", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;

    return NextResponse.json(
      {
        ok: false,
        error: "due_announcements_failed",
        message: errorMessage,
        detail: process.env.NODE_ENV === "development" ? errorStack : undefined,
      },
      { status: 500 },
    );
  }
}
