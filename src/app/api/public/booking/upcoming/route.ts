/**
 * POST /api/public/booking/upcoming
 * Get upcoming bookings for a customer by phone number
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const MIN_CANCEL_MINUTES = 30;
const SALON_TZ = "Africa/Cairo";

function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, "").replace(/^\+20/, "0");
}

function getCairoNow() {
  return new Date().toLocaleString("en-US", { timeZone: SALON_TZ });
}

export async function POST(req: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";

  try {
    const body = await req.json();
    const phone = body.phone;

    // Validation
    if (!phone || typeof phone !== "string") {
      return NextResponse.json(
        { ok: false, error: "Phone number is required" },
        { status: 400 },
      );
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone || normalizedPhone.length < 10) {
      return NextResponse.json(
        { ok: false, error: "Invalid phone number" },
        { status: 400 },
      );
    }

    const db = await getPool();

    // Get Cairo timezone current date and time
    const cairoNow = getCairoNow();
    const today = cairoNow.split(",")[0]; // YYYY/MM/DD format
    const nowTime = cairoNow.split(",")[1]?.trim() || "";

    // Query upcoming bookings for this phone
    // Join with TblClient to get phone and name
    const bookingsResult = await db
      .request()
      .input("phone", normalizedPhone)
      .input("today", today)
      .input("nowTime", nowTime).query(`
        SELECT
          b.BookingID AS id,
          b.ClientID AS clientId,
          c.Name AS customerName,
          c.Mobile AS phone,
          CONVERT(VARCHAR(10), b.BookingDate, 120) AS [date],
          CONVERT(VARCHAR(5), b.StartTime, 108) AS [time],
          b.AssignedEmpID AS barberId,
          e.EmpName AS barberName,
          b.Status AS status,
          b.CancelledAt,
          b.CancelReason
        FROM dbo.Bookings b
        JOIN dbo.TblClient c ON c.ClientID = b.ClientID
        LEFT JOIN dbo.TblEmp e ON e.EmpID = b.AssignedEmpID
        WHERE c.Mobile = @phone
          AND b.Status NOT IN ('Cancelled', 'Completed')
          AND b.BookingDate >= CONVERT(DATE, @today)
          AND b.CancelledAt IS NULL
        ORDER BY b.BookingDate ASC, b.StartTime ASC
      `);

    const bookings = bookingsResult.recordset;

    if (bookings.length === 0) {
      return NextResponse.json({
        ok: true,
        bookings: [],
      });
    }

    // Get services and calculate totals for each booking
    const bookingsWithServices = await Promise.all(
      bookings.map(async (booking: Record<string, unknown>) => {
        // Get services for this booking
        const servicesResult = await db.request().input("bookingId", booking.id)
          .query(`
            SELECT
              bs.ServiceID AS id,
              s.Name AS name,
              bs.Price AS price,
              bs.DurationMinutes AS duration
            FROM dbo.BookingServices bs
            LEFT JOIN dbo.TblServices s ON s.ServiceID = bs.ServiceID
            WHERE bs.BookingID = @bookingId
          `);

        // Calculate totals from services
        const services = servicesResult.recordset;
        const totalPrice = services.reduce(
          (sum: number, s: Record<string, unknown>) =>
            sum + (Number(s.price) || 0),
          0,
        );
        const totalDuration = services.reduce(
          (sum: number, s: Record<string, unknown>) =>
            sum + (Number(s.duration) || 0),
          0,
        );

        // Check if booking can be cancelled (30 min before)
        const bookingDateStr = String(booking.date);
        const bookingTimeStr = String(booking.time);
        const bookingDateTime = new Date(`${bookingDateStr}T${bookingTimeStr}`);
        const now = new Date(cairoNow);
        const canCancel =
          bookingDateTime.getTime() - now.getTime() >
          MIN_CANCEL_MINUTES * 60 * 1000;

        return {
          id: booking.id,
          customerName: booking.customerName,
          phone: booking.phone,
          date: booking.date,
          time: booking.time,
          barberId: booking.barberId,
          barberName: booking.barberName,
          services: services.map((s: Record<string, unknown>) => ({
            id: s.id,
            name: s.name,
            price: s.price,
            duration: s.duration,
          })),
          totalPrice: totalPrice,
          totalDuration: totalDuration,
          status: booking.status,
          canCancel: canCancel,
        };
      }),
    );

    if (isDev) {
      console.log(
        "[upcoming] phone:",
        normalizedPhone,
        "bookings:",
        bookingsWithServices.length,
      );
    }

    return NextResponse.json({
      ok: true,
      bookings: bookingsWithServices,
    });
  } catch (err: unknown) {
    console.error("[upcoming] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch bookings" },
      { status: 500 },
    );
  }
}
