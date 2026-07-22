/**
 * Admin Diagnostic Endpoint: Full Availability Calculation for a Single Day
 *
 * GET /api/admin/booking-debug/day?date=2026-05-18&serviceIds=9
 *
 * Returns complete computed availability for all bookable barbers,
 * including working windows, blockers, and available/blocked slots.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { getPool, sql } from "@/lib/db";
import { getDefaultDuration, getServicesDuration } from "@/lib/queueEstimateEngine";

// Types
interface QueueTicket {
  QueueTicketID: number;
  EmpID: number;
  QueueDate: Date;
  Status: string;
  ServiceStartedAt: Date | null;
  DurationMinutes: number;
  TicketCode: string;
}

interface Booking {
  BookingID: number;
  AssignedEmpID: number;
  BookingDate: Date;
  StartTime: Date | string;
  EndTime: Date | string;
  Status: string;
}

interface WorkSchedule {
  EmpID: number;
  DayOfWeek: number;
  IsWorkingDay: boolean;
  StartTime: Date | string;
  EndTime: Date | string;
}

interface DayOff {
  EmpID: number;
  OffDate: Date;
  Reason: string;
}

interface TimeSlot {
  time: string;
  start: string;
  end: string;
}

interface BlockedSlot {
  time: string;
  reasonCode: string;
  reason: string;
  blockerType?: string;
  blockerId?: number;
}

interface BarberDebugInfo {
  empId: number;
  name: string;
  job: string;
  isBookable: boolean;
  isWorkingDay: boolean;
  workingWindow: {
    start: string;
    end: string;
    overnight: boolean;
  } | null;
  dayOffReason: string | null;
  queueTickets: Array<{
    id: number;
    ticketCode: string;
    status: string;
    startTime: string;
    endTime: string;
    durationMinutes: number;
  }>;
  bookings: Array<{
    id: number;
    startTime: string;
    endTime: string;
    status: string;
  }>;
  availableSlots: TimeSlot[];
  blockedSlots: BlockedSlot[];
  available: boolean;
  reason: string | null;
  reasonCode: string | null;
}

// Auth check
function isAuthorized(req: NextRequest): boolean {
  const secretKey = req.headers.get("x-admin-secret");
  const adminKey = process.env.ADMIN_SECRET_KEY;
  return Boolean(adminKey) && secretKey === adminKey;
}

// Parse time from SQL (handles both string and Date)
function parseTime(timeVal: Date | string | null): string {
  if (!timeVal) return "00:00";
  if (timeVal instanceof Date) {
    return `${String(timeVal.getHours()).padStart(2, '0')}:${String(timeVal.getMinutes()).padStart(2, '0')}`;
  }
  return timeVal.slice(0, 5);
}

// Convert time string to minutes
function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// Convert minutes to time string
function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Check if two time ranges overlap
function rangesOverlap(start1: number, end1: number, start2: number, end2: number): boolean {
  return start1 < end2 && end1 > start2;
}

export async function GET(req: NextRequest) {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  /* secret gate replaced by requireDevelopmentAdmin (Phase 1A) */

  try {
    const { searchParams } = new URL(req.url);
    const dateStr = searchParams.get("date") || new Date().toISOString().split('T')[0];
    const serviceIdsParam = searchParams.get("serviceIds");
    const serviceIds = serviceIdsParam ? serviceIdsParam.split(',').map(Number) : [];

    const db = await getPool();

    // Get service duration
    const defaultDur = await getDefaultDuration(db);
    const durationMinutes = await getServicesDuration(db, serviceIds, defaultDur);

    // Parse date
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, etc.
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);

    // Step 1: Get all bookable barbers
    const barbersResult = await db.request().query(`
      SELECT EmpID, EmpName, Job, isActive
      FROM dbo.TblEmp
      WHERE Job LIKE '%حلاق%'
        AND isActive = 1
      ORDER BY EmpID
    `);

    const barbers = barbersResult.recordset;

    // Step 2: Get all schedules for these barbers
    const empIds = barbers.map(b => b.EmpID);
    const scheduleResult = await db.request().query(`
      SELECT EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime
      FROM dbo.TblEmpWorkSchedule
      WHERE EmpID IN (${empIds.join(',')})
    `);

    const schedules: WorkSchedule[] = scheduleResult.recordset;

    // Step 3: Get day-offs (if table exists)
    let dayOffs: DayOff[] = [];
    try {
      const dayOffResult = await db.request().query(`
        SELECT EmpID, OffDate, Reason
        FROM dbo.TblEmpDayOff
        WHERE EmpID IN (${empIds.join(',')})
          AND OffDate = '${dateStr}'
      `);
      dayOffs = dayOffResult.recordset;
    } catch {
      // Table might not exist
    }

    // Step 4: Get queue tickets for this date
    const queueResult = await db.request().query(`
      SELECT 
        QueueTicketID,
        EmpID,
        QueueDate,
        Status,
        ServiceStartedAt,
        ISNULL(DurationMinutes, 30) as DurationMinutes,
        TicketCode
      FROM dbo.QueueTickets
      WHERE EmpID IN (${empIds.join(',')})
        AND QueueDate = '${dateStr}'
        AND LOWER(Status) IN ('waiting', 'called', 'arrived', 'in_service')
    `);

    const queueTickets: QueueTicket[] = queueResult.recordset;

    // Step 5: Get bookings for this date
    const bookingResult = await db.request().query(`
      SELECT 
        BookingID,
        AssignedEmpID,
        BookingDate,
        StartTime,
        EndTime,
        Status
      FROM dbo.Bookings
      WHERE AssignedEmpID IN (${empIds.join(',')})
        AND BookingDate = '${dateStr}'
        AND LOWER(Status) IN ('confirmed', 'arrived', 'queued', 'in_service')
    `);

    const bookings: Booking[] = bookingResult.recordset;

    // Step 6: Calculate availability for each barber
    const barberResults: BarberDebugInfo[] = [];

    for (const barber of barbers) {
      const empId = barber.EmpID;

      // Find schedule for this day
      const schedule = schedules.find(s => s.EmpID === empId && s.DayOfWeek === dayOfWeek);

      // Check day off
      const dayOff = dayOffs.find(d => d.EmpID === empId);

      // Get queue tickets for this barber
      const barberQueue = queueTickets.filter(q => q.EmpID === empId);

      // Get bookings for this barber
      const barberBookings = bookings.filter(b => b.AssignedEmpID === empId);

      let isWorkingDay = false;
      let workingWindow: { start: string; end: string; overnight: boolean } | null = null;
      let dayOffReason: string | null = null;
      let available = false;
      let reason: string | null = null;
      let reasonCode: string | null = null;
      let availableSlots: TimeSlot[] = [];
      let blockedSlots: BlockedSlot[] = [];

      // Check day off first
      if (dayOff) {
        isWorkingDay = false;
        dayOffReason = dayOff.Reason || "إجازة";
        available = false;
        reason = dayOffReason;
        reasonCode = "DAY_OFF";
      } else if (!schedule) {
        // No schedule = not working
        isWorkingDay = false;
        available = false;
        reason = "لا يوجد جدول عمل";
        reasonCode = "NO_WORKING_SCHEDULE";
      } else if (!schedule.IsWorkingDay) {
        // Working day flag is false
        isWorkingDay = false;
        available = false;
        reason = "إجازة أسبوعية";
        reasonCode = "DAY_OFF";
      } else {
        // Working day - calculate slots
        isWorkingDay = true;
        const startTime = parseTime(schedule.StartTime);
        const endTime = parseTime(schedule.EndTime);
        const startMinutes = timeToMinutes(startTime);
        const endMinutes = timeToMinutes(endTime);
        const overnight = endMinutes < startMinutes || endMinutes === 0;

        workingWindow = {
          start: startTime,
          end: endTime,
          overnight
        };

        // Build blocker list (queue + bookings)
        const blockers: Array<{
          start: number;
          end: number;
          type: string;
          id: number;
          code?: string;
        }> = [];

        // Add queue tickets as blockers
        for (const qt of barberQueue) {
          const qtStart = qt.ServiceStartedAt
            ? timeToMinutes(parseTime(qt.ServiceStartedAt))
            : timeToMinutes("09:00"); // Default if not started
          const qtEnd = qtStart + (qt.DurationMinutes || 30);
          blockers.push({
            start: qtStart,
            end: qtEnd,
            type: 'QUEUE',
            id: qt.QueueTicketID,
            code: qt.TicketCode
          });
        }

        // Add bookings as blockers
        for (const bk of barberBookings) {
          const bkStart = timeToMinutes(parseTime(bk.StartTime));
          const bkEnd = timeToMinutes(parseTime(bk.EndTime));
          blockers.push({
            start: bkStart,
            end: bkEnd,
            type: 'BOOKING',
            id: bk.BookingID
          });
        }

        // Generate slots
        const slotInterval = 15; // 15-minute slots
        const dayStart = startMinutes;
        const dayEnd = overnight
          ? endMinutes + 24 * 60 // Add 24 hours for overnight
          : endMinutes;

        let currentTime = dayStart;
        while (currentTime < dayEnd) {
          const slotStart = currentTime;
          const slotEnd = currentTime + durationMinutes;
          const timeStr = minutesToTime(currentTime % (24 * 60));

          // Check if this slot is blocked
          const blocker = blockers.find(b =>
            rangesOverlap(slotStart, slotEnd, b.start, b.end)
          );

          if (blocker) {
            blockedSlots.push({
              time: timeStr,
              reasonCode: blocker.type === 'QUEUE' ? 'QUEUE_BLOCKED' : 'BOOKING_BLOCKED',
              reason: blocker.type === 'QUEUE' ? 'تعارض مع تذكرة صف' : 'تعارض مع حجز آخر',
              blockerType: blocker.type,
              blockerId: blocker.id
            });
          } else {
            // Calculate actual date for the slot
            const slotDate = slotStart >= 24 * 60
              ? nextDay.toISOString().split('T')[0]
              : dateStr;
            const slotTime = minutesToTime(slotStart % (24 * 60));
            const slotEndTime = minutesToTime(slotEnd % (24 * 60));

            availableSlots.push({
              time: timeStr,
              start: `${slotDate}T${slotTime}:00+03:00`,
              end: `${slotDate}T${slotEndTime}:00+03:00`
            });
          }

          currentTime += slotInterval;
        }

        // Determine availability
        if (availableSlots.length > 0) {
          available = true;
          reason = null;
          reasonCode = null;
        } else {
          available = false;
          reason = "لا توجد مواعيد متاحة";
          reasonCode = "NO_AVAILABLE_SLOTS";
        }
      }

      barberResults.push({
        empId,
        name: barber.EmpName,
        job: barber.Job,
        isBookable: true,
        isWorkingDay,
        workingWindow,
        dayOffReason,
        queueTickets: barberQueue.map(q => ({
          id: q.QueueTicketID,
          ticketCode: q.TicketCode,
          status: q.Status,
          startTime: q.ServiceStartedAt
            ? parseTime(q.ServiceStartedAt)
            : "Not started",
          endTime: q.ServiceStartedAt
            ? minutesToTime(timeToMinutes(parseTime(q.ServiceStartedAt)) + q.DurationMinutes)
            : "Unknown",
          durationMinutes: q.DurationMinutes
        })),
        bookings: barberBookings.map(b => ({
          id: b.BookingID,
          startTime: parseTime(b.StartTime),
          endTime: parseTime(b.EndTime),
          status: b.Status
        })),
        availableSlots,
        blockedSlots,
        available,
        reason,
        reasonCode
      });
    }

    return NextResponse.json({
      ok: true,
      date: dateStr,
      serviceIds,
      serviceDurationMinutes: durationMinutes,
      barbers: barberResults
    });

  } catch (err: any) {
    console.error("[booking-debug/day] Error:", err);
    return NextResponse.json(
      { ok: false, error: err.message, stack: err.stack },
      { status: 500 }
    );
  }
}
