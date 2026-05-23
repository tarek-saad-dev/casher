import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const STATUS_TRANSITIONS: Record<string, string[]> = {
  waiting:    ["called", "in_service", "cancelled", "no_show"],
  called:     ["arrived", "in_service", "skipped", "cancelled"],
  arrived:    ["in_service", "cancelled"],
  in_service: ["done", "cancelled"],
  skipped:    ["waiting", "called", "cancelled"],
  done:       [],
  cancelled:  [],
  no_show:    [],
};

const ACTION_MAP: Record<string, string> = {
  called:     "called",
  arrived:    "arrived",
  in_service: "start_service",
  done:       "done",
  skipped:    "skipped",
  cancelled:  "cancelled",
  no_show:    "no_show",
  waiting:    "reschedule",
};

// GET /api/queue/[id]
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = await getPool();
    const result = await db.request()
      .input("id", sql.Int, parseInt(id))
      .query(`
        SELECT qt.*, c.[Name] AS ClientName, c.Mobile AS ClientMobile, e.EmpName
        FROM [dbo].[QueueTickets] qt
        LEFT JOIN [dbo].[TblClient] c ON c.ClientID = qt.ClientID
        LEFT JOIN [dbo].[TblEmp]    e ON e.EmpID    = qt.EmpID
        WHERE qt.QueueTicketID = @id
      `);
    if (!result.recordset.length)
      return NextResponse.json({ error: "تذكرة غير موجودة" }, { status: 404 });

    const histRes = await db.request()
      .input("id", sql.Int, parseInt(id))
      .query(`
        SELECT h.*, u.UserName
        FROM [dbo].[QueueTicketHistory] h
        LEFT JOIN [dbo].[TblUser] u ON u.UserID = h.ActionByUserID
        WHERE h.QueueTicketID = @id
        ORDER BY h.ActionAt DESC
      `);

    return NextResponse.json({
      ticket: result.recordset[0],
      history: histRes.recordset,
    });
  } catch (err) {
    console.error("[queue GET id]", err);
    return NextResponse.json({ error: "فشل تحميل التذكرة" }, { status: 500 });
  }
}

// PATCH /api/queue/[id]
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const session = await getSession();
    const userID = session?.UserID ?? 0;
    const ticketId = parseInt(id);
    const body = await req.json();
    const { action, notes, transferEmpId } = body;

    const db = await getPool();

    // Load current ticket
    const cur = await db.request()
      .input("id", sql.Int, ticketId)
      .query(`SELECT Status, EmpID FROM [dbo].[QueueTickets] WHERE QueueTicketID = @id`);
    if (!cur.recordset.length)
      return NextResponse.json({ error: "تذكرة غير موجودة" }, { status: 404 });

    const currentStatus = cur.recordset[0].Status;

    // Handle transfer separately
    if (action === "transfer") {
      if (!transferEmpId)
        return NextResponse.json({ error: "يجب تحديد الحلاق المستقبل" }, { status: 400 });

      await db.request()
        .input("empId",    sql.Int,      transferEmpId)
        .input("ticketId", sql.Int,      ticketId)
        .query(`UPDATE [dbo].[QueueTickets] SET EmpID = @empId, UpdatedAt = GETDATE() WHERE QueueTicketID = @ticketId`);

      await db.request()
        .input("ticketId",  sql.Int,      ticketId)
        .input("oldStatus", sql.NVarChar, currentStatus)
        .input("newStatus", sql.NVarChar, currentStatus)
        .input("action",    sql.NVarChar, "transfer")
        .input("userID",    sql.Int,      userID)
        .input("notes",     sql.NVarChar, notes || null)
        .query(`
          INSERT INTO [dbo].[QueueTicketHistory]
            (QueueTicketID, OldStatus, NewStatus, ActionType, ActionByUserID, Notes)
          VALUES (@ticketId, @oldStatus, @newStatus, @action, @userID, @notes)
        `);

      return NextResponse.json({ ok: true });
    }

    const newStatus = action;
    const allowed = STATUS_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(newStatus))
      return NextResponse.json({
        error: `لا يمكن تغيير الحالة من "${currentStatus}" إلى "${newStatus}"`,
      }, { status: 400 });

    const now = "GETDATE()";
    const timeFields: Record<string, string> = {
      called:     "CalledAt",
      arrived:    "ArrivedAt",
      in_service: "ServiceStartedAt",
      done:       "ServiceEndedAt",
      cancelled:  "CancelledAt",
    };
    const timeCol = timeFields[newStatus];
    const timeUpdate = timeCol ? `, ${timeCol} = ${now}` : "";

    await db.request()
      .input("status",   sql.NVarChar, newStatus)
      .input("notes",    sql.NVarChar, notes || null)
      .input("ticketId", sql.Int,      ticketId)
      .query(`
        UPDATE [dbo].[QueueTickets]
        SET Status = @status, Notes = ISNULL(@notes, Notes)${timeUpdate}
        WHERE QueueTicketID = @ticketId
      `);

    await db.request()
      .input("ticketId",  sql.Int,      ticketId)
      .input("oldStatus", sql.NVarChar, currentStatus)
      .input("newStatus", sql.NVarChar, newStatus)
      .input("action",    sql.NVarChar, ACTION_MAP[newStatus] || newStatus)
      .input("userID",    sql.Int,      userID)
      .input("notes",     sql.NVarChar, notes || null)
      .query(`
        INSERT INTO [dbo].[QueueTicketHistory]
          (QueueTicketID, OldStatus, NewStatus, ActionType, ActionByUserID, Notes)
        VALUES (@ticketId, @oldStatus, @newStatus, @action, @userID, @notes)
      `);

    // Sync Booking.Status when the linked booking-queue ticket advances
    const BOOKING_STATUS_MAP: Partial<Record<string, string>> = {
      in_service: 'in_service',
      done:       'completed',
      cancelled:  'cancelled',
    };
    const targetBookingStatus = BOOKING_STATUS_MAP[newStatus];
    if (targetBookingStatus) {
      const ticketBooking = await db.request()
        .input("id", sql.Int, ticketId)
        .query(`SELECT BookingID FROM [dbo].[QueueTickets] WHERE QueueTicketID = @id`);
      const bookingId = ticketBooking.recordset[0]?.BookingID;
      if (bookingId) {
        await db.request()
          .input("bid",    sql.Int,      bookingId)
          .input("status", sql.NVarChar, targetBookingStatus)
          .query(`
            UPDATE [dbo].[Bookings]
            SET Status = @status, UpdatedAt = GETDATE()
            WHERE BookingID = @bid
              AND Status NOT IN ('completed','cancelled')
          `)
          .catch(e => console.error('[queue PATCH] booking sync failed:', e));
      }
    }

    return NextResponse.json({ ok: true, newStatus });
  } catch (err) {
    console.error("[queue PATCH id]", err);
    return NextResponse.json({ error: "فشل تحديث الحالة" }, { status: 500 });
  }
}
