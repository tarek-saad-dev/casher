/**
 * POST /api/operations/announce
 * Universal announce endpoint — handles both queue tickets and bookings.
 *
 * Body: { type: "queue_ticket" | "booking", id: number, force?: boolean }
 */
import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { detectQueueTicketsSchema } from "@/lib/queueSchema";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, id, force = false } = body as {
      type: "queue_ticket" | "booking";
      id: number;
      force?: boolean;
    };

    if (!type || !id || isNaN(id)) {
      return NextResponse.json(
        { ok: false, error: "type and id are required" },
        { status: 400 }
      );
    }

    const db = await getPool();

    // ── Queue Ticket ──────────────────────────────────────────────────────────
    if (type === "queue_ticket") {
      const schema = await detectQueueTicketsSchema();

      const selectCols = ["QueueTicketID", "Status", "TicketCode"];
      if (schema.hasAnnouncedAt) selectCols.push("AnnouncedAt");
      if (schema.hasCalledAt) selectCols.push("CalledAt");

      const checkRes = await db
        .request()
        .input("id", sql.Int, id)
        .query(`SELECT ${selectCols.join(",")} FROM dbo.QueueTickets WHERE QueueTicketID = @id`);

      if (!checkRes.recordset.length)
        return NextResponse.json({ ok: false, error: "Queue ticket not found" }, { status: 404 });

      const ticket = checkRes.recordset[0];
      const alreadyAnnounced =
        ticket.Status === "called" ||
        (schema.hasAnnouncedAt && ticket.AnnouncedAt != null) ||
        (schema.hasCalledAt && ticket.CalledAt != null);

      if (!force && alreadyAnnounced)
        return NextResponse.json({ ok: true, alreadyAnnounced: true, ticketCode: ticket.TicketCode });

      const fields = ["Status = 'called'"];
      if (schema.hasAnnouncedAt) fields.push("AnnouncedAt = GETDATE()");
      if (schema.hasCalledAt) fields.push("CalledAt = GETDATE()");
      if (schema.hasUpdatedAt) fields.push("UpdatedAt = GETDATE()");

      await db
        .request()
        .input("id", sql.Int, id)
        .query(`UPDATE dbo.QueueTickets SET ${fields.join(",")} WHERE QueueTicketID = @id`);

      return NextResponse.json({ ok: true, type: "queue_ticket", id, status: "called" });
    }

    // ── Booking ───────────────────────────────────────────────────────────────
    if (type === "booking") {
      // Check if AnnouncedAt column exists on Bookings
      const colCheck = await db.request().query(`
        SELECT
          MAX(CASE WHEN name='AnnouncedAt' THEN 1 ELSE 0 END) AS hasAnnouncedAt,
          MAX(CASE WHEN name='CalledAt'    THEN 1 ELSE 0 END) AS hasCalledAt,
          MAX(CASE WHEN name='UpdatedAt'   THEN 1 ELSE 0 END) AS hasUpdatedAt
        FROM sys.columns
        WHERE object_id = OBJECT_ID('dbo.Bookings')
      `);
      const cols = colCheck.recordset[0] ?? {};
      const hasAnnouncedAt = !!cols.hasAnnouncedAt;
      const hasCalledAt = !!cols.hasCalledAt;
      const hasUpdatedAt = !!cols.hasUpdatedAt;

      // Fetch booking
      const selectCols = ["BookingID", "Status", "BookingCode"];
      if (hasAnnouncedAt) selectCols.push("AnnouncedAt");
      if (hasCalledAt) selectCols.push("CalledAt");

      const bRes = await db
        .request()
        .input("id", sql.Int, id)
        .query(`SELECT ${selectCols.join(",")} FROM dbo.Bookings WHERE BookingID = @id`);

      if (!bRes.recordset.length)
        return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });

      const booking = bRes.recordset[0];

      // Already announced?
      const alreadyAnnounced =
        (hasAnnouncedAt && booking.AnnouncedAt != null) ||
        (hasCalledAt && booking.CalledAt != null);

      if (!force && alreadyAnnounced)
        return NextResponse.json({
          ok: true,
          alreadyAnnounced: true,
          bookingId: id,
          bookingCode: booking.BookingCode,
        });

      // Build UPDATE — only touch AnnouncedAt/CalledAt, never Status
      if (!hasAnnouncedAt && !hasCalledAt) {
        // No columns to update — columns not migrated yet; return ok so frontend isn't blocked
        console.warn("[announce] Bookings table missing AnnouncedAt/CalledAt — migration needed");
        return NextResponse.json({ ok: true, type: "booking", id, migrationNeeded: true });
      }

      const fields: string[] = [];
      if (hasAnnouncedAt) fields.push("AnnouncedAt = GETDATE()");
      if (hasCalledAt) fields.push("CalledAt = GETDATE()");
      if (hasUpdatedAt) fields.push("UpdatedAt = GETDATE()");

      await db
        .request()
        .input("id", sql.Int, id)
        .query(`UPDATE dbo.Bookings SET ${fields.join(",")} WHERE BookingID = @id`);

      return NextResponse.json({ ok: true, type: "booking", id, bookingCode: booking.BookingCode });
    }

    return NextResponse.json({ ok: false, error: `Unknown type: ${type}` }, { status: 400 });
  } catch (err) {
    console.error("[announce]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
