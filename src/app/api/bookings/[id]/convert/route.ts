import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/bookings/[id]/convert — convert booking to invoice
export async function POST(req: NextRequest, context: RouteContext) {
  try {
    const { id } = await context.params;
    const session  = await getSession();
    const userID   = session?.UserID ?? 0;
    const bookingId = parseInt(id);
    const body = await req.json();
    const { paymentMethodId, notes: invNotes } = body;

    const db = await getPool();

    // Load booking
    const bkRes = await db.request()
      .input("id", sql.Int, bookingId)
      .query(`
        SELECT b.*
        FROM [dbo].[Bookings] b
        WHERE b.BookingID = @id
      `);
    if (!bkRes.recordset.length)
      return NextResponse.json({ error: "حجز غير موجود" }, { status: 404 });

    const booking = bkRes.recordset[0];
    if (booking.ConvertedInvID)
      return NextResponse.json({ error: "تم تحويل هذا الحجز مسبقاً إلى فاتورة" }, { status: 409 });

    // Load services
    const svcRes = await db.request()
      .input("id", sql.Int, bookingId)
      .query(`SELECT * FROM [dbo].[BookingServices] WHERE BookingID = @id`);
    const services = svcRes.recordset;

    if (!services.length)
      return NextResponse.json({ error: "لا توجد خدمات لتحويلها" }, { status: 400 });

    // Enforce active business day
    const dayRes = await db.request().query(
      `SELECT TOP 1 ID, NewDay FROM [dbo].[TblNewDay] WHERE Status=1 ORDER BY ID DESC`
    );
    if (!dayRes.recordset.length)
      return NextResponse.json({ error: "لا يوجد يوم عمل مفتوح" }, { status: 400 });
    const activeDay = dayRes.recordset[0];
    const invDate = activeDay.NewDay;

    // Enforce active shift
    const shiftRes = await db.request()
      .input("uid", sql.Int, userID)
      .query(`
        SELECT TOP 1 ID FROM [dbo].[TblShiftMove]
        WHERE Status=1 AND UserID=@uid ORDER BY ID DESC
      `);
    if (!shiftRes.recordset.length)
      return NextResponse.json({ error: "لا يوجد وردية مفتوحة" }, { status: 400 });
    const shiftMoveID = shiftRes.recordset[0].ID;

    // Get next invID
    const invTypeConv = "خدمة";
    const nextInvRes = await db.request()
      .input("invType", sql.NVarChar, invTypeConv)
      .query(`
        SELECT ISNULL(MAX(invID), 0) + 1 AS NextInvID
        FROM [dbo].[TblinvServHead]
        WHERE invType = @invType
      `);
    const newInvID = nextInvRes.recordset[0].NextInvID;

    // Calculate total
    const total = services.reduce((sum: number, s: { Price: number; Qty: number }) => sum + (s.Price * s.Qty), 0);

    // --- Transaction ---
    const transaction = new (await import("mssql")).Transaction(db as never);
    await transaction.begin();
    try {
      const tr = transaction.request();

      const now = new Date();
      const invTime = `${String(now.getHours()).padStart(2,'0')}.${String(now.getMinutes()).padStart(2,'0')}`;

      // Insert TblinvServHead — matches exact column set from sales API
      await tr
        .input("invID",      sql.Int,           newInvID)
        .input("invType",    sql.NVarChar(20),   invTypeConv)
        .input("invDate",    sql.Date,            invDate)
        .input("invTime",    sql.NVarChar(50),    invTime)
        .input("clientId",   sql.Int,             booking.ClientID || null)
        .input("userID",     sql.Int,             userID)
        .input("totalQty",   sql.Decimal(10,2),   services.reduce((s: number, sv: { Qty: number }) => s + sv.Qty, 0))
        .input("subTotal",   sql.Decimal(10,2),   total)
        .input("grandTotal", sql.Decimal(10,2),   total)
        .input("shift",      sql.Int,             shiftMoveID)
        .input("pmID",       sql.Int,             paymentMethodId || null)
        .input("notes",      sql.NVarChar(100),   (invNotes || 'حجز').substring(0, 100))
        .input("invNotes",   sql.NVarChar(50),    (invNotes || 'حجز').substring(0, 50))
        .query(`
          INSERT INTO [dbo].[TblinvServHead] (
            invID, invType, invDate, invTime, ClientID, UserID,
            TotalQty, SubTotal, Dis, DisVal, Tax, TaxVal, GrandTotal,
            invNotes, TotalBonus, ShiftMoveID,
            ReservDate, ReservTime, Notes,
            PayCash, PayVisa, isActive, Notes2, Payment, PayDue, PaymentMethodID
          ) VALUES (
            @invID, @invType, @invDate, @invTime, @clientId, @userID,
            @totalQty, @subTotal, 0, 0, 0, 0, @grandTotal,
            @invNotes, 0, @shift,
            NULL, NULL, @notes,
            0, 0, 'no', '', @grandTotal, 0, @pmID
          )
        `);

      // Insert TblinvServDetail
      for (const svc of services) {
        const svcTr = transaction.request();
        const sPrice = svc.Price || 0;
        const qty    = svc.Qty   || 1;
        await svcTr
          .input("invID",           sql.Int,           newInvID)
          .input("invType",         sql.NVarChar(20),  invTypeConv)
          .input("empId",           sql.Int,            svc.EmpID || booking.AssignedEmpID || null)
          .input("proId",           sql.Int,            svc.ProID || null)
          .input("qty",             sql.Decimal(8,2),   qty)
          .input("price",           sql.Decimal(10,2),  sPrice)
          .input("value",           sql.Decimal(10,2),  sPrice * qty)
          .input("priceAfterDis",   sql.Decimal(10,2),  sPrice)
          .input("rDate",           sql.Date,            booking.BookingDate)
          .query(`
            INSERT INTO [dbo].[TblinvServDetail] (
              invID, invType, EmpID, ProID,
              Dis, DisVal, SPrice, SValue, SPriceAfterDis,
              PPrice, PValue, Qty, ProType, Notes, Bonus, ReservDate
            ) VALUES (
              @invID, @invType, @empId, @proId,
              0, 0, @price, @value, @priceAfterDis,
              0, 0, @qty, NULL, '', 0, @rDate
            )
          `);
      }

      // Mark booking as completed + store converted invID
      const updTr = transaction.request();
      await updTr
        .input("id",          sql.Int,      bookingId)
        .input("convInvID",   sql.Int,      newInvID)
        .input("convInvType", sql.NVarChar, invTypeConv)
        .query(`
          UPDATE [dbo].[Bookings]
          SET Status='completed', ConvertedInvID=@convInvID,
              ConvertedInvType=@convInvType, UpdatedAt=GETDATE()
          WHERE BookingID=@id
        `);

      await transaction.commit();
    } catch (txErr) {
      await transaction.rollback();
      throw txErr;
    }

    return NextResponse.json({ ok: true, invoiceId: newInvID, invoiceType: invTypeConv });
  } catch (err) {
    console.error("[bookings convert POST]", err);
    return NextResponse.json({ error: "فشل تحويل الحجز إلى فاتورة" }, { status: 500 });
  }
}
