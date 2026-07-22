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
import {
  normalizeBookingTimes,
  sqlTimeToHhmm,
  createCairoDateTime,
  sqlDateToYyyyMmDd,
} from "@/lib/bookingDateTime";
import { getBarbersDayStatus } from "@/lib/availabilityEngine";
import { createDevTimer } from "@/lib/devRequestTiming";
import { isAuthResult, requirePageAccess } from "@/lib/api-auth";

export const runtime = "nodejs";

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
  const auth = await requirePageAccess("/operations");
  if (!isAuthResult(auth)) return auth;
  const timer = createDevTimer('flow_board');

  try {
    // Public operations route is auth-gated by proxy; no session work here.
    timer.mark('authMs');

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");
    const dateStr = dateParam || getCairoBusinessDate();
    const now = new Date();

    // Get Cairo day of week (0=Sunday)
    const cairoDate = new Date(`${dateStr}T12:00:00Z`);
    const dayOfWeek = cairoDate.getDay();
    timer.mark('dateParseMs');

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[flow-board] Date: ${dateStr}, DayOfWeek: ${dayOfWeek}`);
    }

    const db = await getPool();
    timer.mark('poolMs');

    // Detect lifecycle columns (fast single query)
    const colCheckStart = Date.now();
    const colCheck = await db.request().query(`
      SELECT 
        CASE WHEN COL_LENGTH('dbo.QueueTickets','ExpectedStartAt') IS NOT NULL THEN 1 ELSE 0 END AS hasExpectedStartAt,
        CASE WHEN COL_LENGTH('dbo.QueueTickets','ExpectedEndAt') IS NOT NULL THEN 1 ELSE 0 END AS hasExpectedEndAt,
        CASE WHEN COL_LENGTH('dbo.QueueTickets','DurationMinutes') IS NOT NULL THEN 1 ELSE 0 END AS hasDurationMinutes
    `);
    timer.setAbsolute('colCheckMs', Date.now() - colCheckStart);
    const { hasExpectedStartAt, hasExpectedEndAt, hasDurationMinutes } = colCheck.recordset[0] || {};

    const lifecycleCols = [
      hasExpectedStartAt ? 'qt.ExpectedStartAt' : 'NULL AS ExpectedStartAt',
      hasExpectedEndAt ? 'qt.ExpectedEndAt' : 'NULL AS ExpectedEndAt',
      hasDurationMinutes ? 'qt.DurationMinutes' : 'NULL AS DurationMinutes',
    ].join(',\n            ');

    const nextDateStr = nextDate(dateStr);

    const timed = async <T>(label: string, p: Promise<T>): Promise<T> => {
      const t0 = Date.now();
      const result = await p;
      timer.setAbsolute(label, Date.now() - t0);
      return result;
    };

    const [
      barbersRes,
      bookingsRes,
      queueRes,
      bookingsNextRes,
      queueNextRes,
    ] = await Promise.all([
      timed('employeesMs', db.request().query(`
        SELECT EmpID, EmpName
        FROM [dbo].[TblEmp]
        WHERE isActive = 1 AND Job = N'حلاق'
        ORDER BY EmpName
      `)),

      timed('bookingsMs', db.request()
        .input("bdate", sql.Date, dateStr)
        .query(`
          SELECT 
            b.BookingID,
            b.AssignedEmpID,
            b.ClientID,
            b.BookingDate,
            c.Name as ClientName,
            b.StartTime,
            b.EndTime,
            b.Status
          FROM [dbo].[Bookings] b
          LEFT JOIN [dbo].[TblClient] c ON b.ClientID = c.ClientID
          WHERE b.BookingDate = @bdate
            AND b.AssignedEmpID IN (SELECT EmpID FROM [dbo].[TblEmp] WHERE isActive = 1 AND Job = N'حلاق')
            AND b.Status IN ('confirmed', 'arrived', 'in_progress', 'queued', 'in_service')
        `)),

      timed('queueMs', db.request()
        .input("qdate", sql.Date, dateStr)
        .query(`
          SELECT 
            qt.QueueTicketID,
            qt.TicketCode,
            qt.EmpID,
            qt.ClientID,
            qt.QueueDate,
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
        `)),

      timed('nextDayBookingsMs', db.request()
        .input("bdate", sql.Date, nextDateStr)
        .query(`
          SELECT 
            b.BookingID,
            b.AssignedEmpID,
            b.ClientID,
            b.BookingDate,
            c.Name as ClientName,
            b.StartTime,
            b.EndTime,
            b.Status
          FROM [dbo].[Bookings] b
          LEFT JOIN [dbo].[TblClient] c ON b.ClientID = c.ClientID
          WHERE b.BookingDate = @bdate
            AND b.AssignedEmpID IN (SELECT EmpID FROM [dbo].[TblEmp] WHERE isActive = 1 AND Job = N'حلاق')
            AND b.Status IN ('confirmed', 'arrived', 'in_progress', 'queued', 'in_service')
        `)),

      timed('nextDayQueueMs', db.request()
        .input("qdate", sql.Date, nextDateStr)
        .query(`
          SELECT 
            qt.QueueTicketID,
            qt.TicketCode,
            qt.EmpID,
            qt.ClientID,
            qt.QueueDate,
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
        `)),
    ]);

    const bookingIds = [
      ...bookingsRes.recordset,
      ...bookingsNextRes.recordset,
    ].map((b: { BookingID: number }) => b.BookingID);
    const queueIds = [
      ...queueRes.recordset,
      ...queueNextRes.recordset,
    ].map((q: { QueueTicketID: number }) => q.QueueTicketID);

    const bookingServicesMap = new Map<number, { names: string[]; totalDuration: number }>();
    const queueServicesMap = new Map<number, { names: string[]; totalDuration: number }>();

    const detailsStart = Date.now();
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
    timer.setAbsolute('detailsMs', Date.now() - detailsStart);

    // schedules + overrides + attendance/day-off live inside getBarbersDayStatus
    const isToday = dateStr === getCairoBusinessDate(now);
    const allBarberIds: number[] = barbersRes.recordset.map((b: any) => b.EmpID as number);
    const dayStatusStart = Date.now();
    const dayStatusMap = await getBarbersDayStatus(allBarberIds, dateStr, { isToday });
    timer.setAbsolute('otherQueriesMs', Date.now() - dayStatusStart);
    // Alias for report schema (nested in getBarbersDayStatus — not separately timed without engine change)
    timer.setAbsolute('schedulesMs', 0);
    timer.setAbsolute('overridesMs', 0);

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[flow-board] Barbers: ${barbersRes.recordset.length}, Bookings: ${bookingsRes.recordset.length}, Queue: ${queueRes.recordset.length}`);
    }

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

    const bookingsNextMap = new Map();
    for (const b of bookingsNextRes.recordset) {
      if (!bookingsNextMap.has(b.AssignedEmpID)) bookingsNextMap.set(b.AssignedEmpID, []);
      bookingsNextMap.get(b.AssignedEmpID).push(b);
    }

    const queueNextMap = new Map();
    for (const q of queueNextRes.recordset) {
      if (!queueNextMap.has(q.EmpID)) queueNextMap.set(q.EmpID, []);
      queueNextMap.get(q.EmpID).push(q);
    }

    timer.setAbsolute('normalizationMs', Date.now() - processStart);
    const scheduleCalcStart = Date.now();

    const barbers: FlowBoardBarber[] = [];
    const defaultDuration = 30; // minutes

    for (const barber of barbersRes.recordset) {
      const empId = barber.EmpID;
      const dayStatus = dayStatusMap.get(empId);

      const statusFields = {
        isWorkingDay:              dayStatus?.isWorkingDay ?? false,
        isDayOff:                  dayStatus?.isDayOff ?? true,
        isAbsent:                  dayStatus?.isAbsent ?? false,
        isLateStart:               dayStatus?.isLateStart ?? false,
        isEarlyLeave:              dayStatus?.isEarlyLeave ?? false,
        currentAvailabilityStatus: dayStatus?.currentAvailabilityStatus ?? "unknown",
        statusReasonArabic:        dayStatus?.statusReasonArabic ?? "غير متاح",
      };

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

      const timeline: FlowBoardBarber["timeline"] = [];
      const barberBookings = bookingsMap.get(empId) || [];
      const barberQueue = queueMap.get(empId) || [];
      const barberBookingsNext = isOvernight ? (bookingsNextMap.get(empId) || []) : [];
      const barberQueueNext = isOvernight ? (queueNextMap.get(empId) || []) : [];

      const shiftStartMs = workStart
        ? createCairoDateTime(dateStr, workStart).getTime()
        : -Infinity;
      const shiftEndMs = workStart && workEnd
        ? (isOvernight
            ? createCairoDateTime(nextDate(dateStr), workEnd).getTime()
            : createCairoDateTime(dateStr, workEnd).getTime())
        : Infinity;
      const inShiftWindow = (start: Date, end: Date) =>
        start.getTime() < shiftEndMs && end.getTime() > shiftStartMs;

      for (const b of [...barberBookings, ...barberBookingsNext]) {
        const bookingDateStr = b.BookingDate
          ? sqlDateToYyyyMmDd(b.BookingDate)
          : dateStr;
        const svcInfo = bookingServicesMap.get(b.BookingID);
        const serviceDuration = svcInfo?.totalDuration ?? defaultDuration;

        const normalized = normalizeBookingTimes(
          bookingDateStr,
          b.StartTime,
          b.EndTime,
          serviceDuration,
          b.BookingID
        );

        const start = new Date(normalized.startDateTimeCairo);
        const end = new Date(normalized.endDateTimeCairo);
        const safeDuration = normalized.durationMinutes;

        if (!inShiftWindow(start, end)) {
          continue;
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
          startTimeDisplay: normalized.startTimeDisplay,
          endTimeDisplay: normalized.endTimeDisplay,
          dateDisplay: normalized.dateDisplay,
        });
      }

      let inServiceCount = 0;
      for (const q of [...barberQueue, ...barberQueueNext]) {
        const queueDateStr = q.QueueDate
          ? sqlDateToYyyyMmDd(q.QueueDate)
          : dateStr;

        const effective = computeEffectiveTicket(
          {
            QueueTicketID: q.QueueTicketID,
            TicketCode: q.TicketCode,
            TicketNumber: 0,
            Status: q.Status.toLowerCase() as any,
            EmpID: q.EmpID,
            ClientID: q.ClientID,
            QueueDate: queueDateStr,
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

        let start: Date;
        if (q.EstimatedStartTime) {
          start = new Date(q.EstimatedStartTime);
        } else if (q.ServiceStartedAt) {
          start = new Date(q.ServiceStartedAt);
        } else {
          const fallbackDate = queueDateStr === nextDateStr ? nextDateStr : dateStr;
          start = new Date(`${fallbackDate}T${workStart || '14:00'}`);
        }
        const qSvc = queueServicesMap.get(q.QueueTicketID);
        const duration = q.DurationMinutes
          ?? qSvc?.totalDuration
          ?? effective.durationMinutes
          ?? defaultDuration;
        const end = new Date(start.getTime() + duration * 60000);

        if (!inShiftWindow(start, end)) {
          continue;
        }

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

      timeline.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

      let nextAvailableAt: string | null = null;
      if (timeline.length > 0) {
        const lastItem = timeline[timeline.length - 1];
        nextAvailableAt = lastItem.endTime;
      } else if (workStart) {
        nextAvailableAt = new Date(`${dateStr}T${workStart}`).toISOString();
      }

      const effectiveWaitingCount = timeline.filter(
        t => t.type === 'queue' && t.isCountingAhead && t.actualStatus === 'waiting'
      ).length;
      const displayedBookingsCount = timeline.filter(t => t.type === 'booking').length;

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
        bookingsCount: displayedBookingsCount,
        inServiceCount,
        timeline,
      });
    }

    timer.setAbsolute('scheduleCalculationMs', Date.now() - scheduleCalcStart);

    const respStart = Date.now();
    const payload = {
      ok: true as const,
      date: dateStr,
      generatedAt: now.toISOString(),
      barbers,
    };
    timer.setAbsolute('responseBuildMs', Date.now() - respStart);

    const serStart = Date.now();
    const body = JSON.stringify(payload);
    timer.setAbsolute('serializationMs', Date.now() - serStart);

    timer.log('[flow-board perf]', { date: dateStr, barberCount: barbers.length });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const st = timer.serverTimingHeader();
    if (st) headers['Server-Timing'] = st;

    return new NextResponse(body, { status: 200, headers });

  } catch (err) {
    console.error("[operations/flow-board] error:", err);
    timer.log('[flow-board perf]', { outcome: '500' });
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

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

// Helper: SQL time to Date (Cairo-normalized)
function timeToDate(sqlTime: unknown, dateStr: string): Date {
  return createCairoDateTime(dateStr, sqlTime);
}
