/**
 * operationsQueueTimeline.ts — Phase 0 Operations Queue Flow
 *
 * Shared timeline builder for operations dashboard.
 * Builds comprehensive barber operational timeline including:
 * - Queue tickets (waiting, called, in_service)
 * - Protected bookings (confirmed, arrived, queued, in_service)
 * - Gaps (free slots)
 * - Next available slot
 *
 * All bookings are treated as protected blocks regardless of client arrival status.
 */

import { getPool, sql } from "@/lib/db";
import {
  buildQueueIntervals,
  buildBookingIntervals,
  getDefaultDuration,
  getServicesDuration,
  findFirstFreeSlot,
  cairoDateStr,
  Interval,
} from "@/lib/queueEstimateEngine";
import { getBarberWorkingWindow } from "@/lib/barberAvailability";

const SALON_TZ = "Africa/Cairo";
const DEBUG_OPS = process.env.DEBUG_OPERATIONS === "true";

// ── Types ────────────────────────────────────────────────────────────────────

export interface TimelineItem {
  type: "queue" | "booking" | "gap";
  sourceId: number;
  label: string;
  startTime: string; // ISO
  endTime: string; // ISO
  status: string;
  protected: boolean;
  peopleBefore?: number; // for queue tickets
  durationMinutes?: number;
  customerName?: string;
  serviceNames?: string[];
}

export interface BarberOperationalTimeline {
  empId: number;
  empName: string;
  date: string; // YYYY-MM-DD
  workStart: string | null; // HH:MM
  workEnd: string | null; // HH:MM
  isWorkingDay: boolean;
  isOvernightShift: boolean;
  now: string; // ISO
  nextAvailableAt: string | null; // ISO
  queueCount: number;
  bookingCount: number;
  timeline: TimelineItem[];
  gaps: Array<{ start: string; end: string; durationMinutes: number }>;
}

export interface SimulateQueueResult {
  ok: boolean;
  decision:
    | "start_now"
    | "after_queue"
    | "after_booking"
    | "outside_hours"
    | "no_gap_found";
  empId: number;
  empName: string;
  serviceDurationMinutes: number;
  suggestedStartTime: string;
  suggestedEndTime: string;
  peopleBefore: number;
  message: string;
  timeline: TimelineItem[];
  protectedBookings: Array<{
    bookingId: number;
    startTime: string;
    endTime: string;
    clientName: string | null;
  }>;
  queueBefore: Array<{
    ticketId: number;
    ticketCode: string;
    startTime: string;
    endTime: string;
    status: string;
  }>;
}

// ── Main Timeline Builder ─────────────────────────────────────────────────────

export async function buildBarberOperationalTimeline({
  empId,
  date,
  now,
  serviceIds,
}: {
  empId: number;
  date: string; // YYYY-MM-DD
  now: Date;
  serviceIds?: number[];
}): Promise<BarberOperationalTimeline> {
  const db = await getPool();

  // Get barber name
  const empRes = await db
    .request()
    .input("eid", sql.Int, empId)
    .query(`SELECT TOP 1 EmpName FROM [dbo].[TblEmp] WHERE EmpID = @eid`);
  const empName = empRes.recordset[0]?.EmpName ?? "";

  // Get working window
  const dateObj = new Date(`${date}T12:00:00`);
  const window = await getBarberWorkingWindow(empId, dateObj);

  const isOvernightShift = Boolean(
    window.startTime &&
    window.endTime &&
    timeToMinutes(window.endTime) <= timeToMinutes(window.startTime)
  );

  // Get default duration for calculations
  const defaultDur = await getDefaultDuration(db);
  const serviceDur =
    serviceIds && serviceIds.length > 0
      ? await getServicesDuration(db, serviceIds, defaultDur)
      : defaultDur;

  // Build intervals (filter stale queue tickets for operations)
  const qIntervals = await buildQueueIntervals(db, empId, date, now, defaultDur, undefined, {
    filterStale: true,
    graceMinutes: 30,
    debugContext: "operations-timeline",
  });
  const bIntervals = await buildBookingIntervals(db, empId, date, defaultDur);

  // Merge and sort all intervals
  const allIntervals = [...qIntervals, ...bIntervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );

  // Build timeline items
  const timeline: TimelineItem[] = [];
  const gaps: Array<{ start: string; end: string; durationMinutes: number }> = [];

  // Add queue tickets
  for (const iv of qIntervals) {
    timeline.push({
      type: "queue",
      sourceId: iv.id,
      label: iv.ticketCode ?? `Q-${iv.id}`,
      startTime: iv.start.toISOString(),
      endTime: iv.end.toISOString(),
      status: iv.label ?? "unknown",
      protected: true,
      durationMinutes: Math.round((iv.end.getTime() - iv.start.getTime()) / 60000),
    });
  }

  // Load booking details for richer timeline
  const bookingDetails = await loadBookingDetails(db, bIntervals);

  // Add bookings
  for (const iv of bIntervals) {
    const details = bookingDetails.get(iv.id);
    timeline.push({
      type: "booking",
      sourceId: iv.id,
      label: details?.clientName ?? `B-${iv.id}`,
      startTime: iv.start.toISOString(),
      endTime: iv.end.toISOString(),
      status: "confirmed",
      protected: true,
      customerName: details?.clientName || undefined,
      durationMinutes: Math.round((iv.end.getTime() - iv.start.getTime()) / 60000),
    });
  }

  // Sort timeline by start time
  timeline.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  // Find gaps between items
  if (allIntervals.length > 0) {
    // Gap from now to first item
    const firstItem = allIntervals[0];
    if (firstItem.start > now) {
      const gapMinutes = Math.round(
        (firstItem.start.getTime() - now.getTime()) / 60000
      );
      if (gapMinutes >= 15) {
        gaps.push({
          start: now.toISOString(),
          end: firstItem.start.toISOString(),
          durationMinutes: gapMinutes,
        });
        timeline.unshift({
          type: "gap",
          sourceId: 0,
          label: `فترة متاحة (${gapMinutes} دقيقة)`,
          startTime: now.toISOString(),
          endTime: firstItem.start.toISOString(),
          status: "available",
          protected: false,
          durationMinutes: gapMinutes,
        });
      }
    }

    // Gaps between items
    for (let i = 0; i < allIntervals.length - 1; i++) {
      const current = allIntervals[i];
      const next = allIntervals[i + 1];

      if (next.start > current.end) {
        const gapMinutes = Math.round(
          (next.start.getTime() - current.end.getTime()) / 60000
        );
        if (gapMinutes >= 15) {
          const gapStart = current.end.toISOString();
          const gapEnd = next.start.toISOString();
          gaps.push({
            start: gapStart,
            end: gapEnd,
            durationMinutes: gapMinutes,
          });
          // Insert gap into timeline at correct position
          const insertIndex = timeline.findIndex(
            (t) => t.startTime === current.start.toISOString()
          );
          if (insertIndex >= 0) {
            timeline.splice(insertIndex + 1, 0, {
              type: "gap",
              sourceId: 0,
              label: `فترة متاحة (${gapMinutes} دقيقة)`,
              startTime: gapStart,
              endTime: gapEnd,
              status: "available",
              protected: false,
              durationMinutes: gapMinutes,
            });
          }
        }
      }
    }
  } else {
    // No items - whole day is a gap (within working hours)
    if (window.isWorkingDay && window.startTime && window.endTime) {
      const startMin = timeToMinutes(window.startTime);
      const nowMin = now.getHours() * 60 + now.getMinutes();

      if (startMin > nowMin) {
        const gapStart = new Date(now);
        gapStart.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
        const gapEnd = new Date(gapStart);
        if (isOvernightShift) {
          gapEnd.setDate(gapEnd.getDate() + 1);
          gapEnd.setHours(Math.floor(timeToMinutes(window.endTime) / 60), timeToMinutes(window.endTime) % 60, 0, 0);
        } else {
          gapEnd.setHours(Math.floor(timeToMinutes(window.endTime) / 60), timeToMinutes(window.endTime) % 60, 0, 0);
        }
        const gapMinutes = Math.round(
          (gapEnd.getTime() - gapStart.getTime()) / 60000
        );
        if (gapMinutes > 0) {
          gaps.push({
            start: gapStart.toISOString(),
            end: gapEnd.toISOString(),
            durationMinutes: gapMinutes,
          });
        }
      }
    }
  }

  // Calculate next available slot
  const nextAvailable = findFirstFreeSlot(now, serviceDur, allIntervals);

  if (DEBUG_OPS) {
    console.log("[buildBarberOperationalTimeline]", {
      empId,
      empName,
      date,
      queueCount: qIntervals.length,
      bookingCount: bIntervals.length,
      timelineLength: timeline.length,
      gapsCount: gaps.length,
      nextAvailable: nextAvailable.toISOString(),
    });
  }

  return {
    empId,
    empName,
    date,
    workStart: window.startTime,
    workEnd: window.endTime,
    isWorkingDay: window.isWorkingDay,
    isOvernightShift,
    now: now.toISOString(),
    nextAvailableAt: nextAvailable.toISOString(),
    queueCount: qIntervals.length,
    bookingCount: bIntervals.length,
    timeline,
    gaps,
  };
}

// ── Simulate Queue Insertion ────────────────────────────────────────────────

export async function simulateQueueInsertion({
  empId,
  serviceIds,
  requestedAt,
}: {
  empId: number;
  serviceIds: number[];
  requestedAt?: string; // ISO string
}): Promise<SimulateQueueResult> {
  const db = await getPool();
  const now = requestedAt ? new Date(requestedAt) : new Date();
  const dateStr = cairoDateStr(now);

  // Get barber info
  const empRes = await db
    .request()
    .input("eid", sql.Int, empId)
    .query(`SELECT TOP 1 EmpName FROM [dbo].[TblEmp] WHERE EmpID = @eid`);
  const empName = empRes.recordset[0]?.EmpName ?? "";

  // Get service duration
  const defaultDur = await getDefaultDuration(db);
  const serviceDur = await getServicesDuration(db, serviceIds, defaultDur);

  // Build timeline
  const timeline = await buildBarberOperationalTimeline({
    empId,
    date: dateStr,
    now,
    serviceIds,
  });

  // Check working hours
  if (!timeline.isWorkingDay) {
    return {
      ok: false,
      decision: "outside_hours",
      empId,
      empName,
      serviceDurationMinutes: serviceDur,
      suggestedStartTime: "",
      suggestedEndTime: "",
      peopleBefore: 0,
      message: "الحلاق في إجازة اليوم",
      timeline: timeline.timeline,
      protectedBookings: [],
      queueBefore: [],
    };
  }

  // Build intervals for slot finding
  const qIntervals = await buildQueueIntervals(db, empId, dateStr, now, defaultDur);
  const bIntervals = await buildBookingIntervals(db, empId, dateStr, defaultDur);

  // Debug: Always log detailed blockers info (not just in DEBUG_OPS mode)
  console.log("[simulate debug] Request details:", {
    empId,
    empName,
    date: dateStr,
    requestedAt: requestedAt ?? "undefined",
    effectiveNowUsed: now.toISOString(),
    effectiveNowCairo: now.toLocaleString("en-GB", { timeZone: "Africa/Cairo" }),
    serviceDuration: serviceDur,
    activeQueueCount: qIntervals.length,
    activeBookingCount: bIntervals.length,
  });

  console.log("[simulate debug] Queue blockers:", qIntervals.map((q) => ({
    id: q.id,
    ticketCode: q.ticketCode,
    start: q.start.toISOString(),
    end: q.end.toISOString(),
    status: q.label,
    durationMinutes: Math.round((q.end.getTime() - q.start.getTime()) / 60000),
  })));

  console.log("[simulate debug] Booking blockers:", bIntervals.map((b) => ({
    id: b.id,
    start: b.start.toISOString(),
    end: b.end.toISOString(),
    status: b.label,
    durationMinutes: Math.round((b.end.getTime() - b.start.getTime()) / 60000),
  })));

  const allIntervals = [...qIntervals, ...bIntervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );

  console.log("[simulate debug] Combined timeline (sorted):", allIntervals.map((iv) => ({
    type: iv.source,
    id: iv.id,
    start: iv.start.toISOString(),
    end: iv.end.toISOString(),
  })));

  // Find first free slot
  const suggestedStart = findFirstFreeSlot(now, serviceDur, allIntervals);
  const suggestedEnd = new Date(suggestedStart.getTime() + serviceDur * 60000);

  console.log("[simulate debug] Slot calculation:", {
    now: now.toISOString(),
    nowCairo: now.toLocaleString("en-GB", { timeZone: "Africa/Cairo" }),
    suggestedStart: suggestedStart.toISOString(),
    suggestedStartCairo: suggestedStart.toLocaleString("en-GB", { timeZone: "Africa/Cairo" }),
    suggestedEnd: suggestedEnd.toISOString(),
    serviceDuration: serviceDur,
  });

  // Count people before (queue tickets that end before or at our start)
  const queueBeforeItems = qIntervals.filter((q) => q.end <= suggestedStart);
  const queueCountBefore = queueBeforeItems.length;

  // Find bookings that end before or at our start (for peopleBefore count)
  const bookingBeforeItems = bIntervals.filter((b) => b.end <= suggestedStart);
  const bookingCountBefore = bookingBeforeItems.length;

  // Find next upcoming booking (for decision logic)
  const upcomingBookings = bIntervals
    .filter((b) => b.start > now)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const nextBooking = upcomingBookings[0];

  // Determine decision
  let decision: SimulateQueueResult["decision"];
  let message: string;

  // Check if we're placed immediately after a booking (within 5 min tolerance)
  const isAfterBooking = nextBooking &&
    suggestedStart.getTime() >= nextBooking.end.getTime() - 5 * 60000;

  // Total people before = queue items + bookings that end before or at our start
  // Note: bookingBeforeItems already includes the booking we're after (if any)
  // because its end time <= suggestedStart
  const peopleBefore = queueCountBefore + bookingCountBefore;

  if (isAfterBooking) {
    decision = "after_booking";
    const bookingTime = nextBooking.start.toLocaleTimeString("ar-EG", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    message = `يوجد حجز محمي الساعة ${bookingTime}، دورك سيكون بعده`;
  } else if (peopleBefore === 0) {
    // Check if start is "now" (within 5 minutes)
    const isStartNow = suggestedStart.getTime() - now.getTime() <= 5 * 60000;
    if (isStartNow) {
      decision = "start_now";
      message = "يمكن بدء الخدمة فوراً";
    } else {
      decision = "after_queue";
      message = "يوجد تأخير، سيبدأ الدور قريباً";
    }
  } else {
    decision = "after_queue";
    if (bookingCountBefore > 0) {
      message = `يوجد ${peopleBefore} أدوار وحجوزات قبلك، ستبدأ بعدهم`;
    } else {
      message = `يوجد ${peopleBefore} أدوار قبلك، ستبدأ بعدهم`;
    }
  }

  // Build queue before list for response
  const queueBeforeList = queueBeforeItems.map((iv) => ({
    ticketId: iv.id,
    ticketCode: iv.ticketCode ?? `Q-${iv.id}`,
    startTime: iv.start.toISOString(),
    endTime: iv.end.toISOString(),
    status: iv.label ?? "unknown",
  }));

  // Build protected bookings list
  const protectedBookings = upcomingBookings.slice(0, 3).map((b) => ({
    bookingId: b.id,
    startTime: b.start.toISOString(),
    endTime: b.end.toISOString(),
    clientName: null, // Could be enriched with actual client name
  }));

  if (DEBUG_OPS) {
    console.log("[simulateQueueInsertion]", {
      empId,
      decision,
      suggestedStart: suggestedStart.toISOString(),
      suggestedEnd: suggestedEnd.toISOString(),
      peopleBefore,
      serviceDur,
    });
  }

  return {
    ok: true,
    decision,
    empId,
    empName,
    serviceDurationMinutes: serviceDur,
    suggestedStartTime: suggestedStart.toISOString(),
    suggestedEndTime: suggestedEnd.toISOString(),
    peopleBefore,
    message,
    timeline: timeline.timeline,
    protectedBookings,
    queueBefore: queueBeforeList,
  };
}

// ── Helper: Load Booking Details ─────────────────────────────────────────────

async function loadBookingDetails(
  db: Awaited<ReturnType<typeof getPool>>,
  intervals: Interval[]
): Promise<Map<number, { clientName: string | null; phone: string | null }>> {
  const details = new Map<number, { clientName: string | null; phone: string | null }>();

  if (intervals.length === 0) return details;

  try {
    const ids = intervals.map((i) => i.id).join(",");
    const res = await db.request().query(`
      SELECT 
        b.BookingID,
        c.Name AS ClientName,
        c.Phone
      FROM [dbo].[Bookings] b
      LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
      WHERE b.BookingID IN (${ids})
    `);

    for (const row of res.recordset) {
      details.set(row.BookingID, {
        clientName: row.ClientName,
        phone: row.Phone,
      });
    }
  } catch (err) {
    console.error("[loadBookingDetails] error:", err);
  }

  return details;
}

// ── Helper: Time Conversion ────────────────────────────────────────────────

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
