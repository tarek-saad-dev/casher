import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/bookings/[id]
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const db = await getPool();

    const bkRes = await db.request()
      .input("id", sql.Int, parseInt(id))
      .query(`
        SELECT b.*, c.[Name] AS ClientName, c.Mobile AS ClientMobile, e.EmpName
        FROM [dbo].[Bookings] b
        LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
        LEFT JOIN [dbo].[TblEmp]    e ON e.EmpID    = b.AssignedEmpID
        WHERE b.BookingID = @id
      `);

    if (!bkRes.recordset.length)
      return NextResponse.json({ error: "حجز غير موجود" }, { status: 404 });

    const svcRes = await db.request()
      .input("id", sql.Int, parseInt(id))
      .query(`
        SELECT bs.*, p.ProName, e.EmpName
        FROM [dbo].[BookingServices] bs
        LEFT JOIN [dbo].[TblPro] p ON p.ProID  = bs.ProID
        LEFT JOIN [dbo].[TblEmp] e ON e.EmpID  = bs.EmpID
        WHERE bs.BookingID = @id
      `);

    return NextResponse.json({
      booking: bkRes.recordset[0],
      services: svcRes.recordset,
    });
  } catch (err) {
    console.error("[bookings GET id]", err);
    return NextResponse.json({ error: "فشل تحميل الحجز" }, { status: 500 });
  }
}

// PATCH /api/bookings/[id]
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const session = await getSession();
    const userID  = session?.UserID ?? 0;
    const bookingId = parseInt(id);
    const body = await req.json();
    const { action, notes, cancelReason, rescheduleDate, rescheduleTime, empId } = body;

    const db = await getPool();

    const cur = await db.request()
      .input("id", sql.Int, bookingId)
      .query(`SELECT Status FROM [dbo].[Bookings] WHERE BookingID = @id`);
    if (!cur.recordset.length)
      return NextResponse.json({ error: "حجز غير موجود" }, { status: 404 });

    const currentStatus = cur.recordset[0].Status;

    switch (action) {
      case "confirm":
        await db.request()
          .input("id", sql.Int, bookingId)
          .query(`UPDATE [dbo].[Bookings] SET Status='confirmed', UpdatedAt=GETDATE() WHERE BookingID=@id`);
        break;

      case "arrive":
        await db.request()
          .input("id", sql.Int, bookingId)
          .query(`UPDATE [dbo].[Bookings] SET Status='arrived', UpdatedAt=GETDATE() WHERE BookingID=@id`);
        break;

      case "queue":
        await db.request()
          .input("id", sql.Int, bookingId)
          .query(`UPDATE [dbo].[Bookings] SET Status='queued', UpdatedAt=GETDATE() WHERE BookingID=@id`);
        break;

      case "start_service":
        await db.request()
          .input("id", sql.Int, bookingId)
          .query(`UPDATE [dbo].[Bookings] SET Status='in_service', UpdatedAt=GETDATE() WHERE BookingID=@id`);
        break;

      case "complete":
        await db.request()
          .input("id", sql.Int, bookingId)
          .query(`UPDATE [dbo].[Bookings] SET Status='completed', UpdatedAt=GETDATE() WHERE BookingID=@id`);
        break;

      case "cancel":
        await db.request()
          .input("id",     sql.Int,      bookingId)
          .input("reason", sql.NVarChar, cancelReason || null)
          .query(`
            UPDATE [dbo].[Bookings]
            SET Status='cancelled', CancelReason=@reason, CancelledAt=GETDATE(), UpdatedAt=GETDATE()
            WHERE BookingID=@id
          `);
        break;

      case "no_show":
        await db.request()
          .input("id", sql.Int, bookingId)
          .query(`UPDATE [dbo].[Bookings] SET Status='no_show', UpdatedAt=GETDATE() WHERE BookingID=@id`);
        break;

      case "reschedule":
        if (!rescheduleDate || !rescheduleTime)
          return NextResponse.json({ error: "يجب تحديد التاريخ والوقت الجديد" }, { status: 400 });
        await db.request()
          .input("id",     sql.Int,     bookingId)
          .input("bDate",  sql.Date,    rescheduleDate)
          .input("sTime",  sql.VarChar, rescheduleTime)
          .input("empId",  sql.Int,     empId || null)
          .query(`
            UPDATE [dbo].[Bookings]
            SET Status='rescheduled', BookingDate=@bDate, StartTime=@sTime,
                AssignedEmpID=ISNULL(@empId, AssignedEmpID), UpdatedAt=GETDATE()
            WHERE BookingID=@id
          `);
        break;

      default:
        return NextResponse.json({ error: `إجراء غير معروف: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, action, previousStatus: currentStatus });
  } catch (err) {
    console.error("[bookings PATCH id]", err);
    return NextResponse.json({ error: "فشل تحديث الحجز" }, { status: 500 });
  }
}
