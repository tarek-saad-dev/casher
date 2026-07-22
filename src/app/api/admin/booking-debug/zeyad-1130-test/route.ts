import { NextRequest, NextResponse } from "next/server";
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { getPool, sql } from "@/lib/db";

export const runtime = "nodejs";

const SALON_TZ = "Africa/Cairo";

/**
 * GET /api/admin/booking-debug/zeyad-1130-test
 *
 * Diagnostic endpoint for the 23:30 slot issue with Zeyad (EmpID=12)
 * Date: 2026-05-23
 * Service: 1047 (30 min)
 *
 * ⚠️ TEMPORARY DEBUG ENDPOINT - REMOVE AFTER TESTING
 */
export async function GET(req: NextRequest) {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  try {
    const db = await getPool();
    const date = "2026-05-23";
    const empId = 12;
    const serviceId = 1047;
    const slotTime = "23:30";
    const durationMin = 30;

    console.log("========================================");
    console.log("Zeyad 23:30 Diagnostic Test");
    console.log("========================================");

    // 1. Check if DurationMinutes column exists
    const colCheckRes = await db
      .request()
      .query(
        `
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'TblPro' AND COLUMN_NAME = 'DurationMinutes'
    `,
      )
      .catch(() => ({ recordset: [] }));

    const hasDurationColumn = colCheckRes.recordset.length > 0;
    console.log("Column check - DurationMinutes exists:", hasDurationColumn);

    // 1b. Get service duration from DB (with fallback)
    const svcRes = await db.request().input("sid", sql.Int, serviceId).query(`
        SELECT ProID, ProName, ${hasDurationColumn ? "DurationMinutes" : "30 AS DurationMinutes"}, SPrice1
        FROM [dbo].[TblPro]
        WHERE ProID = @sid
      `);

    const serviceFromDb = svcRes.recordset[0];
    const durationMinutes = serviceFromDb?.DurationMinutes || 30;
    console.log("\n1. Service from DB:", {
      serviceId,
      proName: serviceFromDb?.ProName,
      durationMinutes,
      price: serviceFromDb?.SPrice1,
      durationSource:
        hasDurationColumn && serviceFromDb?.DurationMinutes
          ? "SERVICE_DB"
          : "SERVICE_DEFAULT_FALLBACK",
      hasDurationColumn,
    });

    // 2. Get booking blockers for empId=12 on date=2026-05-23
    const bookingRes = await db
      .request()
      .input("empId", sql.Int, empId)
      .input("bdate", sql.Date, date).query(`
        SELECT 
          BookingID,
          BookingCode,
          AssignedEmpID,
          BookingDate,
          CONVERT(VARCHAR(8), StartTime, 108) as StartTime,
          CONVERT(VARCHAR(8), EndTime, 108) as EndTime,
          Status
        FROM [dbo].[Bookings]
        WHERE AssignedEmpID = @empId
          AND BookingDate = @bdate
          AND Status IN ('confirmed', 'arrived', 'queued', 'in_service')
        ORDER BY StartTime
      `);

    console.log("\n2. Booking Blockers for empId=12 on 2026-05-23:");
    console.log(`   Count: ${bookingRes.recordset.length}`);

    const bookingBlockers = bookingRes.recordset.map((b: any) => {
      // Convert SQL TIME to proper ms
      const startMs = timeToMs(date, b.StartTime);
      const endMs = timeToMs(date, b.EndTime);

      return {
        bookingId: b.BookingID,
        bookingCode: b.BookingCode,
        assignedEmpId: b.AssignedEmpID,
        bookingDate: b.BookingDate,
        startTime: b.StartTime,
        endTime: b.EndTime,
        status: b.Status,
        startMs,
        endMs,
        startISO: new Date(startMs).toISOString(),
        endISO: new Date(endMs).toISOString(),
      };
    });

    bookingBlockers.forEach((b: any, i: number) => {
      console.log(`   Blocker ${i + 1}:`, b);
    });

    // 3. Get queue blockers (with fallback for DurationMinutes)
    const queueColCheckRes = await db
      .request()
      .query(
        `
      SELECT COLUMN_NAME 
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'QueueTickets' AND COLUMN_NAME = 'DurationMinutes'
    `,
      )
      .catch(() => ({ recordset: [] }));

    const hasQueueDurationColumn = queueColCheckRes.recordset.length > 0;
    console.log(
      "   QueueTickets DurationMinutes exists:",
      hasQueueDurationColumn,
    );

    const queueRes = await db
      .request()
      .input("empId", sql.Int, empId)
      .input("qdate", sql.Date, date).query(`
        SELECT 
          QueueTicketID,
          TicketCode,
          EmpID,
          QueueDate,
          Status,
          ServiceStartedAt,
          ${hasQueueDurationColumn ? "ISNULL(DurationMinutes, 30)" : "30"} as DurationMinutes
        FROM [dbo].[QueueTickets]
        WHERE EmpID = @empId
          AND QueueDate = @qdate
          AND LOWER(Status) IN ('waiting','called','in_service')
        ORDER BY 
          CASE LOWER(Status) WHEN 'in_service' THEN 0 ELSE 1 END,
          QueueTicketID
      `);

    console.log("\n3. Queue Blockers for empId=12 on 2026-05-23:");
    console.log(`   Count: ${queueRes.recordset.length}`);

    const queueBlockers = queueRes.recordset.map((q: any) => {
      const startMs = q.ServiceStartedAt
        ? new Date(q.ServiceStartedAt).getTime()
        : timeToMs(date, "00:00"); // Will be calculated properly below
      const endMs = startMs + q.DurationMinutes * 60000;

      return {
        queueTicketId: q.QueueTicketID,
        ticketCode: q.TicketCode,
        empId: q.EmpID,
        queueDate: q.QueueDate,
        status: q.Status,
        serviceStartedAt: q.ServiceStartedAt,
        durationMinutes: q.DurationMinutes,
        startMs,
        endMs,
      };
    });

    queueBlockers.forEach((q: any, i: number) => {
      console.log(`   Queue Blocker ${i + 1}:`, q);
    });

    // 4. Calculate slot 23:30 timing
    const slotStartMs = timeToMs(date, slotTime);
    const slotEndMs = slotStartMs + durationMin * 60000;

    console.log("\n4. Slot 23:30 Timing:");
    console.log({
      slotTime,
      slotStartMs,
      slotEndMs,
      slotStartISO: new Date(slotStartMs).toISOString(),
      slotEndISO: new Date(slotEndMs).toISOString(),
      durationMin,
    });

    // 5. Check overlaps with booking blockers
    console.log("\n5. Overlap Check with Booking Blockers:");
    const bookingOverlapResults = bookingBlockers.map((b: any) => {
      const overlaps = slotStartMs < b.endMs && slotEndMs > b.startMs;
      console.log(`   Booking ${b.bookingId} (${b.startTime}-${b.endTime}):`, {
        slotStartMs,
        slotEndMs,
        blockerStartMs: b.startMs,
        blockerEndMs: b.endMs,
        overlaps,
        overlapFormula: `${slotStartMs} < ${b.endMs} && ${slotEndMs} > ${b.startMs} = ${overlaps}`,
      });
      return {
        bookingId: b.bookingId,
        blockerStartMs: b.startMs,
        blockerEndMs: b.endMs,
        overlaps,
      };
    });

    const hasBookingConflict = bookingOverlapResults.some(
      (r: any) => r.overlaps,
    );

    // 6. Check overlaps with queue blockers
    console.log("\n6. Overlap Check with Queue Blockers:");
    const queueOverlapResults = queueBlockers.map((q: any) => {
      const overlaps = slotStartMs < q.endMs && slotEndMs > q.startMs;
      console.log(`   Queue ${q.queueTicketId}: overlaps=${overlaps}`);
      return {
        queueTicketId: q.queueTicketId,
        blockerStartMs: q.startMs,
        blockerEndMs: q.endMs,
        overlaps,
      };
    });

    const hasQueueConflict = queueOverlapResults.some((r: any) => r.overlaps);

    // 7. Final verdict
    console.log("\n7. VERDICT:");
    const shouldBeAvailable = !hasBookingConflict && !hasQueueConflict;
    console.log({
      slotTime,
      hasBookingConflict,
      hasQueueConflict,
      shouldBeAvailable,
      expectedAvailable: false, // Because we know there are bookings at 23:30
    });

    // 8. Call available-slots endpoint internally to see what it returns
    console.log("\n8. Testing available-slots endpoint...");

    // Build the request URL
    const baseUrl = req.nextUrl.origin;
    const availSlotsUrl = new URL(
      "/api/public/booking/available-slots",
      baseUrl,
    );
    availSlotsUrl.searchParams.set("date", date);
    availSlotsUrl.searchParams.set("mode", "specific");
    availSlotsUrl.searchParams.set("empId", empId.toString());
    availSlotsUrl.searchParams.set("serviceIds", serviceId.toString());

    console.log(`   Calling: ${availSlotsUrl.toString()}`);

    // Make internal request
    const availResponse = await fetch(availSlotsUrl.toString(), {
      headers: { "Content-Type": "application/json" },
    });

    const availData = await availResponse.json();

    console.log("   available-slots response:");
    console.log(`   Status: ${availResponse.status}`);
    console.log(`   Total slots: ${availData.slots?.length || 0}`);

    // Find 23:30 slot specifically
    const slot2330 = availData.slots?.find((s: any) => s.time === "23:30");
    console.log(`   Slot 23:30 found: ${!!slot2330}`);
    if (slot2330) {
      console.log(`   Slot 23:30 available: ${slot2330.available}`);
      console.log(`   Slot 23:30 data:`, slot2330);
    }

    console.log("\n========================================");
    console.log("END OF DIAGNOSTIC");
    console.log("========================================");

    // Return comprehensive report
    return NextResponse.json({
      test: "Zeyad 23:30 Diagnostic",
      parameters: {
        date,
        empId,
        serviceId,
        slotTime,
        durationMin,
      },
      service: {
        fromDb: serviceFromDb,
        durationSource: serviceFromDb?.DurationMinutes
          ? "SERVICE_DB"
          : "SERVICE_DEFAULT",
      },
      bookingBlockers: {
        count: bookingBlockers.length,
        blockers: bookingBlockers,
      },
      queueBlockers: {
        count: queueBlockers.length,
        blockers: queueBlockers,
      },
      slot2330: {
        slotStartMs,
        slotEndMs,
        slotStartISO: new Date(slotStartMs).toISOString(),
        slotEndISO: new Date(slotEndMs).toISOString(),
      },
      overlapAnalysis: {
        bookingOverlapResults,
        queueOverlapResults,
        hasBookingConflict,
        hasQueueConflict,
        shouldBeAvailable,
      },
      availableSlotsEndpoint: {
        url: availSlotsUrl.toString(),
        status: availResponse.status,
        totalSlots: availData.slots?.length || 0,
        slot2330Found: !!slot2330,
        slot2330Available: slot2330?.available ?? null,
        slot2330Data: slot2330,
      },
      verdict: {
        // If slot 23:30 is returned as available=true, that's a BUG
        bugDetected: slot2330?.available === true,
        bugReason:
          slot2330?.available === true
            ? "Slot 23:30 should NOT be available due to existing booking conflicts"
            : null,
      },
    });
  } catch (err: any) {
    console.error("[zeyad-1130-test] error:", err);
    return NextResponse.json(
      { error: err?.message || "Test failed" },
      { status: 500 },
    );
  }
}

/**
 * Convert SQL TIME string to milliseconds since epoch for the given date
 * Handles the SQL TIME (1970-01-01) offset properly
 */
function timeToMs(dateStr: string, timeStr: string): number {
  // SQL returns TIME as "HH:MM:SS" or a Date object anchored to 1970-01-01
  if (!timeStr) return 0;

  // Parse HH:MM:SS
  const [h, m, s] = timeStr.split(":").map(Number);

  // Create date object for the target date with this time
  const date = new Date(`${dateStr}T00:00:00`);
  date.setHours(h, m, s || 0, 0);

  // Adjust for Cairo timezone
  const tzOffset = getTimezoneOffsetMs(date, SALON_TZ);

  return date.getTime() - tzOffset;
}

/**
 * Get timezone offset in ms for a date in a specific timezone
 */
function getTimezoneOffsetMs(date: Date, tz: string): number {
  try {
    // Get the time in the target timezone
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(date);

    const offsetPart =
      parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
    const match = offsetPart.match(/GMT([+-]\d+(?::\d+)?)/);

    if (match) {
      const segs = match[1].split(":");
      const hours = parseInt(segs[0], 10);
      const minutes = segs[1] ? parseInt(segs[1], 10) * Math.sign(hours) : 0;
      return (hours * 60 + minutes) * 60000;
    }
  } catch {
    // Fallback: Cairo is UTC+2/+3
    return 2 * 60 * 60000; // 2 hours
  }
  return 0;
}
