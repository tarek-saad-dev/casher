/**
 * POST /api/operations/queue/[id]/cancel
 *
 * Cancels a queue ticket (soft cancel - updates status to 'cancelled')
 *
 * Request:
 * {
 *   reason?: string,
 *   cancelBooking?: boolean  // if true, also cancel related booking
 * }
 *
 * Response:
 * {
 *   ok: true,
 *   queueTicketId: number,
 *   status: "cancelled"
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { requireBranchOperationAccess, isActiveBranchContext } from "@/lib/branch/context";
import {
  assertBookingOwnedByActiveBranch,
  bookingQueueNotFoundResponse,
} from "@/lib/branch/bookingQueueOwnership";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const branch = await requireBranchOperationAccess();
    if (!isActiveBranchContext(branch)) return branch;

    const { id } = await context.params;
    const ticketId = parseInt(id);

    if (isNaN(ticketId)) {
      return NextResponse.json(
        { error: "معرف الدور غير صالح" },
        { status: 400 },
      );
    }

    const body = await req.json().catch(() => ({}));
    const { reason, cancelBooking = false } = body;

    // Get user session for audit
    let userId = 0;
    try {
      const session = await getSession();
      userId = session?.UserID ?? 0;
    } catch {
      // Session not required
    }

    const db = await getPool();

    // Check ticket exists and is not already cancelled/done
    const checkRes = await db
      .request()
      .input("ticketId", sql.Int, ticketId)
      .query(`
        SELECT
          QueueTicketID,
          TicketCode,
          Status,
          BookingID,
          EmpID,
          ClientID,
          BranchID
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

    if (!assertBookingOwnedByActiveBranch(branch.branchId, ticket.BranchID)) {
      return bookingQueueNotFoundResponse();
    }

    // Check if already in final state
    const finalStatuses = ['cancelled', 'done', 'completed', 'skipped', 'no_show'];
    if (finalStatuses.includes(ticket.Status?.toLowerCase())) {
      return NextResponse.json({
        ok: true,
        message: "الدور في حالة نهائية بالفعل",
        queueTicketId: ticketId,
        ticketCode: ticket.TicketCode,
        status: ticket.Status,
      });
    }

    // Don't allow cancelling in_service tickets without explicit override
    if (ticket.Status?.toLowerCase() === 'in_service') {
      return NextResponse.json(
        { error: "لا يمكن إلغاء دور قيد الخدمة - انهِ الخدمة أولاً" },
        { status: 409 },
      );
    }

    // Cancel the queue ticket
    await db.request()
      .input("ticketId", sql.Int, ticketId)
      .query(`
        UPDATE dbo.QueueTickets
        SET Status = 'cancelled',
            CancelledAt = GETDATE()
        WHERE QueueTicketID = @ticketId
      `);

    console.log("[queue/cancel] Ticket cancelled:", {
      ticketId,
      ticketCode: ticket.TicketCode,
      reason,
      userId,
    });

    // Optionally cancel related booking
    let bookingCancelled = false;
    if (cancelBooking && ticket.BookingID) {
      try {
        await db.request()
          .input("bookingId", sql.Int, ticket.BookingID)
          .input("reason", sql.NVarChar, reason ? `Queue cancelled: ${reason}` : "Queue ticket cancelled")
          .query(`
            UPDATE dbo.Bookings
            SET Status = 'cancelled',
                CancelledAt = GETDATE(),
                CancelReason = @reason
            WHERE BookingID = @bookingId
              AND Status NOT IN ('completed', 'cancelled', 'no_show')
          `);
        bookingCancelled = true;
        console.log("[queue/cancel] Related booking cancelled:", ticket.BookingID);
      } catch (bookingErr) {
        console.warn("[queue/cancel] Failed to cancel related booking:", bookingErr);
      }
    }

    return NextResponse.json({
      ok: true,
      message: "تم إلغاء الدور بنجاح",
      queueTicketId: ticketId,
      ticketCode: ticket.TicketCode,
      status: "cancelled",
      bookingCancelled,
    });
  } catch (err) {
    console.error("[queue/cancel] error:", err);
    return NextResponse.json(
      { error: "فشل إلغاء الدور" },
      { status: 500 },
    );
  }
}
