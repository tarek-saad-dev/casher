import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { detectQueueTicketsSchema } from "@/lib/queueSchema";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/operations/queue/[id]/announce
// Marks a queue ticket as announced (status = 'called', AnnouncedAt = now)
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ticketId = parseInt(id);

    if (isNaN(ticketId)) {
      return NextResponse.json(
        { error: "معرف الدور غير صالح" },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(req.url);
    const force = searchParams.get("force") === "true";

    // Optional: get user session for audit
    let userId = 0;
    try {
      const session = await getSession();
      userId = session?.UserID ?? 0;
    } catch {
      // Session not required for announcements
    }

    const db = await getPool();

    // Detect schema to avoid using non-existent columns
    const schema = await detectQueueTicketsSchema();
    console.log("[announce] Schema detected:", schema);

    // First, check if ticket exists and its current status
    const selectColumns = ['QueueTicketID', 'Status', 'TicketCode'];
    if (schema.hasAnnouncedAt) {
      selectColumns.push('AnnouncedAt');
    }
    if (schema.hasCalledAt) {
      selectColumns.push('CalledAt');
    }

    const checkRes = await db
      .request()
      .input("ticketId", sql.Int, ticketId)
      .query(`
        SELECT ${selectColumns.join(', ')}
        FROM dbo.QueueTickets
        WHERE QueueTicketID = @ticketId
      `);

    if (checkRes.recordset.length === 0) {
      return NextResponse.json(
        { error: "الدور غير موجود" },
        { status: 404 },
      );
    }

    const ticket = checkRes.recordset[0];

    // Check if already announced (unless force=true)
    const alreadyAnnounced = ticket.Status === "called" ||
      (schema.hasAnnouncedAt && ticket.AnnouncedAt != null) ||
      (schema.hasCalledAt && ticket.CalledAt != null);

    if (!force && alreadyAnnounced) {
      return NextResponse.json({
        ok: true,
        message: "تم النداء مسبقًا",
        alreadyAnnounced: true,
        ticketId,
        ticketCode: ticket.TicketCode,
      });
    }

    // Build UPDATE fields dynamically based on schema
    const updateFields = ["Status = 'called'"];

    if (schema.hasAnnouncedAt) {
      updateFields.push("AnnouncedAt = GETDATE()");
    }
    if (schema.hasCalledAt) {
      updateFields.push("CalledAt = GETDATE()");
    }
    if (schema.hasUpdatedAt) {
      updateFields.push("UpdatedAt = GETDATE()");
    }

    await db.request().input("ticketId", sql.Int, ticketId).query(`
      UPDATE dbo.QueueTickets
      SET ${updateFields.join(", ")}
      WHERE QueueTicketID = @ticketId
    `);

    console.log("[announce] Ticket announced:", {
      ticketId,
      ticketCode: ticket.TicketCode,
      force,
      userId,
    });

    return NextResponse.json({
      ok: true,
      message: "تم النداء بنجاح",
      ticketId,
      ticketCode: ticket.TicketCode,
      status: "called",
      schema: {
        hasAnnouncedAt: schema.hasAnnouncedAt,
        hasCalledAt: schema.hasCalledAt,
        hasUpdatedAt: schema.hasUpdatedAt,
      },
    });
  } catch (err) {
    console.error("[announce] error:", err);
    return NextResponse.json(
      { error: "فشل تحديث حالة النداء" },
      { status: 500 },
    );
  }
}
