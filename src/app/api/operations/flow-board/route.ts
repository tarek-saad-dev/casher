/**
 * GET /api/operations/flow-board?date=2026-05-24
 *
 * Returns operational dashboard for BARBER employees only on a specific date.
 * OPTIMIZED: Batch queries, parallel loading, no N+1
 *
 * Response:
 * {
 *   ok: true,
 *   date: "2026-05-24",
 *   barbers: [...]
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import { normalizeBookingTimes, sqlTimeToHhmm, sqlDateToYyyyMmDd, createCairoDateTime, SALON_TZ } from "@/lib/bookingDateTime";

export const runtime = "nodejs";

// Performance logger
function perfLog(label: string, startMs: number) {
  const elapsed = Date.now() - startMs;
  console.log(`[flow-board perf] ${label}: ${elapsed}ms`);
  return elapsed;
}

export interface FlowBoardBarber {
  empId: number;
  empName: string;
  status: "working" | "off" | "day_off" | "unknown";
  workStart: string | null;
  workEnd: string | null;
  isOvernightShift: boolean;
  nextAvailableAt: string | null;
  waitingCount: number;
  bookingsCount: number;
  inServiceCount: number;
  timeline: Array<{
    type: "queue" | "booking" | "gap";
    sourceId: number;
    label: string;
    startTime: string;
    endTime: string;
    status: string;
    protected: boolean;
    durationMinutes?: number;
    customerName?: string;
    barberId?: number;
    // Normalized Cairo time display fields
    startTimeDisplay?: string;
    endTimeDisplay?: string;
    dateDisplay?: string;
  }>;
}

export async function GET(req: NextRequest) {
  const totalStart = Date.now();
  
  try {
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");
    const dateStr = dateParam || new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    const now = new Date();
    
    // Get Cairo day of week (0=Sunday)
    const cairoDate = new Date(`${dateStr}T12:00:00`);
    const dayOfWeek = cairoDate.getDay();

    console.log(`[flow-board] Date: ${dateStr}, DayOfWeek: ${dayOfWeek}`);

    // 1. Connect to DB
    const dbStart = Date.now();
    const db = await getPool();
    perfLog("dbConnect", dbStart);

    // 2. Fetch ALL data in parallel (NO N+1!)
    const batchStart = Date.now();
    
    const [
      barbersRes,
      schedulesRes,
      bookingsRes,
      queueRes,
    ] = await Promise.all([
      // 2a. Get barbers only (Job = 'حلاق')
      db.request().query(`
        SELECT EmpID, EmpName
        FROM [dbo].[TblEmp]
        WHERE isActive = 1 AND Job = N'حلاق'
        ORDER BY EmpName
      `),
      
      // 2b. Get all schedules for barbers on this day
      db.request()
        .input("dow", sql.TinyInt, dayOfWeek)
        .query(`
          SELECT EmpID, IsWorkingDay, StartTime, EndTime
          FROM [dbo].[TblEmpWorkSchedule]
          WHERE DayOfWeek = @dow
            AND EmpID IN (SELECT EmpID FROM [dbo].[TblEmp] WHERE isActive = 1 AND Job = N'حلاق')
        `),
      
      // 2c. Get all bookings for this date
      db.request()
        .input("bdate", sql.Date, dateStr)
        .query(`
          SELECT 
            b.BookingID,
            b.AssignedEmpID,
            b.ClientID,
            c.Name as ClientName,
            b.StartTime,
            b.EndTime,
            b.Status
          FROM [dbo].[Bookings] b
          LEFT JOIN [dbo].[TblClient] c ON b.ClientID = c.ClientID
          WHERE b.BookingDate = @bdate
            AND b.AssignedEmpID IN (SELECT EmpID FROM [dbo].[TblEmp] WHERE isActive = 1 AND Job = N'حلاق')
            AND b.Status IN ('confirmed', 'arrived', 'in_progress')
        `),
      
      // 2d. Get all queue tickets for this date
      db.request()
        .input("qdate", sql.Date, dateStr)
        .query(`
          SELECT 
            qt.QueueTicketID,
            qt.TicketCode,
            qt.EmpID,
            qt.ClientID,
            c.Name as ClientName,
            qt.Status,
            qt.EstimatedStartTime,
            qt.ServiceStartedAt,
            qt.CreatedTime
          FROM [dbo].[QueueTickets] qt
          LEFT JOIN [dbo].[TblClient] c ON qt.ClientID = c.ClientID
          WHERE qt.QueueDate = @qdate
            AND qt.EmpID IN (SELECT EmpID FROM [dbo].[TblEmp] WHERE isActive = 1 AND Job = N'حلاق')
            AND LOWER(qt.Status) IN ('waiting', 'called', 'in_service')
        `),
    ]);
    
    perfLog("batchFetch", batchStart);
    console.log(`[flow-board] Barbers: ${barbersRes.recordset.length}, Schedules: ${schedulesRes.recordset.length}, Bookings: ${bookingsRes.recordset.length}, Queue: ${queueRes.recordset.length}`);

    // 3. Group data by empId in memory (fast)
    const processStart = Date.now();
    
    const scheduleMap = new Map();
    for (const s of schedulesRes.recordset) {
      scheduleMap.set(s.EmpID, s);
    }
    
    const bookingsMap = new Map();
    for (const b of bookingsRes.recordset) {
      if (!bookingsMap.has(b.AssignedEmpID)) bookingsMap.set(b.AssignedEmpID, []);
      bookingsMap.get(b.AssignedEmpID).push(b);
    }
    
    const queueMap = new Map();
    for (const q of queueRes.recordset) {
      if (!queueMap.has(q.EmpID)) queueMap.set(q.EmpID, []);
      queueMap.get(q.EmpID).push(q);
    }

    // 4. Build response for each barber (no DB queries here!)
    const barbers: FlowBoardBarber[] = [];
    const defaultDuration = 30; // minutes
    
    for (const barber of barbersRes.recordset) {
      const empId = barber.EmpID;
      const schedule = scheduleMap.get(empId);
      
      // Not working today
      if (!schedule || !schedule.IsWorkingDay) {
        barbers.push({
          empId,
          empName: barber.EmpName,
          status: "day_off",
          workStart: null,
          workEnd: null,
          isOvernightShift: false,
          nextAvailableAt: null,
          waitingCount: 0,
          bookingsCount: 0,
          inServiceCount: 0,
          timeline: [],
        });
        continue;
      }

      const workStart = schedule.StartTime ? formatTime(schedule.StartTime) : null;
      const workEnd = schedule.EndTime ? formatTime(schedule.EndTime) : null;
      const isOvernight = !!(workStart && workEnd && timeToMinutes(workEnd) <= timeToMinutes(workStart));

      // Build timeline items
      const timeline: FlowBoardBarber["timeline"] = [];
      const barberBookings = bookingsMap.get(empId) || [];
      const barberQueue = queueMap.get(empId) || [];
      
      // Add booking items with Cairo-normalized times
      for (const b of barberBookings) {
        // DEBUG for BK-448
        const isDebug = b.BookingID === 448;
        if (isDebug) {
          console.log(`[flow-board] Processing BK-${b.BookingID}:`, {
            rawStartTime: b.StartTime,
            rawEndTime: b.EndTime,
            dateStr,
          });
        }

        // Use Cairo-normalized datetime utility
        const normalized = normalizeBookingTimes(
          dateStr,
          b.StartTime,
          b.EndTime,
          30, // default duration, will be calculated from times
          b.BookingID
        );

        const start = new Date(normalized.startDateTimeCairo);
        const end = new Date(normalized.endDateTimeCairo);
        const safeDuration = normalized.durationMinutes;

        if (isDebug) {
          console.log(`[flow-board] BK-${b.BookingID} normalized:`, {
            start: start.toISOString(),
            end: end.toISOString(),
            duration: safeDuration,
            startDisplay: normalized.startTimeDisplay,
            endDisplay: normalized.endTimeDisplay,
          });
        }
        
        timeline.push({
          type: "booking",
          sourceId: b.BookingID,
          label: b.ClientName || `B-${b.BookingID}`,
          startTime: normalized.startDateTimeCairo,
          endTime: normalized.endDateTimeCairo,
          status: b.Status,
          protected: true,
          durationMinutes: safeDuration,
          customerName: b.ClientName || undefined,
          barberId: empId,
          // Additional normalized fields for frontend
          startTimeDisplay: normalized.startTimeDisplay,
          endTimeDisplay: normalized.endTimeDisplay,
          dateDisplay: normalized.dateDisplay,
        });
      }
      
      // Add queue items
      let inServiceCount = 0;
      for (const q of barberQueue) {
        const isInService = q.Status.toLowerCase() === 'in_service';
        if (isInService) inServiceCount++;
        
        // Calculate times
        let start: Date;
        if (q.EstimatedStartTime) {
          start = new Date(q.EstimatedStartTime);
        } else if (q.ServiceStartedAt) {
          start = new Date(q.ServiceStartedAt);
        } else {
          start = new Date(`${dateStr}T${workStart || '14:00'}`);
        }
        const end = new Date(start.getTime() + defaultDuration * 60000);
        
        timeline.push({
          type: "queue",
          sourceId: q.QueueTicketID,
          label: q.TicketCode || `Q-${q.QueueTicketID}`,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          status: q.Status,
          protected: true,
          durationMinutes: defaultDuration,
          customerName: q.ClientName || undefined,
          barberId: empId,
        });
      }
      
      // Sort timeline by start time
      timeline.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      // Calculate next available (simple: after last item or work start)
      let nextAvailableAt: string | null = null;
      if (timeline.length > 0) {
        const lastItem = timeline[timeline.length - 1];
        nextAvailableAt = lastItem.endTime;
      } else if (workStart) {
        nextAvailableAt = new Date(`${dateStr}T${workStart}`).toISOString();
      }

      barbers.push({
        empId,
        empName: barber.EmpName,
        status: "working",
        workStart,
        workEnd,
        isOvernightShift: isOvernight,
        nextAvailableAt,
        waitingCount: barberQueue.filter((q: any) => q.Status.toLowerCase() === 'waiting').length,
        bookingsCount: barberBookings.length,
        inServiceCount,
        timeline,
      });
    }
    
    perfLog("processData", processStart);

    // 5. Return response
    const totalMs = perfLog("TOTAL", totalStart);
    console.log(`[flow-board] ✅ Completed in ${totalMs}ms, ${barbers.length} barbers`);

    return NextResponse.json({
      ok: true,
      date: dateStr,
      generatedAt: now.toISOString(),
      barbers,
    });
    
  } catch (err) {
    console.error("[operations/flow-board] error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "فشل في تحميل لوحة التحكم",
      },
      { status: 500 }
    );
  }
}

// Helper: Format SQL time to HH:MM using Cairo timezone
function formatTime(sqlTime: unknown): string {
  return sqlTimeToHhmm(sqlTime);
}

// Helper: Convert "HH:MM" to minutes
function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

// Helper: SQL time to Date (Cairo-normalized)
function timeToDate(sqlTime: unknown, dateStr: string): Date {
  return createCairoDateTime(dateStr, sqlTime);
}
