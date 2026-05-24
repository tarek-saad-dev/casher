/**
 * POST /api/public/booking/upcoming
 * Get upcoming bookings for a customer by phone number
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, "").replace(/^\+20/, "0");
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

    // Query upcoming bookings for this phone
    // Using SQL GETDATE() for server-side time comparison in Africa/Cairo
    const bookingsResult = await db.request().input("phone", normalizedPhone)
      .query(`
        SELECT
          b.BookingID AS id,
          b.CustomerName AS customerName,
          b.Phone AS phone,
          CONVERT(VARCHAR(10), b.BookingDate, 120) AS date,
          CONVERT(VARCHAR(5), b.BookingTime, 108) AS time,
          b.EmpID AS barberId,
          e.EmpName AS barberName,
          b.Status AS status,
          b.TotalPrice AS totalPrice,
          b.TotalDuration AS totalDuration
        FROM TblBooking b
        JOIN TblEmp e ON e.EmpID = b.EmpID
        WHERE b.Phone = @phone
          AND b.Status NOT IN ('Cancelled', 'Completed', 'Canceled')
          AND (
            b.BookingDate > CONVERT(DATE, GETDATE())
            OR (
              b.BookingDate = CONVERT(DATE, GETDATE())
              AND b.BookingTime >= CONVERT(TIME, GETDATE())
            )
          )
        ORDER BY b.BookingDate ASC, b.BookingTime ASC
      `);

    const bookings = bookingsResult.recordset;

    // Get services for each booking
    const bookingsWithServices = await Promise.all(
      bookings.map(async (booking: Record<string, unknown>) => {
        const servicesResult = await db.request().input("bookingId", booking.id)
          .query(`
            SELECT
              s.ServiceID AS id,
              s.ServiceName AS name,
              bs.Price AS price,
              s.DurationMinutes AS duration
            FROM BookingServices bs
            JOIN TblServices s ON s.ServiceID = bs.ServiceID
            WHERE bs.BookingID = @bookingId
          `);

        // Check if booking can be cancelled (configurable window)
        const minCancelMinutes = 30; // Configurable: 30 min before
        const bookingDateTime = new Date(`${booking.date}T${booking.time}`);
        const now = new Date();
        const canCancel =
          bookingDateTime.getTime() - now.getTime() >
          minCancelMinutes * 60 * 1000;

        return {
          id: booking.id,
          customerName: booking.customerName,
          phone: booking.phone,
          date: booking.date,
          time: booking.time,
          barberId: booking.barberId,
          barberName: booking.barberName,
          services: servicesResult.recordset.map(
            (s: Record<string, unknown>) => ({
              id: s.id,
              name: s.name,
              price: s.price,
              duration: s.duration,
            }),
          ),
          totalPrice: booking.totalPrice,
          totalDuration: booking.totalDuration,
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
  } catch (err) {
    console.error("[upcoming] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch bookings" },
      { status: 500 },
    );
  }
}
