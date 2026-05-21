import { NextRequest, NextResponse } from "next/server";
import { getPool, sql } from "@/lib/db";
import {
  getPublicSettings,
  getRateLimitKey,
  checkRateLimit,
  isValidDate,
  PUBLIC_CORS_HEADERS,
} from "@/lib/publicBookingHelpers";
import {
  cairoDateStr,
  getDefaultDuration,
  getServicesDuration,
  Interval,
} from "@/lib/queueEstimateEngine";
import { applyOverrides, ScheduleOverride } from "@/lib/scheduleOverrides";

export const runtime = "nodejs";

const AR_DAYS = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

// Reason codes for specific mode
const REASON_CODES = {
  BARBER_NOT_FOUND: "BARBER_NOT_FOUND",
  BARBER_NOT_BOOKABLE: "BARBER_NOT_BOOKABLE",
  NO_WORKING_SCHEDULE: "NO_WORKING_SCHEDULE",
  DAY_OFF: "DAY_OFF",
  OUTSIDE_WORKING_HOURS: "OUTSIDE_WORKING_HOURS",
  NO_AVAILABLE_SLOTS: "NO_AVAILABLE_SLOTS",
  FULLY_BOOKED: "FULLY_BOOKED",
  QUEUE_BLOCKED: "QUEUE_BLOCKED",
  BOOKING_BLOCKED: "BOOKING_BLOCKED",
} as const;

type ReasonCode = (typeof REASON_CODES)[keyof typeof REASON_CODES];

interface DayResult {
  date: string;
  available: boolean;
  label: string;
  reason?: string;
  reasonCode?: ReasonCode;
}

interface ScheduleRow {
  EmpID: number;
  DayOfWeek: number;
  IsWorkingDay: boolean;
  StartTime: string | null;
  EndTime: string | null;
}

interface DayOffRow {
  EmpID: number;
  OffDate: string;
  Reason: string | null;
}

interface QueueTicketRow {
  QueueTicketID: number;
  EmpID: number;
  QueueDate: string;
  Status: string;
  ServiceStartedAt: Date | null;
  DurationMinutes: number;
  TicketCode?: string;
}

interface BookingRow {
  BookingID: number;
  AssignedEmpID: number;
  BookingDate: string;
  StartTime: string;
  EndTime: string | null;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/available-days
 *
 * Phase 4B: Batch-optimized version
 * All data preloaded in 3-4 queries, then pure in-memory computation
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "طلبات كثيرة" },
      { status: 429, headers: PUBLIC_CORS_HEADERS },
    );
  }

  try {
    const { searchParams } = new URL(req.url);
    const serviceIdsParam = searchParams.get("serviceIds") ?? "";
    const mode = (searchParams.get("mode") ?? "nearest") as
      | "nearest"
      | "specific";
    const empIdParam = searchParams.get("empId");
    const fromDateParam = searchParams.get("fromDate");

    const serviceIds = serviceIdsParam
      ? serviceIdsParam
          .split(",")
          .map(Number)
          .filter((n) => n > 0)
      : [];
    const empId = empIdParam ? Number(empIdParam) : null;

    // Validate specific mode has empId
    if (mode === "specific" && !empId) {
      return NextResponse.json(
        { ok: false, error: "empId مطلوب في وضع specific" },
        { status: 400, headers: PUBLIC_CORS_HEADERS },
      );
    }

    const settings = await getPublicSettings();
    const totalDays = settings.maxBookingDaysAhead;
    const minNotice = settings.minNoticeMinutes;
    const slotIntervalMinutes = settings.slotIntervalMinutes;

    // Start from today (Cairo local date)
    const todayStr = cairoDateStr(new Date());
    const startDate =
      fromDateParam && isValidDate(fromDateParam) ? fromDateParam : todayStr;
    const startMs = Date.parse(startDate);
    const nowMs = Date.now();

    // Calculate end date
    const endMs = startMs + (totalDays - 1) * 86_400_000;
    const endDate = new Date(endMs).toISOString().slice(0, 10);

    const db = await getPool();

    // Pre-load service duration once
    const defaultDur = await getDefaultDuration(db);
    const customerDur = await getServicesDuration(db, serviceIds, defaultDur);

    // Determine barber list
    let barberIds: number[] = [];
    let specificBarberInfo: { id: number; name: string } | null = null;

    if (mode === "specific" && empId) {
      // Validate specific barber exists and is bookable
      const empRes = await db.request().input("eid", sql.Int, empId).query(`
          SELECT EmpID, EmpName, Job, ISNULL(isActive, 1) AS isActive
          FROM [dbo].[TblEmp]
          WHERE EmpID = @eid
        `);

      if (empRes.recordset.length === 0) {
        const days = generateAllUnavailableDays(
          startMs,
          totalDays,
          REASON_CODES.BARBER_NOT_FOUND,
          "الحلاق غير موجود",
        );
        return NextResponse.json(
          { ok: true, mode, empId, days },
          { headers: PUBLIC_CORS_HEADERS },
        );
      }

      const emp = empRes.recordset[0];
      const isBarberJob = ["حلاق", "مساعد", "Barber", "barber"].includes(
        emp.Job,
      );
      const isActive = emp.isActive === 1 || emp.isActive === true;

      if (!isBarberJob || !isActive) {
        const days = generateAllUnavailableDays(
          startMs,
          totalDays,
          REASON_CODES.BARBER_NOT_BOOKABLE,
          !isBarberJob ? "هذا الموظف ليس حلاقاً" : "الحلاق غير نشط",
        );
        return NextResponse.json(
          { ok: true, mode, empId, days },
          { headers: PUBLIC_CORS_HEADERS },
        );
      }

      barberIds = [empId];
      specificBarberInfo = { id: empId, name: emp.EmpName };
    } else {
      // Nearest mode: get all bookable barbers
      const bRes = await db.request().query(`
        SELECT EmpID FROM [dbo].[TblEmp]
        WHERE ISNULL(isActive,1)=1
          AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber')
      `);
      barberIds = bRes.recordset.map((r) => r.EmpID as number);
    }

    if (barberIds.length === 0) {
      const days = generateAllUnavailableDays(
        startMs,
        totalDays,
        REASON_CODES.NO_WORKING_SCHEDULE,
        "لا يوجد حلاق متاح",
      );
      return NextResponse.json(
        { ok: true, mode, ...(empId ? { empId } : {}), days },
        { headers: PUBLIC_CORS_HEADERS },
      );
    }

    // =====================================================
    // BATCH PRELOAD ALL DATA (3-4 queries total)
    // =====================================================

    // Guard: if no barbers, return all unavailable
    if (barberIds.length === 0) {
      const days = generateAllUnavailableDays(
        startMs,
        totalDays,
        REASON_CODES.NO_WORKING_SCHEDULE,
        "لا يوجد حلاق متاح",
      );
      return NextResponse.json(
        { ok: true, mode, ...(empId ? { empId } : {}), days },
        { headers: PUBLIC_CORS_HEADERS },
      );
    }

    const barberIdList = barberIds.join(",");
    console.log("[available-days] barberIdList:", barberIdList);

    // Check table existence first
    const tableCheck = await db.request().query(`
      SELECT 
        OBJECT_ID('dbo.TblEmpWorkSchedule') as schedule_oid,
        OBJECT_ID('dbo.QueueTickets') as queue_oid,
        OBJECT_ID('dbo.Bookings') as bookings_oid,
        OBJECT_ID('dbo.TblEmpDayOff') as dayoff_oid
    `);

    const tableExists = {
      schedule: tableCheck.recordset[0].schedule_oid !== null,
      queue: tableCheck.recordset[0].queue_oid !== null,
      bookings: tableCheck.recordset[0].bookings_oid !== null,
      dayOff: tableCheck.recordset[0].dayoff_oid !== null,
    };

    console.log("[available-days] table existence:", tableExists);

    // 1. Batch preload all schedules
    const schedulesPromise = tableExists.schedule
      ? db
          .request()
          .query(
            `
          SELECT EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime
          FROM dbo.TblEmpWorkSchedule
          WHERE EmpID IN (${barberIdList})
        `,
          )
          .catch((err) => {
            console.error(
              "[available-days] schedule query error:",
              err.message,
            );
            return { recordset: [] };
          })
      : Promise.resolve({ recordset: [] });

    // 2. Batch preload all queue tickets for date range
    const queuePromise = tableExists.queue
      ? db
          .request()
          .input("startDate", sql.Date, startDate)
          .input("endDate", sql.Date, endDate)
          .query(
            `
            SELECT 
              qt.QueueTicketID,
              qt.EmpID,
              qt.QueueDate,
              qt.Status,
              qt.ServiceStartedAt,
              qt.TicketCode,
              CASE WHEN COL_LENGTH('dbo.QueueTickets','DurationMinutes') IS NOT NULL
                   THEN ISNULL(qt.DurationMinutes, 30) ELSE 30 END AS DurationMinutes
            FROM dbo.QueueTickets qt
            WHERE qt.EmpID IN (${barberIdList})
              AND qt.QueueDate BETWEEN @startDate AND @endDate
              AND LOWER(qt.Status) IN ('waiting','called','in_service')
          `,
          )
          .catch((err) => {
            console.error("[available-days] queue query error:", err?.message ?? err);
            return { recordset: [] };
          })
      : Promise.resolve({ recordset: [] });

    // 3. Batch preload all bookings for date range
    const bookingsPromise = tableExists.bookings
      ? db
          .request()
          .input("startDate", sql.Date, startDate)
          .input("endDate", sql.Date, endDate)
          .query(
            `
            SELECT 
              b.BookingID,
              b.AssignedEmpID,
              b.BookingDate,
              b.StartTime,
              b.EndTime
            FROM dbo.Bookings b
            WHERE b.AssignedEmpID IN (${barberIdList})
              AND b.BookingDate BETWEEN @startDate AND @endDate
              AND LOWER(b.Status) IN ('confirmed','arrived','queued','in_service')
          `,
          )
          .catch((err) => {
            console.error(
              "[available-days] bookings query error:",
              err.message,
            );
            return { recordset: [] };
          })
      : Promise.resolve({ recordset: [] });

    // 4. Check if TblEmpDayOff exists and preload if so
    const dayOffPromise = tableExists.dayOff
      ? db
          .request()
          .input("startDate", sql.Date, startDate)
          .input("endDate", sql.Date, endDate)
          .query(
            `
            SELECT EmpID, OffDate, Reason
            FROM dbo.TblEmpDayOff
            WHERE EmpID IN (${barberIdList})
              AND OffDate BETWEEN @startDate AND @endDate
          `,
          )
          .catch((err) => {
            console.error("[available-days] dayOff query error:", err.message);
            return { recordset: [] };
          })
      : Promise.resolve({ recordset: [] });

    // 5. Preload overrides for the entire date range
    // We load them date-by-date in the loop (lightweight: only a few overrides per day).
    // For the batch approach we load once per date inside computeDayAvailabilityInMemory
    // via a pre-built overridesRangeMap: dateStr → Map<empId, ScheduleOverride[]>
    const overridesRangeRes = tableExists.schedule
      ? await db
          .request()
          .input("startDate", sql.Date, startDate)
          .input("endDate", sql.Date, endDate)
          .query(
            `
            SELECT
              OverrideID, EmpID,
              CONVERT(VARCHAR(10), OverrideDate, 120) AS OverrideDate,
              Type,
              CASE WHEN StartTime IS NOT NULL
                   THEN LEFT(CONVERT(VARCHAR(8), StartTime, 108), 5)
                   ELSE NULL END AS StartTime,
              CASE WHEN EndTime IS NOT NULL
                   THEN LEFT(CONVERT(VARCHAR(8), EndTime, 108), 5)
                   ELSE NULL END AS EndTime,
              Reason, IsActive, CreatedBy,
              CONVERT(VARCHAR(30), CreatedAt, 126) AS CreatedAt
            FROM dbo.TblEmpScheduleOverrides
            WHERE EmpID IN (${barberIdList})
              AND OverrideDate BETWEEN @startDate AND @endDate
              AND IsActive = 1
          `,
          )
          .catch(() => ({ recordset: [] as ScheduleOverride[] }))
      : { recordset: [] as ScheduleOverride[] };

    // Build overrides map: dateStr → Map<empId, ScheduleOverride[]>
    const overridesRangeMap = new Map<
      string,
      Map<number, ScheduleOverride[]>
    >();
    for (const row of overridesRangeRes.recordset) {
      const d = row.OverrideDate;
      if (!overridesRangeMap.has(d)) overridesRangeMap.set(d, new Map());
      const empMap = overridesRangeMap.get(d)!;
      const list = empMap.get(row.EmpID) ?? [];
      list.push(row);
      empMap.set(row.EmpID, list);
    }

    // Wait for all batch queries
    const [schedulesRes, queueRes, bookingsRes, dayOffRes] = await Promise.all([
      schedulesPromise,
      queuePromise,
      bookingsPromise,
      dayOffPromise,
    ]);

    console.log("[available-days] query results:", {
      schedules: schedulesRes.recordset?.length || 0,
      queue: queueRes.recordset?.length || 0,
      bookings: bookingsRes.recordset?.length || 0,
      dayOffs: dayOffRes.recordset?.length || 0,
    });

    // Build lookup maps for O(1) access
    const scheduleMap = buildScheduleMap(
      schedulesRes.recordset as ScheduleRow[],
    );
    const queueMap = buildQueueMap(queueRes.recordset as QueueTicketRow[]);
    const bookingMap = buildBookingMap(bookingsRes.recordset as BookingRow[]);
    const dayOffMap = buildDayOffMap(dayOffRes.recordset as DayOffRow[]);

    // =====================================================
    // IN-MEMORY COMPUTATION (no DB calls)
    // =====================================================

    const days: DayResult[] = [];

    for (let i = 0; i < totalDays; i++) {
      const ms = startMs + i * 86_400_000;
      const dateStr = new Date(ms).toISOString().slice(0, 10);
      const dow = new Date(ms).getDay();
      const label = AR_DAYS[dow];

      const dateOverridesMap =
        overridesRangeMap.get(dateStr) ?? new Map<number, ScheduleOverride[]>();

      const dayResult = computeDayAvailabilityInMemory(
        dateStr,
        dow,
        barberIds,
        mode,
        specificBarberInfo,
        customerDur,
        minNotice,
        nowMs,
        slotIntervalMinutes,
        scheduleMap,
        queueMap,
        bookingMap,
        dayOffMap,
        dateOverridesMap,
      );

      days.push({
        date: dateStr,
        available: dayResult.available,
        label,
        ...(dayResult.reason ? { reason: dayResult.reason } : {}),
        ...(dayResult.reasonCode ? { reasonCode: dayResult.reasonCode } : {}),
      });
    }

    return NextResponse.json(
      {
        ok: true,
        mode,
        ...(mode === "specific" && empId ? { empId } : {}),
        days,
      },
      { headers: PUBLIC_CORS_HEADERS },
    );
  } catch (err: any) {
    console.error("[available-days] error", {
      message: err?.message,
      stack: err?.stack,
      name: err?.name,
    });

    // In development, return debug details
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json(
        {
          ok: false,
          error: "فشل تحميل الأيام المتاحة",
          debug: {
            message: err?.message,
            stack: err?.stack,
          },
        },
        { status: 500, headers: PUBLIC_CORS_HEADERS },
      );
    }

    return NextResponse.json(
      { ok: false, error: "فشل تحميل الأيام المتاحة" },
      { status: 500, headers: PUBLIC_CORS_HEADERS },
    );
  }
}

// Build schedule lookup map: key = `${empId}:${dayOfWeek}`
function buildScheduleMap(rows: ScheduleRow[]): Map<string, ScheduleRow> {
  const map = new Map<string, ScheduleRow>();
  for (const row of rows) {
    const key = `${row.EmpID}:${row.DayOfWeek}`;
    map.set(key, row);
  }
  return map;
}

// Build queue tickets lookup map: key = `${empId}:${dateStr}`
function buildQueueMap(rows: QueueTicketRow[]): Map<string, QueueTicketRow[]> {
  const map = new Map<string, QueueTicketRow[]>();
  for (const row of rows) {
    const dateStr = new Date(row.QueueDate).toISOString().slice(0, 10);
    const key = `${row.EmpID}:${dateStr}`;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(row);
  }
  return map;
}

// Build bookings lookup map: key = `${empId}:${dateStr}`
function buildBookingMap(rows: BookingRow[]): Map<string, BookingRow[]> {
  const map = new Map<string, BookingRow[]>();
  for (const row of rows) {
    const dateStr = new Date(row.BookingDate).toISOString().slice(0, 10);
    const key = `${row.AssignedEmpID}:${dateStr}`;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(row);
  }
  return map;
}

// Build day off lookup map: key = `${empId}:${dateStr}`
function buildDayOffMap(rows: DayOffRow[]): Map<string, DayOffRow> {
  const map = new Map<string, DayOffRow>();
  for (const row of rows) {
    const dateStr = new Date(row.OffDate).toISOString().slice(0, 10);
    const key = `${row.EmpID}:${dateStr}`;
    map.set(key, row);
  }
  return map;
}

// Pure in-memory computation (no DB calls)
function computeDayAvailabilityInMemory(
  dateStr: string,
  dayOfWeek: number,
  barberIds: number[],
  mode: "nearest" | "specific",
  specificBarberInfo: { id: number; name: string } | null,
  customerDur: number,
  minNoticeMinutes: number,
  nowMs: number,
  slotIntervalMinutes: number,
  scheduleMap: Map<string, ScheduleRow>,
  queueMap: Map<string, QueueTicketRow[]>,
  bookingMap: Map<string, BookingRow[]>,
  dayOffMap: Map<string, DayOffRow>,
  overridesForDate: Map<number, ScheduleOverride[]> = new Map(),
): { available: boolean; reason?: string; reasonCode?: ReasonCode } {
  const barbersToCheck =
    mode === "specific" && specificBarberInfo
      ? [specificBarberInfo.id]
      : barberIds;

  for (const empId of barbersToCheck) {
    // 1. Check schedule
    const scheduleKey = `${empId}:${dayOfWeek}`;
    const schedule = scheduleMap.get(scheduleKey);

    if (!schedule || !schedule.IsWorkingDay) {
      if (mode === "specific" && barbersToCheck.length === 1) {
        return {
          available: false,
          reason: "إجازة أسبوعية",
          reasonCode: REASON_CODES.DAY_OFF,
        };
      }
      continue; // Try next barber
    }

    if (!schedule.StartTime || !schedule.EndTime) {
      if (mode === "specific" && barbersToCheck.length === 1) {
        return {
          available: false,
          reason: "لا توجد مواعيد عمل لهذا الحلاق في هذا اليوم",
          reasonCode: REASON_CODES.NO_WORKING_SCHEDULE,
        };
      }
      continue;
    }

    // 2. Check day off (TblEmpDayOff)
    const dayOffKey = `${empId}:${dateStr}`;
    if (dayOffMap.has(dayOffKey)) {
      if (mode === "specific" && barbersToCheck.length === 1) {
        const dayOff = dayOffMap.get(dayOffKey)!;
        return {
          available: false,
          reason: dayOff.Reason || "إجازة",
          reasonCode: REASON_CODES.DAY_OFF,
        };
      }
      continue;
    }

    // 2b. Apply schedule overrides
    const empOverrides = overridesForDate.get(empId) ?? [];
    const baseSchedule = {
      isWorking: !!schedule.IsWorkingDay,
      start: schedule.StartTime ?? "09:00",
      end: schedule.EndTime ?? "23:00",
    };
    const effSched = applyOverrides(empId, dateStr, baseSchedule, empOverrides);

    if (!effSched.isWorking) {
      if (mode === "specific" && barbersToCheck.length === 1) {
        return {
          available: false,
          reason: "employee_day_off",
          reasonCode: REASON_CODES.DAY_OFF,
        };
      }
      continue;
    }

    // Use effective (overridden) start/end for slot generation
    const effectiveStart = effSched.start;
    const effectiveEnd = effSched.end;

    // 3. Build blocking intervals from queue, bookings, and override block_ranges
    const queueKey = `${empId}:${dateStr}`;
    const queueTickets = queueMap.get(queueKey) || [];
    const bookings = bookingMap.get(queueKey) || [];

    const intervals: Interval[] = [];

    // Add queue intervals (sequential placement)
    let cursor = new Date(nowMs);
    for (const ticket of queueTickets) {
      const start = ticket.ServiceStartedAt
        ? new Date(ticket.ServiceStartedAt)
        : new Date(cursor);
      const end = new Date(start.getTime() + ticket.DurationMinutes * 60000);
      intervals.push({ start, end, source: "queue", id: ticket.QueueTicketID });
      if (end > cursor) cursor = end;
    }

    // Add booking intervals
    for (const booking of bookings) {
      const start = sqlTimeToDate(dateStr, booking.StartTime);
      const end = booking.EndTime
        ? sqlTimeToDate(dateStr, booking.EndTime)
        : new Date(start.getTime() + customerDur * 60000);
      intervals.push({ start, end, source: "booking", id: booking.BookingID });
    }

    // Add block_range override intervals
    for (const iv of effSched.blockedIntervals) {
      intervals.push({
        start: new Date(iv.startMs),
        end: new Date(iv.endMs),
        source: "queue",
        id: -1,
      });
    }

    // Sort intervals by start time
    intervals.sort((a, b) => a.start.getTime() - b.start.getTime());

    // 4. Generate slots using effective schedule boundaries
    const startMin = timeToMinutes(effectiveStart);
    const endMin = timeToMinutes(effectiveEnd);

    // Generate slots
    const slots: string[] = [];
    if (startMin <= endMin) {
      // Normal shift
      for (let m = startMin; m < endMin; m += slotIntervalMinutes) {
        const hh = Math.floor(m / 60)
          .toString()
          .padStart(2, "0");
        const mm = (m % 60).toString().padStart(2, "0");
        slots.push(`${hh}:${mm}`);
      }
    } else {
      // Overnight shift (e.g., 15:00-02:00)
      for (let m = startMin; m < 24 * 60; m += slotIntervalMinutes) {
        const hh = Math.floor(m / 60)
          .toString()
          .padStart(2, "0");
        const mm = (m % 60).toString().padStart(2, "0");
        slots.push(`${hh}:${mm}`);
      }
      for (let m = 0; m < endMin; m += slotIntervalMinutes) {
        const hh = Math.floor(m / 60)
          .toString()
          .padStart(2, "0");
        const mm = (m % 60).toString().padStart(2, "0");
        slots.push(`${hh}:${mm}`);
      }
    }

    // Check each slot (early exit on first available)
    for (const time of slots) {
      const slotDt = new Date(`${dateStr}T${time}:00`);
      const slotMs = slotDt.getTime();

      // Skip past slots
      if (slotMs - nowMs < minNoticeMinutes * 60_000) {
        continue;
      }

      const slotEnd = new Date(slotMs + customerDur * 60000);

      // Check overlap with blocking intervals
      let hasConflict = false;
      for (const iv of intervals) {
        if (slotDt < iv.end && slotEnd > iv.start) {
          hasConflict = true;
          break;
        }
      }

      if (!hasConflict) {
        // Found available slot!
        return { available: true };
      }
    }

    // No slots available for this barber
    if (mode === "specific" && barbersToCheck.length === 1) {
      const reason =
        queueTickets.length > 0
          ? `لديه ${queueTickets.length} ${queueTickets.length === 1 ? "دور متوقع" : "أدوار متوقعة"}`
          : "لا توجد مواعيد متاحة";
      return {
        available: false,
        reason,
        reasonCode:
          queueTickets.length > 0
            ? REASON_CODES.QUEUE_BLOCKED
            : REASON_CODES.NO_AVAILABLE_SLOTS,
      };
    }
  }

  // No barber has available slots
  return {
    available: false,
    reason:
      mode === "specific"
        ? "لا توجد مواعيد متاحة"
        : "لا يوجد حلاق متاح في هذا اليوم",
  };
}

// Helper: Convert SQL time to Date
function sqlTimeToDate(dateStr: string, timeVal: string | Date): Date {
  let hhmm = "00:00";

  if (timeVal instanceof Date) {
    hhmm = `${String(timeVal.getHours()).padStart(2, "0")}:${String(timeVal.getMinutes()).padStart(2, "0")}`;
  } else if (typeof timeVal === "string") {
    hhmm = timeVal.slice(0, 5);
  }

  return new Date(`${dateStr}T${hhmm}:00`);
}

// Helper: Convert time string or Date to minutes
function timeToMinutes(t: string | Date | null): number {
  if (!t) return 0;

  // If it's a Date object, extract hours and minutes
  if (t instanceof Date) {
    return t.getHours() * 60 + t.getMinutes();
  }

  // If it's a string (expected format "HH:MM" or "HH:MM:SS")
  if (typeof t === "string") {
    const [h, m] = t.slice(0, 5).split(":").map(Number);
    return h * 60 + m;
  }

  return 0;
}

// Generate all unavailable days with the same reason
function generateAllUnavailableDays(
  startMs: number,
  totalDays: number,
  reasonCode: ReasonCode,
  reason: string,
): DayResult[] {
  const days: DayResult[] = [];
  for (let i = 0; i < totalDays; i++) {
    const ms = startMs + i * 86_400_000;
    const dateStr = new Date(ms).toISOString().slice(0, 10);
    const dow = new Date(ms).getDay();
    days.push({
      date: dateStr,
      available: false,
      label: AR_DAYS[dow],
      reason,
      reasonCode,
    });
  }
  return days;
}
