/**
 * queueEstimateEngine.ts — v2 (shared queue + booking timeline engine)
 *
 * Shared estimation engine used by both:
 *   POST /api/queue/estimate  — UI preview
 *   POST /api/queue           — actual ticket creation (inside transaction)
 *
 * Core logic:
 *   1. Load active queue tickets for the barber (with their EstimatedStartTime + service duration).
 *   2. Load active bookings for the barber (with their StartTime/EndTime).
 *   3. Convert both into concrete [start, end] intervals.
 *   4. Sort all intervals.
 *   5. Walk forward from `now` finding the first gap >= newCustomerDuration
 *      that does not overlap any interval and is inside working hours.
 */

import { getPool, sql } from "@/lib/db";
import {
  getBarberAvailabilityReason,
  getBarberWorkingWindow,
} from "@/lib/barberAvailability";
import { salonDateTimeToMs } from "@/lib/publicBookingHelpers";
import { getCairoBusinessDate } from "@/lib/businessDate";
import { normalizeBookingTimes } from "@/lib/bookingDateTime";
import { ACTIVE_BOOKING_BLOCK_STATUSES, intervalsOverlap } from "@/lib/scheduleIntervals";

const SALON_TZ = 'Africa/Cairo';

const DEBUG_BOOKING = process.env.DEBUG_BOOKING === "true";

// ── Stale Queue Ticket Detection ─────────────────────────────────────────────

const STALE_GRACE_MINUTES = 30; // Grace period after estimated end time

export interface QueueTicketRow {
  QueueTicketID: number;
  TicketCode: string;
  TicketNumber: number;
  Status: string;
  EmpID: number;
  ServiceStartedAt?: Date | null;
  EstimatedStartTime?: Date | null;
  DurationMinutes: number;
  CreatedTime?: Date | null;
}

/**
 * Check if a queue ticket is "stale" - meaning its estimated time has passed
 * and it should no longer block new tickets.
 * 
 * Stale rules:
 * - in_service: never stale (always a blocker until completed)
 * - waiting/called: stale if estimatedEnd + grace < now
 */
export function isQueueTicketStale(
  ticket: QueueTicketRow,
  now: Date,
  graceMinutes: number = STALE_GRACE_MINUTES
): boolean {
  // in_service tickets are never stale - they're actively being served
  if (String(ticket.Status).toLowerCase() === "in_service") {
    return false;
  }

  // If no estimated start time, check CreatedTime as fallback
  const estimatedStart = ticket.EstimatedStartTime
    ? new Date(ticket.EstimatedStartTime)
    : ticket.CreatedTime
      ? new Date(ticket.CreatedTime)
      : null;

  if (!estimatedStart) {
    // No time reference - consider it stale if very old ( > 4 hours)
    const createdTime = ticket.CreatedTime ? new Date(ticket.CreatedTime) : null;
    if (!createdTime) return false; // Can't determine, treat as active
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60000);
    return createdTime < fourHoursAgo;
  }

  const duration = Math.max(1, Number(ticket.DurationMinutes) || 30);
  const estimatedEnd = new Date(estimatedStart.getTime() + duration * 60000);
  const staleAfter = new Date(estimatedEnd.getTime() + graceMinutes * 60000);

  return staleAfter < now;
}

/**
 * Classify queue tickets into active and stale for debugging
 */
export function classifyQueueTickets(
  tickets: QueueTicketRow[],
  now: Date,
  graceMinutes: number = STALE_GRACE_MINUTES
): { active: QueueTicketRow[]; stale: QueueTicketRow[] } {
  const active: QueueTicketRow[] = [];
  const stale: QueueTicketRow[] = [];

  for (const ticket of tickets) {
    if (isQueueTicketStale(ticket, now, graceMinutes)) {
      stale.push(ticket);
    } else {
      active.push(ticket);
    }
  }

  return { active, stale };
}

export interface Interval {
  start: Date;
  end: Date;
  source: "queue" | "booking";
  id: number;
  label?: string;
  ticketCode?: string;
}

export {
  countQueueCustomersAhead,
  normalizeCustomersAhead,
} from './queueCustomersAhead';

export interface BarberEstimate {
  empId: number;
  empName: string;
  estimatedStartTime: string; // ISO
  estimatedWaitMinutes: number;
  waitingCount: number;
  isWorking: boolean;
  unavailableReason?: string;
  blockingQueueCount: number;
  blockingBookingCount: number;
  blockingQueueTickets: Array<{
    id: number;
    estimatedStart: string;
    durationMin: number;
  }>;
  blockingBookings: Array<{ id: number; start: string; end: string }>;
  blockingTickets: Array<{
    ticketCode: string;
    status: string;
    estimatedStart: string;
  }>;
}

// ── Booking availability result ───────────────────────────────────────────────

export interface BookingAvailability {
  empId: number;
  empName: string;
  available: boolean;
  reason: string | null;
  conflictType: "working_hours" | "day_off" | "queue" | "booking" | null;
  conflictingTickets: Array<{
    ticketCode: string;
    status: string;
    start: string;
    end: string;
  }>;
  conflictingBookings: Array<{ bookingId: number; start: string; end: string }>;
  suggestedStartTime: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Cairo local date string YYYY-MM-DD */
export function cairoDateStr(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
}

/**
 * Convert a SQL Time value (string "HH:MM:SS" or Date) and a date string
 * into a full Date object in local (server) time.
 */
export function sqlTimeToDate(dateStr: string, timeVal: unknown): Date {
  let hhmm = "00:00";
  if (typeof timeVal === "string") hhmm = timeVal.slice(0, 5);
  else if (timeVal instanceof Date) {
    // mssql returns TIME columns as Date anchored to 1970-01-01 UTC — use UTC hours
    hhmm = `${String(timeVal.getUTCHours()).padStart(2, "0")}:${String(timeVal.getUTCMinutes()).padStart(2, "0")}`;
  }
  // Use salon timezone-aware epoch so booking intervals align with slot epochs
  return new Date(salonDateTimeToMs(dateStr, hhmm, SALON_TZ));
}

// ── Default durations ─────────────────────────────────────────────────────────

export async function getDefaultDuration(
  db: Awaited<ReturnType<typeof getPool>>,
): Promise<number> {
  try {
    const r = await db
      .request()
      .query(
        `SELECT TOP 1 DefaultServiceMinutes FROM [dbo].[QueueBookingSettings]`,
      );
    return r.recordset[0]?.DefaultServiceMinutes ?? 30;
  } catch {
    return 30;
  }
}

export async function getServicesDuration(
  db: Awaited<ReturnType<typeof getPool>>,
  serviceIds: number[],
  fallback: number,
): Promise<number> {
  if (!serviceIds.length) return fallback;
  try {
    const { calculateServicePlanDuration } = await import('@/lib/servicePlan');
    const plan = await calculateServicePlanDuration(serviceIds);
    if (plan.durationSource === 'LEGACY_FALLBACK') return fallback;
    return plan.totalDurationMinutes;
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[getServicesDuration] servicePlan failed, using SQL sum fallback', err);
    }
    const uniqueIds = [...new Set(serviceIds)];
    const r = db.request();
    uniqueIds.forEach((id, i) => r.input(`id${i}`, sql.Int, id));
    const res = await r.query(`
      SELECT SUM(ISNULL(p.DurationMinutes, ${fallback})) AS total
      FROM [dbo].[TblPro] p
      WHERE p.ProID IN (${uniqueIds.map((_, i) => `@id${i}`).join(',')})
        AND (p.isDeleted = 0 OR p.isDeleted IS NULL)
    `);
    const sum = Number(res.recordset[0]?.total);
    if (sum > 0) return sum;
    throw err;
  }
}

// ── Interval builder ──────────────────────────────────────────────────────────

/**
 * Load all active queue tickets for the barber on the given date
 * and convert them to [start, end] intervals.
 *
 * Priority order for start time:
 *   1. ticket.EstimatedStartTime (already reserved)
 *   2. ticket.ServiceStartedAt   (currently in-service)
 *   3. Sequential placement after the last known slot (fallback for old tickets without EstimatedStartTime)
 */
export async function buildQueueIntervals(
  db: Awaited<ReturnType<typeof getPool>>,
  empId: number,
  dateStr: string, // YYYY-MM-DD
  now: Date, // actual current time — cursor starts here
  defaultDuration: number,
  excludeTicketId?: number, // skip this ticket (for re-estimate of existing)
  options?: {
    filterStale?: boolean; // if true, exclude stale tickets (default: true for operations)
    graceMinutes?: number;
    debugContext?: string; // for logging context
  },
): Promise<Interval[]> {
  const { filterStale = true, graceMinutes = STALE_GRACE_MINUTES, debugContext = "" } = options || {};
  // Build SELECT defensively — guard QueueTicketServices with OBJECT_ID check
  // so when the table doesn't exist the whole query doesn't crash
  const svcTableExists = await db
    .request()
    .query(`SELECT OBJECT_ID('dbo.QueueTicketServices') AS oid`)
    .then((r: any) => r.recordset[0]?.oid != null)
    .catch(() => false);

  if (DEBUG_BOOKING)
    console.log(
      "[buildQueueIntervals] empId",
      empId,
      "dateStr",
      dateStr,
      "svcTableExists",
      svcTableExists,
      "filterStale",
      filterStale,
    );

  const durationSql = svcTableExists
    ? `ISNULL(
        (SELECT SUM(ISNULL(qts.DurationMinutes, ${defaultDuration}))
         FROM [dbo].[QueueTicketServices] qts
         WHERE qts.QueueTicketID = qt.QueueTicketID),
        ${defaultDuration}
      )`
    : `${defaultDuration}`;

  const estSelectSql = `
    CASE WHEN COL_LENGTH('dbo.QueueTickets','EstimatedStartTime') IS NOT NULL
         THEN qt.EstimatedStartTime ELSE NULL END AS EstimatedStartTime,
    ${durationSql} AS DurationMinutes
  `;

  const res = await db
    .request()
    .input("qdate", sql.Date, dateStr)
    .input("empId", sql.Int, empId)
    .query(
      `
      SELECT
        qt.QueueTicketID,
        qt.TicketCode,
        qt.TicketNumber,
        qt.Status,
        qt.EmpID,
        qt.ServiceStartedAt,
        ${estSelectSql}
      FROM [dbo].[QueueTickets] qt
      WHERE qt.QueueDate = @qdate
        AND qt.EmpID     = @empId
        AND LOWER(qt.Status) IN ('waiting','called','in_service')
      ORDER BY
        CASE LOWER(qt.Status) WHEN 'in_service' THEN 0 WHEN 'called' THEN 1 ELSE 2 END ASC,
        ISNULL(
          CASE WHEN COL_LENGTH('dbo.QueueTickets','EstimatedStartTime') IS NOT NULL
               THEN qt.EstimatedStartTime ELSE NULL END,
          qt.CreatedTime
        ) ASC,
        qt.TicketNumber ASC
    `,
    )
    .catch((err: any) => {
      console.error("[buildQueueIntervals] query error", err?.message ?? err);
      return { recordset: [] as any[] };
    });

  if (DEBUG_BOOKING) {
    console.log(
      "[timeline] empId",
      empId,
      "activeQueueTickets count",
      res.recordset.length,
    );
  }

  // Classify tickets into active and stale
  const allTickets = res.recordset.filter(
    (t: any) => !excludeTicketId || t.QueueTicketID !== excludeTicketId
  );

  const { active: activeTickets, stale: staleTickets } = classifyQueueTickets(
    allTickets as QueueTicketRow[],
    now,
    graceMinutes
  );

  // Log classification for debugging
  if (DEBUG_BOOKING || staleTickets.length > 0) {
    console.log(`[buildQueueIntervals] ${debugContext}`, {
      empId,
      total: allTickets.length,
      active: activeTickets.length,
      stale: staleTickets.length,
      staleDetails: staleTickets.map(t => ({
        id: t.QueueTicketID,
        code: t.TicketCode,
        status: t.Status,
        estimatedStart: t.EstimatedStartTime,
        duration: t.DurationMinutes,
      })),
    });
  }

  // Use only active tickets for interval building (if filterStale is true)
  const ticketsToUse = filterStale ? activeTickets : allTickets;

  const intervals: Interval[] = [];

  // Step 1: handle in_service ticket first (if any) — it has a real start in the past
  const inServiceTickets = ticketsToUse.filter(
    (t) => String(t.Status).toLowerCase() === "in_service",
  );
  const otherTickets = ticketsToUse.filter(
    (t) => String(t.Status).toLowerCase() !== "in_service",
  );

  // cursor: the end of the last placed interval — new tickets start here
  let cursor = new Date(now);

  for (const t of inServiceTickets) {
    const dur = Math.max(1, Number(t.DurationMinutes) || defaultDuration);
    const start = t.ServiceStartedAt
      ? new Date(t.ServiceStartedAt)
      : new Date(now);
    const end = new Date(start.getTime() + dur * 60000);
    intervals.push({
      start,
      end,
      source: "queue",
      id: t.QueueTicketID,
      label: t.Status,
      ticketCode: t.TicketCode,
    });
    // cursor must be at least the end of in_service (even if that's in the future)
    if (end > cursor) cursor = end;
  }

  // Step 2: For waiting/called tickets, use their stored EstimatedStartTime if available
  // This is CRITICAL for conflict detection - we must use the ACTUAL stored intervals
  // not recompute them, or we won't detect overlaps with bookings correctly.
  for (const t of otherTickets) {
    const dur = Math.max(1, Number(t.DurationMinutes) || defaultDuration);

    // Priority for start time:
    // 1. Stored EstimatedStartTime (already reserved slot)
    // 2. Sequential placement from cursor (fallback for old tickets without estimate)
    let start: Date;
    const storedEstStart = t.EstimatedStartTime
      ? new Date(t.EstimatedStartTime)
      : null;

    if (storedEstStart && storedEstStart.getTime() > 0) {
      // Use the stored estimated start time (this is the actual reservation)
      start = storedEstStart;
    } else {
      // Fallback: place sequentially from cursor (for old tickets without estimate)
      start = new Date(cursor);
    }

    const end = new Date(start.getTime() + dur * 60000);
    intervals.push({
      start,
      end,
      source: "queue",
      id: t.QueueTicketID,
      label: t.Status,
      ticketCode: t.TicketCode,
    });

    // Advance cursor to after this ticket's end (for sequential fallback of future tickets)
    if (end > cursor) cursor = end;
  }

  // Log the built intervals for debugging overlap detection
  if (DEBUG_BOOKING || intervals.length > 0) {
    console.log(`[buildQueueIntervals] ${debugContext} Built intervals:`, intervals.map(iv => ({
      id: iv.id,
      code: iv.ticketCode,
      source: iv.source,
      start: iv.start.toISOString(),
      end: iv.end.toISOString(),
      label: iv.label,
    })));
  }

  if (DEBUG_BOOKING) {
    const totalQueueBlockMinutes =
      intervals.length > 0
        ? Math.round((cursor.getTime() - now.getTime()) / 60000)
        : 0;
    console.log("[timeline] totalQueueBlockMinutes", totalQueueBlockMinutes);
  }

  return intervals;
}

/**
 * Load active bookings for the barber on the given date and convert to intervals.
 */
export async function buildBookingIntervals(
  db: Awaited<ReturnType<typeof getPool>>,
  empId: number,
  dateStr: string,
  defaultDuration: number,
): Promise<Interval[]> {
  const statusList = ACTIVE_BOOKING_BLOCK_STATUSES.map((s) => `'${s}'`).join(',');

  const res = await db
    .request()
    .input("bdate", sql.Date, dateStr)
    .input("empId", sql.Int, empId)
    .query(
      `
      SELECT
        b.BookingID,
        b.BookingDate,
        b.StartTime,
        b.EndTime,
        b.Status,
        ISNULL((
          SELECT SUM(bs.DurationMinutes)
          FROM [dbo].[BookingServices] bs
          WHERE bs.BookingID = b.BookingID
        ), 0) AS TotalDuration
      FROM [dbo].[Bookings] b
      WHERE b.BookingDate     = @bdate
        AND b.AssignedEmpID   = @empId
        AND LOWER(b.Status) IN (${statusList})
      ORDER BY b.StartTime ASC
    `,
    )
    .catch(() => ({ recordset: [] as any[] }));

  return res.recordset.map((b: {
    BookingID: number;
    BookingDate: unknown;
    StartTime: unknown;
    EndTime: unknown;
    TotalDuration: number;
  }) => {
    const totalDuration = b.TotalDuration > 0 ? b.TotalDuration : defaultDuration;
    const normalized = normalizeBookingTimes(
      b.BookingDate ?? dateStr,
      b.StartTime,
      b.EndTime,
      totalDuration,
      b.BookingID,
    );
    const start = new Date(normalized.startDateTimeCairo);
    const end = new Date(normalized.endDateTimeCairo);
    return { start, end, source: "booking" as const, id: b.BookingID };
  });
}

// ── Core slot finder ──────────────────────────────────────────────────────────

/**
 * Given a sorted list of blocking intervals, find the earliest slot >= `from`
 * with `durationMin` minutes of free time that does not overlap any interval.
 *
 * Max search: 12 hours (prevents infinite loops on pathological data).
 */
export function findFirstFreeSlot(
  from: Date,
  durationMin: number,
  intervals: Interval[],
): Date {
  const durMs = durationMin * 60000;
  const maxLimit = new Date(from.getTime() + 12 * 3600 * 1000);
  let candidate = new Date(from);

  let iterations = 0;
  while (candidate < maxLimit && iterations < 500) {
    iterations++;
    const candidateEnd = new Date(candidate.getTime() + durMs);
    let bumped = false;
    for (const iv of intervals) {
      if (intervalsOverlap(candidate, candidateEnd, iv.start, iv.end)) {
        candidate = new Date(iv.end);
        bumped = true;
        break;
      }
    }
    if (!bumped) return candidate; // no overlap found
  }
  return candidate;
}

// ── Main per-barber estimate ──────────────────────────────────────────────────

export async function computeBarberEstimate(
  empId: number,
  empName: string,
  serviceIds: number[],
  requestedAt: string | undefined,
  excludeTicketId?: number,
): Promise<BarberEstimate> {
  const db = await getPool();
  // Always compute business date in Cairo timezone (cutoff 4AM)
  const now = requestedAt ? new Date(requestedAt) : new Date();
  const dateStr = getCairoBusinessDate(now);

  if (DEBUG_BOOKING) {
    console.log("[queue estimate] empId", empId, "empName", empName);
    console.log(
      "[queue estimate] requestedAt",
      now.toISOString(),
      "cairoDate",
      dateStr,
    );
  }

  // Check working hours at requestedAt (not at slot) — this is "is the barber working now?"
  const availResult = await getBarberAvailabilityReason(empId, now);
  const isWorking = availResult.available;

  if (!isWorking) {
    const result: BarberEstimate = {
      empId,
      empName,
      estimatedStartTime: now.toISOString(),
      estimatedWaitMinutes: 0,
      waitingCount: 0,
      isWorking: false,
      unavailableReason: availResult.reason,
      blockingQueueCount: 0,
      blockingBookingCount: 0,
      blockingQueueTickets: [],
      blockingBookings: [],
      blockingTickets: [],
    };
    if (DEBUG_BOOKING)
      console.log("[queue estimate] result (unavailable)", {
        empId,
        reason: availResult.reason,
      });
    return result;
  }

  const defaultDur = await getDefaultDuration(db);
  const customerDur = await getServicesDuration(db, serviceIds, defaultDur);

  const qIntervals = await buildQueueIntervals(
    db,
    empId,
    dateStr,
    now,
    defaultDur,
    excludeTicketId,
    { filterStale: true, graceMinutes: 30, debugContext: "compute-estimate" }
  );
  const bIntervals = await buildBookingIntervals(
    db,
    empId,
    dateStr,
    defaultDur,
  );

  if (DEBUG_BOOKING) {
    console.log(
      "[queue estimate] queue intervals",
      qIntervals.map((iv) => ({
        id: iv.id,
        code: iv.ticketCode,
        start: iv.start.toISOString(),
        end: iv.end.toISOString(),
        label: iv.label,
      })),
    );
    console.log(
      "[queue estimate] booking intervals",
      bIntervals.map((iv) => ({
        id: iv.id,
        start: iv.start.toISOString(),
        end: iv.end.toISOString(),
      })),
    );
  }

  // Merge and sort all blocking intervals
  const allIntervals = [...qIntervals, ...bIntervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  // Find first free slot
  const slot = findFirstFreeSlot(now, customerDur, allIntervals);
  const estimatedWaitMinutes = Math.max(
    0,
    Math.round((slot.getTime() - now.getTime()) / 60000),
  );

  if (DEBUG_BOOKING)
    console.log(
      "[queue estimate] chosen slot",
      slot.toISOString(),
      "waitMinutes",
      estimatedWaitMinutes,
    );

  const result: BarberEstimate = {
    empId,
    empName,
    estimatedStartTime: slot.toISOString(),
    estimatedWaitMinutes,
    waitingCount: qIntervals.length,
    isWorking: true,
    unavailableReason: undefined,
    blockingQueueCount: qIntervals.length,
    blockingBookingCount: bIntervals.length,
    blockingQueueTickets: qIntervals.map((iv) => ({
      id: iv.id,
      estimatedStart: iv.start.toISOString(),
      durationMin: Math.round((iv.end.getTime() - iv.start.getTime()) / 60000),
    })),
    blockingBookings: bIntervals.map((iv) => ({
      id: iv.id,
      start: iv.start.toISOString(),
      end: iv.end.toISOString(),
    })),
    blockingTickets: qIntervals.map((iv) => ({
      ticketCode: iv.ticketCode ?? String(iv.id),
      status: iv.label ?? "unknown",
      estimatedStart: iv.start.toISOString(),
    })),
  };

  if (DEBUG_BOOKING)
    console.log("[queue estimate] result", {
      empId,
      empName,
      blockingQueueCount: result.blockingQueueCount,
      blockingBookingCount: result.blockingBookingCount,
      estimatedStartTime: result.estimatedStartTime,
      waitMinutes: result.estimatedWaitMinutes,
    });

  return result;
}

// ── Booking availability check (shared with bookings module) ─────────────────

/**
 * Check whether a barber is available for a booking at a specific datetime.
 *
 * Uses the same interval engine as queue estimation so both modules share
 * one source of truth.
 *
 * @param empId        - barber employee ID
 * @param empName      - barber name (pass '' to let the function resolve it)
 * @param bookingStart - requested booking start as ISO string or Date
 * @param serviceIds   - selected service IDs (for duration)
 * @param durationOverride - optional fixed duration (skip service lookup)
 */
export async function checkBarberAvailableForBooking(
  empId: number,
  empName: string,
  bookingStart: string | Date,
  serviceIds: number[],
  durationOverride?: number,
): Promise<BookingAvailability> {
  const db = await getPool();
  const start =
    typeof bookingStart === "string" ? new Date(bookingStart) : bookingStart;
  const dateStr = cairoDateStr(start);

  if (DEBUG_BOOKING) {
    console.log("[timeline] empId", empId, "empName", empName);
    console.log("[timeline] requestedAt (bookingStart)", start.toISOString());
  }

  // Resolve empName if not provided
  if (!empName) {
    try {
      const r = await db
        .request()
        .input("eid", sql.Int, empId)
        .query(`SELECT TOP 1 EmpName FROM [dbo].[TblEmp] WHERE EmpID = @eid`);
      empName = r.recordset[0]?.EmpName ?? "";
    } catch {
      /* non-fatal */
    }
  }

  // 1. Check working hours / day off
  const avail = await getBarberAvailabilityReason(empId, start);
  if (!avail.available) {
    const conflictType = avail.reason?.includes("إجازة")
      ? "day_off"
      : "working_hours";
    const result: BookingAvailability = {
      empId,
      empName,
      available: false,
      reason: avail.reason ?? "خارج ساعات العمل",
      conflictType,
      conflictingTickets: [],
      conflictingBookings: [],
      suggestedStartTime: null,
      startTime: start.toISOString(),
      endTime: "",
      durationMinutes: durationOverride ?? 0,
    };
    if (DEBUG_BOOKING) {
      console.log(
        "[checkBarberAvailableForBooking] 409 working_hours/day_off",
        {
          empId,
          startTime: start.toISOString(),
          reason: result.reason,
          conflictType: result.conflictType,
        },
      );
    }
    return result;
  }

  // 2. Resolve service duration
  const defaultDur = await getDefaultDuration(db);
  const customerDur =
    durationOverride ?? (await getServicesDuration(db, serviceIds, defaultDur));
  const end = new Date(start.getTime() + customerDur * 60000);

  // 3. Build all blocking intervals (queue + booking) using the shared builders
  // IMPORTANT: pass realNow (not bookingStart) so sequential cursor starts from NOW,
  // not from the requested booking time. Otherwise tickets are placed after bookingStart
  // and never overlap it.
  const realNow = new Date();
  const qIntervals = await buildQueueIntervals(
    db,
    empId,
    dateStr,
    realNow,
    defaultDur,
    undefined,
    { filterStale: true, graceMinutes: 30, debugContext: "check-availability" }
  );
  const bIntervals = await buildBookingIntervals(
    db,
    empId,
    dateStr,
    defaultDur,
  );

  if (DEBUG_BOOKING) {
    console.log("[timeline check] queue intervals count", qIntervals.length);
  }

  // 4. Find queue ticket conflicts — any interval that overlaps [start, end)
  const qConflicts = qIntervals.filter(
    (iv) => start < iv.end && end > iv.start,
  );
  const bConflicts = bIntervals.filter(
    (iv) => start < iv.end && end > iv.start,
  );

  if (DEBUG_BOOKING) {
    console.log(
      "[timeline] conflicts q:",
      qConflicts.length,
      "b:",
      bConflicts.length,
    );
  }

  if (qConflicts.length > 0 || bConflicts.length > 0) {
    // suggestedStart = end of the last interval in the FULL queue timeline
    // (not just conflicting ones) — so we suggest after ALL active tickets finish
    const allIntervalsSorted = [...qIntervals, ...bIntervals].sort(
      (a, b) => a.end.getTime() - b.end.getTime(),
    );
    const suggestedStart = new Date(
      allIntervalsSorted[allIntervalsSorted.length - 1].end,
    );

    const conflictType = qConflicts.length > 0 ? "queue" : "booking";

    // Show total active queue count (all intervals), not just conflicting ones
    const totalQueueCount = qIntervals.length;
    const queueEndTime =
      qIntervals.length > 0
        ? new Date(Math.max(...qIntervals.map((iv) => iv.end.getTime())))
        : null;
    const queueEndStr = queueEndTime
      ? queueEndTime.toLocaleTimeString("ar-EG", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
          timeZone: "Africa/Cairo",
        })
      : null;

    const reason =
      qConflicts.length > 0
        ? `لديه ${totalQueueCount} ${totalQueueCount === 1 ? "دور متوقع" : "أدوار متوقعة"}${queueEndStr ? ` حتى ${queueEndStr}` : ""}`
        : "يوجد حجز آخر في هذا الموعد";

    const result: BookingAvailability = {
      empId,
      empName,
      available: false,
      reason,
      conflictType,
      conflictingTickets: qConflicts.map((iv) => ({
        ticketCode: iv.ticketCode ?? String(iv.id),
        status: iv.label ?? "unknown",
        start: iv.start.toISOString(),
        end: iv.end.toISOString(),
      })),
      conflictingBookings: bConflicts.map((iv) => ({
        bookingId: iv.id,
        start: iv.start.toISOString(),
        end: iv.end.toISOString(),
      })),
      suggestedStartTime: suggestedStart.toISOString(),
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      durationMinutes: customerDur,
    };

    if (DEBUG_BOOKING) {
      console.log("[checkBarberAvailableForBooking] 409 conflict", {
        empId,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        conflictType,
        queueConflictsCount: qConflicts.length,
        bookingConflictsCount: bConflicts.length,
        reason,
      });
    }
    return result;
  }

  // 5. Available
  const result: BookingAvailability = {
    empId,
    empName,
    available: true,
    reason: null,
    conflictType: null,
    conflictingTickets: [],
    conflictingBookings: [],
    suggestedStartTime: null,
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    durationMinutes: customerDur,
  };

  if (DEBUG_BOOKING) console.log("[timeline check] available", empId);
  return result;
}

export interface DayAvailabilityResult {
  available: boolean;
  reason?: string;
  reasonCode?:
    | "BARBER_NOT_FOUND"
    | "BARBER_NOT_BOOKABLE"
    | "NO_WORKING_SCHEDULE"
    | "DAY_OFF"
    | "OUTSIDE_WORKING_HOURS"
    | "NO_AVAILABLE_SLOTS"
    | "FULLY_BOOKED"
    | "QUEUE_BLOCKED"
    | "BOOKING_BLOCKED";
  firstAvailableSlot?: string;
}

/**
 * Optimized check for available-days endpoint.
 *
 * Instead of calling checkBarberAvailableForBooking for every slot (N+1 problem),
 * this helper:
 * 1. Preloads queue intervals once
 * 2. Preloads booking intervals once
 * 3. Generates slots inside working window
 * 4. Tests overlap in memory
 * 5. Returns immediately on first valid slot (early exit)
 *
 * This is much faster for the "does this day have ANY available slot?" use case.
 */
export async function hasAnyAvailableSlotForBarberOnDay(
  empId: number,
  dateStr: string,
  serviceIds: number[],
  durationMinutes: number,
  slotIntervalMinutes: number,
  minNoticeMinutes: number,
  nowMs: number,
): Promise<DayAvailabilityResult> {
  const db = await getPool();

  // 1. Get working window (uses getBarberWorkingWindow which checks IsWorkingDay)
  const dateObj = new Date(`${dateStr}T12:00:00`);
  const window = await getBarberWorkingWindow(empId, dateObj);

  if (!window.isWorkingDay) {
    return {
      available: false,
      reason: "إجازة أسبوعية",
      reasonCode: "DAY_OFF",
    };
  }

  if (!window.startTime || !window.endTime) {
    return {
      available: false,
      reason: "لا توجد مواعيد عمل لهذا الحلاق في هذا اليوم",
      reasonCode: "NO_WORKING_SCHEDULE",
    };
  }

  // 2. Preload all blocking intervals ONCE
  const [qIntervals, bIntervals] = await Promise.all([
    buildQueueIntervals(db, empId, dateStr, new Date(nowMs), durationMinutes, undefined, {
      filterStale: true, graceMinutes: 30, debugContext: "day-availability"
    }),
    buildBookingIntervals(db, empId, dateStr, durationMinutes),
  ]);

  const allIntervals = [...qIntervals, ...bIntervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );

  // 3. Generate slots and check in memory (early exit on first valid)
  const startMin = timeToMinutes(window.startTime);
  const endMin = timeToMinutes(window.endTime);

  // Handle overnight shifts (e.g., 15:00-02:00)
  // Generate slots from startTime up to midnight, and from midnight to endTime if overnight
  const slots: string[] = [];

  if (startMin <= endMin) {
    // Normal shift (e.g., 09:00-17:00)
    for (let m = startMin; m < endMin; m += slotIntervalMinutes) {
      const hh = Math.floor(m / 60)
        .toString()
        .padStart(2, "0");
      const mm = (m % 60).toString().padStart(2, "0");
      slots.push(`${hh}:${mm}`);
    }
  } else {
    // Overnight shift (e.g., 15:00-02:00)
    // First part: startTime to midnight
    for (let m = startMin; m < 24 * 60; m += slotIntervalMinutes) {
      const hh = Math.floor(m / 60)
        .toString()
        .padStart(2, "0");
      const mm = (m % 60).toString().padStart(2, "0");
      slots.push(`${hh}:${mm}`);
    }
    // Second part: midnight to endTime
    for (let m = 0; m < endMin; m += slotIntervalMinutes) {
      const hh = Math.floor(m / 60)
        .toString()
        .padStart(2, "0");
      const mm = (m % 60).toString().padStart(2, "0");
      slots.push(`${hh}:${mm}`);
    }
  }

  // 4. Check each slot in memory (early exit)
  for (const time of slots) {
    // Use salon timezone-aware epoch — same as available-slots uses
    const slotMs = salonDateTimeToMs(dateStr, time, SALON_TZ);

    // Skip past slots
    if (slotMs - nowMs < minNoticeMinutes * 60_000) {
      continue;
    }

    const slotEnd = new Date(slotMs + durationMinutes * 60000);

    // Check overlap with blocking intervals in memory
    let hasConflict = false;
    const slotDt = new Date(slotMs);
    for (const iv of allIntervals) {
      if (slotDt < iv.end && slotEnd > iv.start) {
        hasConflict = true;
        break; // Conflict found, move to next slot
      }
    }

    if (!hasConflict) {
      // Found valid slot!
      return {
        available: true,
        firstAvailableSlot: time,
      };
    }
  }

  // No available slots found
  const reason =
    qIntervals.length > 0
      ? `لديه ${qIntervals.length} ${qIntervals.length === 1 ? "دور متوقع" : "أدوار متوقعة"}`
      : "لا توجد مواعيد متاحة";

  return {
    available: false,
    reason,
    reasonCode: qIntervals.length > 0 ? "QUEUE_BLOCKED" : "NO_AVAILABLE_SLOTS",
  };
}

// Helper for time conversion (copied from barberAvailability)
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
