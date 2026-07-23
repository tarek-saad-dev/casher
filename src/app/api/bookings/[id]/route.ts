import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { getSession } from "@/lib/session";
import { checkBarberAvailableForBooking, buildBookingIntervals, buildQueueIntervals } from "@/lib/queueEstimateEngine";
import { normalizeBookingTimes } from "@/lib/bookingDateTime";
import { requireActiveBranchContext, isActiveBranchContext } from "@/lib/branch/context";
import {
  assertBookingOwnedByActiveBranch,
  bookingQueueNotFoundResponse,
} from "@/lib/branch/bookingQueueOwnership";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/bookings/[id]
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const { id } = await context.params;
    const db = await getPool();

    const bkRes = await db.request()
      .input("id", sql.Int, parseInt(id))
      .query(`
        SELECT
          b.BookingID, b.BookingCode, b.ClientID, b.AssignedEmpID,
          b.BookingDate, b.StartTime, b.EndTime, b.Status, b.Source,
          b.Notes, b.QueueTicketID, b.CreatedAt, b.UpdatedAt, b.BranchID,
          c.[Name] AS ClientName, c.Mobile AS ClientMobile, e.EmpName,
          COALESCE(SUM(bs.DurationMinutes), 30) AS TotalDuration
        FROM [dbo].[Bookings] b
        LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
        LEFT JOIN [dbo].[TblEmp]    e ON e.EmpID    = b.AssignedEmpID
        LEFT JOIN [dbo].[BookingServices] bs ON bs.BookingID = b.BookingID
        WHERE b.BookingID = @id
        GROUP BY
          b.BookingID, b.BookingCode, b.ClientID, b.AssignedEmpID,
          b.BookingDate, b.StartTime, b.EndTime, b.Status, b.Source,
          b.Notes, b.QueueTicketID, b.CreatedAt, b.UpdatedAt, b.BranchID,
          c.[Name], c.Mobile, e.EmpName
      `);

    if (!bkRes.recordset.length)
      return NextResponse.json({ error: "حجز غير موجود" }, { status: 404 });

    const booking = bkRes.recordset[0];

    if (!assertBookingOwnedByActiveBranch(branch.branchId, booking.BranchID)) {
      return bookingQueueNotFoundResponse();
    }

    const svcRes = await db.request()
      .input("id", sql.Int, parseInt(id))
      .query(`
        SELECT bs.*, p.ProName, e.EmpName
        FROM [dbo].[BookingServices] bs
        LEFT JOIN [dbo].[TblPro] p ON p.ProID  = bs.ProID
        LEFT JOIN [dbo].[TblEmp] e ON e.EmpID  = bs.EmpID
        WHERE bs.BookingID = @id
      `);

    // Calculate total duration from services
    const services = svcRes.recordset;
    const totalDurationMinutes = services.reduce(
      (sum, s) => sum + (s.DurationMinutes || 30),
      0
    ) || 30;

    // Normalize booking times to Cairo timezone
    const normalizedTimes = normalizeBookingTimes(
      booking.BookingDate,
      booking.StartTime,
      booking.EndTime,
      totalDurationMinutes,
      booking.BookingID
    );

    // Build enriched booking object with normalized times
    const enrichedBooking = {
      ...booking,
      // Normalized Cairo datetime fields
      startDateTimeCairo: normalizedTimes.startDateTimeCairo,
      endDateTimeCairo: normalizedTimes.endDateTimeCairo,
      startTimeDisplay: normalizedTimes.startTimeDisplay,
      endTimeDisplay: normalizedTimes.endTimeDisplay,
      dateDisplay: normalizedTimes.dateDisplay,
      durationMinutes: normalizedTimes.durationMinutes,
      // Raw values for debugging
      _rawStartTime: normalizedTimes._rawStartTime,
      _rawEndTime: normalizedTimes._rawEndTime,
      _rawBookingDate: normalizedTimes._rawBookingDate,
    };

    return NextResponse.json({
      booking: enrichedBooking,
      services,
    });
  } catch (err) {
    console.error("[bookings GET id]", err);
    return NextResponse.json({ error: "فشل تحميل الحجز" }, { status: 500 });
  }
}

// PATCH /api/bookings/[id]
export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const { id } = await context.params;
    const session = await getSession();
    const userID  = session?.UserID ?? 0;
    const bookingId = parseInt(id);
    const body = await req.json();
    // Note: body.branchId, if present, is ignored — branch is always the active session branch.
    const { action, notes, cancelReason, rescheduleDate, rescheduleTime, empId } = body;

    console.log("[PATCH bookings] Received request:", { bookingId, action, body });

    const db = await getPool();

    const cur = await db.request()
      .input("id", sql.Int, bookingId)
      .query(`SELECT Status, BranchID FROM [dbo].[Bookings] WHERE BookingID = @id`);
    if (!cur.recordset.length)
      return NextResponse.json({ error: "حجز غير موجود" }, { status: 404 });

    if (!assertBookingOwnedByActiveBranch(branch.branchId, cur.recordset[0].BranchID)) {
      return bookingQueueNotFoundResponse();
    }

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

      case "restore": {
        try {
          // Only cancelled bookings can be restored
          if (currentStatus !== 'cancelled' && currentStatus !== 'canceled') {
            return NextResponse.json({ error: "لا يمكن إرجاع الحجز - الحالة الحالية غير ملغية" }, { status: 400 });
          }

          // Get full booking details for conflict check
          const bookingRes = await db.request()
            .input("id", sql.Int, bookingId)
            .query(`
              SELECT AssignedEmpID, BookingDate, StartTime, EndTime
              FROM [dbo].[Bookings]
              WHERE BookingID = @id
            `);
          
          const booking = bookingRes.recordset[0];
          if (!booking) {
            return NextResponse.json({ error: "حجز غير موجود" }, { status: 404 });
          }

          // Check for conflicts using the same logic as new bookings
          if (booking.AssignedEmpID && booking.BookingDate && booking.StartTime) {
            // Handle BookingDate as Date object or string
            let dateStr: string;
            if (booking.BookingDate instanceof Date) {
              dateStr = booking.BookingDate.toISOString().split('T')[0];
            } else if (typeof booking.BookingDate === 'string') {
              dateStr = booking.BookingDate.split('T')[0];
            } else {
              dateStr = String(booking.BookingDate);
            }
            
            // Handle StartTime - extract HH:MM
            let timeStr: string;
            if (booking.StartTime instanceof Date) {
              timeStr = booking.StartTime.toISOString().split('T')[1].slice(0, 5);
            } else if (typeof booking.StartTime === 'string') {
              timeStr = booking.StartTime.slice(0, 5);
            } else {
              timeStr = String(booking.StartTime);
            }
            
            const bookingStart = new Date(`${dateStr}T${timeStr}`);
            
            console.log("[restore] Parsed date:", dateStr, "time:", timeStr, "bookingStart:", bookingStart.toISOString());
            
            // Get service IDs for this booking
            const servicesRes = await db.request()
              .input("id", sql.Int, bookingId)
              .query(`SELECT ProID FROM [dbo].[BookingServices] WHERE BookingID = @id`);
            
            const serviceIds = servicesRes.recordset.map((s: { ProID: number }) => s.ProID).filter(Boolean);
            
            console.log("[restore] Checking availability for empId:", booking.AssignedEmpID, "date:", dateStr, "services:", serviceIds);
            
            // Check for actual booking conflicts only (skip working hours check)
            // The booking was already accepted before, so we only care if someone else took the slot
            let hasConflict = false;
            try {
              // Build intervals for existing bookings and queue on this date
              const now = new Date();
              const [bIntervals, qIntervals] = await Promise.all([
                buildBookingIntervals(db, booking.AssignedEmpID, dateStr, 30),
                buildQueueIntervals(db, booking.AssignedEmpID, dateStr, now, 30, undefined, {
                  filterStale: true, graceMinutes: 30, debugContext: "booking-restore"
                }),
              ]);
              
              // Calculate booking end time (need service duration)
              const servicesRes = await db.request()
                .input("ids", sql.VarChar, serviceIds.join(','))
                .query(`
                  SELECT COALESCE(SUM(DurationMinutes), 30) as totalDuration 
                  FROM [dbo].[TblServices] 
                  WHERE ProID IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
                `);
              const durationMinutes = servicesRes.recordset[0]?.totalDuration || 30;
              const bookingEnd = new Date(bookingStart.getTime() + durationMinutes * 60000);
              
              console.log("[restore] Checking conflicts for:", bookingStart.toISOString(), "to", bookingEnd.toISOString());
              console.log("[restore] Booking intervals:", bIntervals.length, "Queue intervals:", qIntervals.length);
              
              // Check for any overlapping intervals (excluding this booking itself)
              const allIntervals = [...bIntervals, ...qIntervals];
              for (const iv of allIntervals) {
                // Skip if this is the same booking being restored
                if (iv.source === 'booking' && iv.id === bookingId) continue;
                
                // Check for overlap: [start, end) overlaps with [iv.start, iv.end)
                if (bookingStart < iv.end && bookingEnd > iv.start) {
                  console.log("[restore] Conflict found with", iv.source, "id:", iv.id);
                  hasConflict = true;
                  break;
                }
              }
            } catch (conflictErr) {
              console.error("[restore] Error checking conflicts:", conflictErr);
              // If conflict check fails, log it but don't block restore
              hasConflict = false;
            }
            
            if (hasConflict) {
              return NextResponse.json({ 
                error: "لا يمكن إرجاع الحجز لأن الموعد أصبح محجوزًا بالفعل.",
                conflict: true 
              }, { status: 409 });
            }
            
            console.log("[restore] No conflicts found, proceeding with restore");
          }

          // Restore booking to confirmed status
          const updateResult = await db.request()
            .input("id", sql.Int, bookingId)
            .query(`
              UPDATE [dbo].[Bookings]
              SET Status='confirmed', CancelReason=NULL, CancelledAt=NULL, UpdatedAt=GETDATE()
              WHERE BookingID=@id;
              SELECT @@ROWCOUNT as affectedRows;
            `);
          
          console.log("[restore] Update result:", updateResult.recordset);
          console.log("[restore] Booking restored successfully:", bookingId);
          break;
        } catch (restoreErr) {
          console.error("[restore] Error during restore:", restoreErr);
          throw restoreErr; // Re-throw to be caught by outer catch
        }
      }

      default:
        return NextResponse.json({ error: `إجراء غير معروف: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, action, previousStatus: currentStatus });
  } catch (err) {
    console.error("[bookings PATCH id] Error:", err);
    // Log detailed error for debugging
    if (err instanceof Error) {
      console.error("[bookings PATCH id] Error message:", err.message);
      console.error("[bookings PATCH id] Error stack:", err.stack);
    }
    return NextResponse.json({ error: "فشل تحديث الحجز" }, { status: 500 });
  }
}
