import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { detectQueueTicketsSchema } from "@/lib/queueSchema";
import { buildAnnouncementSequence, getChairNumber, getChairDisplayText } from "@/lib/chairMapping";

export const runtime = "nodejs";

// ── Helper to get Cairo date string ───────────────────────────────────────────
function cairoDateStr(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

// ── Helper to get Cairo time string ──────────────────────────────────────────
function cairoTimeStr(date: Date): string {
  return date.toLocaleTimeString("en-CA", {
    timeZone: "Africa/Cairo",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

// GET /api/operations/queue/due-announcements?date=YYYY-MM-DD
// Returns queue tickets that are due for announcement (waiting + estimated time <= now)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date = searchParams.get("date") || cairoDateStr(new Date());

    const db = await getPool();

    // Detect schema to avoid using non-existent columns
    const schema = await detectQueueTicketsSchema();
    console.log("[due-announcements] Schema detected:", schema);

    // Get current time in Cairo timezone
    const now = new Date();
    const cairoNow = new Date(
      now.toLocaleString("en-US", { timeZone: "Africa/Cairo" }),
    );

    // Build query - get waiting tickets where EstimatedStartTime <= now
    // And not already announced
    const announcedCheck = schema.hasAnnouncedAt
      ? "AND (qt.AnnouncedAt IS NULL OR qt.Status != 'called')"
      : "AND qt.Status != 'called'";

    // Use CTE with ROW_NUMBER to avoid duplicates while preserving ORDER BY
    const result = await db.request().input("date", sql.Date, date).query(`
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
          qt.CreatedTime,
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
      SELECT
        QueueTicketID,
        TicketCode,
        Status,
        CustomerName,
        CustomerMobile,
        EmpID,
        EmpName,
        EstimatedStartTime,
        QueueDate
      FROM RankedTickets
      WHERE rn = 1
      ORDER BY EstimatedStartTime ASC, QueueTicketID ASC
    `);

    console.log(`[due-announcements] found ${result.recordset.length} tickets for ${date}`);

    // Build announcement sequence for each ticket
    const announcements = result.recordset.map((row, index) => {
      console.log(`[due-announcements] processing ticket ${index + 1}/${result.recordset.length}: ${row.TicketCode}, empName: ${row.EmpName}, customer: ${row.CustomerName}`);

      const chairNumber = getChairNumber(row.EmpName);
      const chairDisplayText = getChairDisplayText(row.EmpName);
      console.log(`[due-announcements] chairNumber: ${chairNumber}, chairDisplayText: ${chairDisplayText}`);

      // Build announcement sequence (Arabic x1, English x1)
      console.log(`[due-announcements] building sequence for ${row.TicketCode}...`);
      const announcementSequence = buildAnnouncementSequence({
        ticketCode: row.TicketCode,
        customerName: row.CustomerName,
        empName: row.EmpName,
      });
      console.log(`[due-announcements] sequence built for ${row.TicketCode}: ${announcementSequence.length} parts`);

      // Legacy single text for backwards compatibility
      const announcementTextAr = announcementSequence[0]?.text ?? '';
      const announcementTextEn = announcementSequence[1]?.text ?? '';

      return {
        queueTicketId: row.QueueTicketID,
        ticketCode: row.TicketCode,
        customerName: row.CustomerName,
        customerMobile: row.CustomerMobile,
        empId: row.EmpID,
        empName: row.EmpName,
        chairNumber,
        chairDisplayText,
        estimatedStartTime: row.EstimatedStartTime,
        announcementText: announcementTextAr, // Legacy
        announcementTextAr,
        announcementTextEn,
        announcementSequence,
      };
    });

    console.log(`[due-announcements] returning ${announcements.length} announcements`);

    return NextResponse.json({
      ok: true,
      announcements,
      schema: {
        hasAnnouncedAt: schema.hasAnnouncedAt,
        hasCreatedAt: schema.hasCreatedAt,
        hasCreatedTime: schema.hasCreatedTime,
        hasQueueTime: schema.hasQueueTime,
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
        detail: process.env.NODE_ENV === "development" ? errorStack : undefined
      },
      { status: 500 },
    );
  }
}
