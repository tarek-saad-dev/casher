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
import { getCairoBusinessDate } from "@/lib/businessDate";
import {
  computeEffectiveTicket,
  type QueueTicketRaw,
} from "@/lib/queueLifecycleEngine";
import { normalizeBookingTimes, sqlTimeToHhmm, createCairoDateTime } from "@/lib/bookingDateTime";
import { getBarbersDayStatus } from "@/lib/availabilityEngine";

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
  status: "working" | "off" | "day_off" | "absent" | "not_checked_in" | "unknown";
  // Normalized status fields from availabilityEngine
  isWorkingDay: boolean;
  isDayOff: boolean;
  isAbsent: boolean;
  isLateStart: boolean;
  isEarlyLeave: boolean;
  currentAvailabilityStatus: string;
  statusReasonArabic: string;
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
    serviceNames?: string[];
    barberId?: number;
    // Lifecycle fields
    effectiveStatus?: string;
    actualStatus?: string;
    needsOperatorAction?: boolean;
    overdueMinutes?: number;
    expectedStartAt?: string;
    expectedEndAt?: string;
    isCountingAhead?: boolean;
    isBlockingAvailability?: boolean;
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
    const dateStr = dateParam || getCairoBusinessDate();
    const now = new Date();
    
    // Get Cairo day of week (0=Sunday)
    const cairoDate = new Date(`${dateStr}T12:00:00`);
    const dayOfWeek = cairoDate.getDay();

    console.log(`[flow-board] Date: ${dateStr}, DayOfWeek: ${dayOfWeek}`);

    // 1. Connect to DB
    const dbStart = Date.now();
    const db = await getPool();
    perfLog("dbConnect", dbStart);

    // 2. Detect lifecycle columns (fast single query)
    const colCheck = await db.request().query(`
      SELECT 
        CASE WHEN COL_LENGTH('dbo.QueueTickets','ExpectedStartAt') IS NOT NULL THEN 1 ELSE 0 END AS hasExpectedStartAt,
        CASE WHEN COL_LENGTH('dbo.QueueTickets','ExpectedEndAt') IS NOT NULL THEN 1 ELSE 0 END AS hasExpectedEndAt,
        CASE WHEN COL_LENGTH('dbo.QueueTickets','DurationMinutes') IS NOT NULL THEN 1 ELSE 0 END AS hasDurationMinutes
    `);
    const { hasExpectedStartAt, hasExpectedEndAt, hasDurationMinutes } = colCheck.recordset[0] || {};

    // Build lifecycle columns SQL fragment dynamically
    const lifecycleCols = [
      hasExpectedStartAt ? 'qt.ExpectedStartAt' : 'NULL AS ExpectedStartAt',
      hasExpectedEndAt ? 'qt.ExpectedEndAt' : 'NULL AS ExpectedEndAt',
      hasDurationMinutes ? 'qt.DurationMinutes' : 'NULL AS DurationMinutes',
    ].join(',\n            ');

    // 3. Fetch ALL data in parallel (NO N+1!)
    const batchStart = Date.now();
    
    const [
      barbersRes,
      bookingsRes,
      queueRes,
    ] = await Promise.all([
      // 3a. Get barbers only (Job = 'حلاق')
      db.request().query(`
        SELECT EmpID, EmpName
        FROM [dbo].[TblEmp]
        WHERE isActive = 1 AND Job = N'حلاق'
        ORDER BY EmpName
      `),
      
      // 3b. Get all bookings for this date
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
            AND b.Status IN ('confirmed', 'arrived', 'in_progress', 'queued', 'in_service')
        `),
      
      // 3c. Get all queue tickets for this date (lifecycle cols included only if they exist)
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
            qt.CreatedTime,
            ${lifecycleCols}
          FROM [dbo].[QueueTickets] qt
          LEFT JOIN [dbo].[TblClient] c ON qt.ClientID = c.ClientID
          WHERE qt.QueueDate = @qdate
            AND qt.EmpID IN (SELECT EmpID FROM [dbo].[TblEmp] WHERE isActive = 1 AND Job = N'حلاق')
            AND LOWER(qt.Status) IN ('waiting', 'called', 'arrived', 'in_service')
        `),
    ]);
    
    perfLog("batchFetch", batchStart);

    // 3d. Batch-load service lines for bookings and queue tickets
    const bookingIds = bookingsRes.recordset.map((b: { BookingID: number }) => b.BookingID);
    const queueIds = queueRes.recordset.map((q: { QueueTicketID: number }) => q.QueueTicketID);

    const bookingServicesMap = new Map<number, { names: string[]; totalDuration: number }>();
    const queueServicesMap = new Map<number, { names: string[]; totalDuration: number }>();

    if (bookingIds.length > 0) {
      try {
        const bsRes = await db.request().query(`
          SELECT bs.BookingID, p.ProName,
                 ISNULL(bs.DurationMinutes, ISNULL(p.DurationMinutes, 30)) AS DurationMinutes
          FROM [dbo].[BookingServices] bs
          LEFT JOIN [dbo].[TblPro] p ON p.ProID = bs.ProID
          WHERE bs.BookingID IN (${bookingIds.join(',')})
          ORDER BY bs.BookingServiceID
        `);
        for (const row of bsRes.recordset) {
          const cur = bookingServicesMap.get(row.BookingID) ?? { names: [], totalDuration: 0 };
          if (row.ProName) cur.names.push(row.ProName);
          cur.totalDuration += row.DurationMinutes ?? 30;
          bookingServicesMap.set(row.BookingID, cur);
        }
      } catch { /* BookingServices may be missing on legacy DB */ }
    }

    if (queueIds.length > 0) {
      try {
        const qsRes = await db.request().query(`
          SELECT qts.QueueTicketID,
                 ISNULL(qts.ProName, p.ProName) AS ProName,
                 ISNULL(qts.DurationMinutes, ISNULL(p.DurationMinutes, 30)) AS DurationMinutes
          FROM [dbo].[QueueTicketServices] qts
          LEFT JOIN [dbo].[TblPro] p ON p.ProID = qts.ProID
          WHERE qts.QueueTicketID IN (${queueIds.join(',')})
          ORDER BY qts.ID
        `);
        for (const row of qsRes.recordset) {
          const cur = queueServicesMap.get(row.QueueTicketID) ?? { names: [], totalDuration: 0 };
          if (row.ProName) cur.names.push(row.ProName);
          cur.totalDuration += row.DurationMinutes ?? 30;
          queueServicesMap.set(row.QueueTicketID, cur);
        }
      } catch { /* QueueTicketServices optional */ }
    }

    // 2d. Batch load full day status
    const isToday = dateStr === now.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
    const allBarberIds: number[] = barbersRes.recordset.map((b: any) => b.EmpID as number);
    const dayStatusMap = await getBarbersDayStatus(allBarberIds, dateStr, { isToday });

    console.log(`[flow-board] Barbers: ${barbersRes.recordset.length}, Bookings: ${bookingsRes.recordset.length}, Queue: ${queueRes.recordset.length}`);

    // 3. Group data by empId in memory (fast)
    const processStart = Date.now();
    
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
      const dayStatus = dayStatusMap.get(empId);

      // Common status fields for all branches
      const statusFields = {
        isWorkingDay:              dayStatus?.isWorkingDay ?? false,
        isDayOff:                  dayStatus?.isDayOff ?? true,
        isAbsent:                  dayStatus?.isAbsent ?? false,
        isLateStart:               dayStatus?.isLateStart ?? false,
        isEarlyLeave:              dayStatus?.isEarlyLeave ?? false,
        currentAvailabilityStatus: dayStatus?.currentAvailabilityStatus ?? "unknown",
        statusReasonArabic:        dayStatus?.statusReasonArabic ?? "غير متاح",
      };

      // Not working today (day off, absent, no schedule)
      if (!dayStatus?.isWorkingDay || dayStatus.isAbsent) {
        const statusCode =
          dayStatus?.isAbsent    ? "absent"  :
          dayStatus?.isDayOff    ? "day_off" :
          (dayStatus?.currentAvailabilityStatus as FlowBoardBarber["status"]) ?? "day_off";
        barbers.push({
          empId,
          empName: barber.EmpName,
          status: statusCode,
          ...statusFields,
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

      const workStart = dayStatus.effectiveStart ?? null;
      const workEnd   = dayStatus.effectiveEnd   ?? null;
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
        const svcInfo = bookingServicesMap.get(b.BookingID);
        const serviceDuration = svcInfo?.totalDuration ?? defaultDuration;

        const normalized = normalizeBookingTimes(
          dateStr,
          b.StartTime,
          b.EndTime,
          serviceDuration,
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
          serviceNames: svcInfo?.names,
          barberId: empId,
          // Additional normalized fields for frontend
          startTimeDisplay: normalized.startTimeDisplay,
          endTimeDisplay: normalized.endTimeDisplay,
          dateDisplay: normalized.dateDisplay,
        });
      }
      
      // Add queue items with effective status computation
      let inServiceCount = 0;
      for (const q of barberQueue) {
        // Compute effective status
        const effective = computeEffectiveTicket(
          {
            QueueTicketID: q.QueueTicketID,
            TicketCode: q.TicketCode,
            TicketNumber: 0,
            Status: q.Status.toLowerCase() as any,
            EmpID: q.EmpID,
            ClientID: q.ClientID,
            QueueDate: dateStr,
            CreatedTime: q.CreatedTime,
            CalledAt: null,
            ArrivedAt: null,
            ServiceStartedAt: q.ServiceStartedAt,
            ServiceEndedAt: null,
            EstimatedStartTime: q.EstimatedStartTime,
            ExpectedStartAt: q.ExpectedStartAt ?? null,
            ExpectedEndAt: q.ExpectedEndAt ?? null,
            DurationMinutes: q.DurationMinutes ?? null,
          } as QueueTicketRaw,
          now,
        );

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
        const qSvc = queueServicesMap.get(q.QueueTicketID);
        const duration = q.DurationMinutes
          ?? qSvc?.totalDuration
          ?? effective.durationMinutes
          ?? defaultDuration;
        const end = new Date(start.getTime() + duration * 60000);
        
        timeline.push({
          type: "queue",
          sourceId: q.QueueTicketID,
          label: q.TicketCode || `Q-${q.QueueTicketID}`,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          status: q.Status,
          protected: effective.isBlockingAvailability,
          durationMinutes: duration,
          customerName: q.ClientName || undefined,
          serviceNames: qSvc?.names,
          barberId: empId,
          actualStatus: effective.actualStatus,
          effectiveStatus: effective.effectiveStatus,
          expectedStartAt: effective.expectedStartAt?.toISOString() ?? undefined,
          expectedEndAt: effective.expectedEndAt?.toISOString() ?? undefined,
          needsOperatorAction: effective.needsOperatorAction,
          overdueMinutes: effective.overdueMinutes,
          isCountingAhead: effective.isCountingAhead,
          isBlockingAvailability: effective.isBlockingAvailability,
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

      // Count only effectively active waiting tickets (not expired/overdue)
      const effectiveWaitingCount = timeline.filter(
        t => t.type === 'queue' && t.isCountingAhead && t.actualStatus === 'waiting'
      ).length;

      barbers.push({
        empId,
        empName: barber.EmpName,
        status: (dayStatus?.currentAvailabilityStatus as FlowBoardBarber["status"]) ?? "working",
        ...statusFields,
        workStart,
        workEnd,
        isOvernightShift: isOvernight,
        nextAvailableAt,
        waitingCount: effectiveWaitingCount,
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
