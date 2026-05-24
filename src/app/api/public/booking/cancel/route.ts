/**
 * POST /api/public/booking/cancel
 * Cancel a booking (customer can cancel their own booking)
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";

const MIN_CANCEL_MINUTES = 30; // Configurable: must cancel 30 min before

function normalizePhone(phone: string): string {
  return phone.trim().replace(/\s+/g, "").replace(/^\+20/, "0");
}

export async function POST(req: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";

  try {
    const body = await req.json();
    const { bookingId, phone } = body;

    // Validation
    if (!bookingId || typeof bookingId !== "number") {
      return NextResponse.json(
        { ok: false, error: "Booking ID is required" },
        { status: 400 },
      );
    }

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

    // Get booking details
    const bookingResult = await db.request().input("bookingId", bookingId)
      .query(`
        SELECT
          b.BookingID,
          b.Phone,
          b.Status,
          CONVERT(VARCHAR(10), b.BookingDate, 120) AS BookingDate,
          CONVERT(VARCHAR(5), b.BookingTime, 108) AS BookingTime
        FROM TblBooking b
        WHERE b.BookingID = @bookingId
      `);

    const booking = bookingResult.recordset[0];

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "Booking not found" },
        { status: 404 },
      );
    }

    // Verify phone matches
    if (normalizePhone(booking.Phone) !== normalizedPhone) {
      if (isDev) {
        console.log("[cancel] phone mismatch:", {
          provided: normalizedPhone,
          bookingPhone: normalizePhone(booking.Phone),
        });
      }
      return NextResponse.json(
        {
          ok: false,
          error: "Unauthorized: Phone number does not match booking",
        },
        { status: 403 },
      );
    }

    // Check if already cancelled
    if (booking.Status === "Cancelled" || booking.Status === "Canceled") {
      return NextResponse.json(
        { ok: false, error: "Booking is already cancelled" },
        { status: 400 },
      );
    }

    // Check if already completed
    if (booking.Status === "Completed") {
      return NextResponse.json(
        { ok: false, error: "Cannot cancel completed booking" },
        { status: 400 },
      );
    }

    // Check cancellation window (30 min before)
    const bookingDateTime = new Date(
      `${booking.BookingDate}T${booking.BookingTime}`,
    );
    const now = new Date();
    const minutesUntilBooking =
      (bookingDateTime.getTime() - now.getTime()) / (1000 * 60);

    if (minutesUntilBooking < MIN_CANCEL_MINUTES) {
      return NextResponse.json(
        {
          ok: false,
          error: `Cannot cancel less than ${MIN_CANCEL_MINUTES} minutes before appointment`,
          minutesUntilBooking: Math.floor(minutesUntilBooking),
        },
        { status: 400 },
      );
    }

    // Update booking status
    await db.request().input("bookingId", bookingId).query(`
        UPDATE TblBooking
        SET 
          Status = 'Cancelled',
          CancelledAt = GETDATE(),
          CancelReason = 'Cancelled by customer'
        WHERE BookingID = @bookingId
      `);

    if (isDev) {
      console.log("[cancel] success:", { bookingId, phone: normalizedPhone });
    }

    return NextResponse.json({
      ok: true,
      message: "Booking cancelled successfully",
    });
  } catch (err: unknown) {
    console.error("[cancel] error:", err);
    return NextResponse.json(
      { ok: false, error: "Failed to cancel booking" },
      { status: 500 },
    );
  }
}
