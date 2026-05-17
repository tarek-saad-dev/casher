import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { checkBarberAvailableForBooking } from "@/lib/queueEstimateEngine";

export const runtime = "nodejs";

// GET /api/bookings?date=&dateFrom=&dateTo=&empId=&status=&source=&clientSearch=
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const date       = searchParams.get("date");
    const dateFrom   = searchParams.get("dateFrom");
    const dateTo     = searchParams.get("dateTo");
    const empId      = searchParams.get("empId");
    const status     = searchParams.get("status");
    const source     = searchParams.get("source");
    const clientSrch = searchParams.get("clientSearch");

    const db = await getPool();
    const request = db.request();
    const conditions: string[] = [];

    if (date) {
      request.input("date", sql.Date, date);
      conditions.push("b.BookingDate = @date");
    } else {
      if (dateFrom) { request.input("df", sql.Date, dateFrom); conditions.push("b.BookingDate >= @df"); }
      if (dateTo)   { request.input("dt", sql.Date, dateTo);   conditions.push("b.BookingDate <= @dt"); }
    }
    if (empId)  { request.input("empId",  sql.Int,     parseInt(empId));  conditions.push("b.AssignedEmpID = @empId");  }
    if (status && status !== "all") { request.input("status", sql.NVarChar, status); conditions.push("b.Status = @status"); }
    if (source && source !== "all") { request.input("source", sql.NVarChar, source); conditions.push("b.Source = @source"); }
    if (clientSrch) {
      request.input("srch", sql.NVarChar, `%${clientSrch}%`);
      conditions.push("(c.[Name] LIKE @srch OR c.Mobile LIKE @srch)");
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await request.query(`
      SELECT
        b.BookingID, b.ClientID, b.AssignedEmpID, b.BookingDate,
        b.StartTime, b.EndTime, b.Status, b.Source, b.Notes,
        b.QueueTicketID, b.OldInvID, b.OldInvType,
        b.ConvertedInvID, b.ConvertedInvType,
        b.CreatedAt, b.UpdatedAt, b.CancelledAt, b.CancelReason,
        c.[Name] AS ClientName, c.Mobile AS ClientMobile,
        e.EmpName,
        (SELECT COUNT(*)
         FROM [dbo].[BookingServices] bs
         WHERE bs.BookingID = b.BookingID) AS ServiceCount
      FROM [dbo].[Bookings] b
      LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
      LEFT JOIN [dbo].[TblEmp]    e ON e.EmpID    = b.AssignedEmpID
      ${where}
      ORDER BY b.BookingDate ASC, b.StartTime ASC
    `);

    return NextResponse.json({ bookings: result.recordset });
  } catch (err) {
    console.error("[bookings GET]", err);
    return NextResponse.json({ error: "فشل تحميل الحجوزات" }, { status: 500 });
  }
}

// POST /api/bookings
export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    const userID = session?.UserID ?? 0;
    const body = await req.json();

    const {
      clientId, empId, bookingDate, startTime, endTime,
      source = "phone", notes, services = [],
    } = body;

    if (!bookingDate || !startTime)
      return NextResponse.json({ error: "التاريخ والوقت مطلوبان" }, { status: 400 });

    const db = await getPool();

    // ── Server-side availability check using shared timeline engine ─────────
    // Validates both booking conflicts AND queue ticket conflicts
    if (empId && bookingDate && startTime) {
      const bookingStart = new Date(`${bookingDate}T${startTime}`);
      const serviceIds: number[] = (services as Array<{ proId?: number }>)
        .map(s => s.proId).filter((id): id is number => !!id);
      const availCheck = await checkBarberAvailableForBooking(empId, '', bookingStart, serviceIds);
      if (!availCheck.available) {
        return NextResponse.json({
          error:               availCheck.reason ?? 'الحلاق غير متاح في هذا الوقت',
          conflictType:        availCheck.conflictType,
          suggestedStartTime:  availCheck.suggestedStartTime,
          conflictingTickets:  availCheck.conflictingTickets,
          conflictingBookings: availCheck.conflictingBookings,
        }, { status: 409 });
      }
    }

    // Check double booking setting (legacy — kept for settings that allow double booking)
    const settingsRes = await db.request().query(
      `SELECT TOP 1 AllowDoubleBooking FROM [dbo].[QueueBookingSettings]`
    );
    const allowDouble = settingsRes.recordset[0]?.AllowDoubleBooking ?? 0;

    if (!allowDouble && empId && endTime) {
      const conflict = await db.request()
        .input("empId",  sql.Int,     empId)
        .input("bDate",  sql.Date,    bookingDate)
        .input("sTime",  sql.VarChar, startTime)
        .input("eTime",  sql.VarChar, endTime)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM [dbo].[Bookings]
          WHERE AssignedEmpID = @empId
            AND BookingDate   = @bDate
            AND Status NOT IN ('cancelled', 'no_show', 'rescheduled')
            AND StartTime < @eTime
            AND ISNULL(EndTime, @sTime) > @sTime
        `);
      if (conflict.recordset[0].cnt > 0)
        return NextResponse.json({ error: "يوجد حجز متعارض لهذا الحلاق في نفس الوقت" }, { status: 409 });
    }

    // Insert booking
    const insertRes = await db.request()
      .input("clientId",  sql.Int,      clientId || null)
      .input("empId",     sql.Int,      empId    || null)
      .input("bDate",     sql.Date,     bookingDate)
      .input("sTime",     sql.VarChar,  startTime)
      .input("eTime",     sql.VarChar,  endTime   || null)
      .input("source",    sql.NVarChar, source)
      .input("notes",     sql.NVarChar, notes     || null)
      .input("userID",    sql.Int,      userID)
      .query(`
        INSERT INTO [dbo].[Bookings]
          (ClientID, AssignedEmpID, BookingDate, StartTime, EndTime,
           Status, Source, Notes, CreatedByUserID)
        OUTPUT INSERTED.BookingID
        VALUES
          (@clientId, @empId, @bDate, @sTime, @eTime,
           'pending', @source, @notes, @userID)
      `);

    const bookingId = insertRes.recordset[0].BookingID;

    // Insert services
    for (const svc of services) {
      await db.request()
        .input("bId",    sql.Int,         bookingId)
        .input("proId",  sql.Int,         svc.proId  || null)
        .input("eId",    sql.Int,         svc.empId  || empId || null)
        .input("qty",    sql.Decimal,     svc.qty    || 1)
        .input("price",  sql.Decimal,     svc.price  || 0)
        .input("mins",   sql.Int,         svc.durationMinutes || null)
        .input("notes",  sql.NVarChar,    svc.notes  || null)
        .query(`
          INSERT INTO [dbo].[BookingServices]
            (BookingID, ProID, EmpID, Qty, Price, DurationMinutes, Notes)
          VALUES (@bId, @proId, @eId, @qty, @price, @mins, @notes)
        `);
    }

    return NextResponse.json({ bookingId }, { status: 201 });
  } catch (err) {
    console.error("[bookings POST]", err);
    return NextResponse.json({ error: "فشل إنشاء الحجز" }, { status: 500 });
  }
}
