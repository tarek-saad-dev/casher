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
import { countQueueCustomersAhead } from "@/lib/queueCustomersAhead";
import { resolveEmployeeDayPlan } from "@/lib/availability/resolveEmployeeDayPlan";
import {
  findEarliestFitInWindows,
  normalizeEffectiveWindows,
} from "@/lib/availability/effectiveWindows";
import { getCairoBusinessDate } from "@/lib/businessDate";
import { intervalsOverlap } from "@/lib/scheduleIntervals";
import { salonDateTimeToMs } from "@/lib/publicBookingHelpers";

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
  /** Outer display bounds only — runtime uses workingWindows. */
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
  /** Phase 3C — all effective working windows. */
  workingWindows: Array<{
    startAt: string;
    endAt: string;
    endDayOffset: 0 | 1;
  }>;
  /** Phase 3C — working / gap / blocked segments. */
  segments?: Array<{
    type: "working" | "gap" | "blocked";
    startAt: string;
    endAt: string;
  }>;
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
  branchId,
}: {
  empId: number;
  date: string; // YYYY-MM-DD
  now: Date;
  serviceIds?: number[];
  /** Optional branch for canonical day-plan resolution. */
  branchId?: number | null;
}): Promise<BarberOperationalTimeline> {
  const db = await getPool();

  // Get barber name
  const empRes = await db
    .request()
    .input("eid", sql.Int, empId)
    .query(`SELECT TOP 1 EmpName FROM [dbo].[TblEmp] WHERE EmpID = @eid`);
  const empName = empRes.recordset[0]?.EmpName ?? "";

  // Canonical effective day plan — all windows (Phase 3C)
  const plan = await resolveEmployeeDayPlan({
    empId,
    businessDate: date,
    branchId: branchId ?? null,
    source: 'operations',
  });
  const windows = normalizeEffectiveWindows(plan.effectiveWindows);
  const workStart = plan.isWorking
    ? (windows[0]?.start ?? plan.effSched?.start ?? null)
    : null;
  const workEnd = plan.isWorking
    ? (windows[windows.length - 1]?.end ?? plan.effSched?.end ?? null)
    : null;
  const isWorkingDay = plan.isWorking;
  const isOvernightShift = Boolean(
    plan.isWorking && (plan.isOvernight || windows.some((w) => w.endDayOffset === 1)),
  );

  const workingWindows = windows.map((w) => ({
    startAt: new Date(w.startMs).toISOString(),
    endAt: new Date(w.endMs).toISOString(),
    endDayOffset: w.endDayOffset,
  }));

  const segments: NonNullable<BarberOperationalTimeline['segments']> = [];
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i]!;
    segments.push({
      type: 'working',
      startAt: new Date(w.startMs).toISOString(),
      endAt: new Date(w.endMs).toISOString(),
    });
    const next = windows[i + 1];
    if (next && next.startMs > w.endMs) {
      segments.push({
        type: 'gap',
        startAt: new Date(w.endMs).toISOString(),
        endAt: new Date(next.startMs).toISOString(),
      });
    }
  }
  for (const b of plan.effSched?.blockedIntervals ?? []) {
    segments.push({
      type: 'blocked',
      startAt: new Date(b.startMs).toISOString(),
      endAt: new Date(b.endMs).toISOString(),
    });
  }
  segments.sort((a, b) => a.startAt.localeCompare(b.startAt));

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
    if (isWorkingDay && workStart && workEnd) {
      const startMin = timeToMinutes(workStart);
      const nowMin = now.getHours() * 60 + now.getMinutes();

      if (startMin > nowMin) {
        const gapStart = new Date(now);
        gapStart.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
        const gapEnd = new Date(gapStart);
        if (isOvernightShift) {
          gapEnd.setDate(gapEnd.getDate() + 1);
          gapEnd.setHours(Math.floor(timeToMinutes(workEnd) / 60), timeToMinutes(workEnd) % 60, 0, 0);
        } else {
          gapEnd.setHours(Math.floor(timeToMinutes(workEnd) / 60), timeToMinutes(workEnd) % 60, 0, 0);
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

  // Calculate next available slot across all windows
  const occupied = [
    ...allIntervals.map((iv) => ({
      startMs: iv.start.getTime(),
      endMs: iv.end.getTime(),
    })),
    ...(plan.effSched?.blockedIntervals ?? []).map((b) => ({
      startMs: b.startMs,
      endMs: b.endMs,
    })),
  ];
  const fitMs = windows.length
    ? findEarliestFitInWindows({
        windows,
        fromMs: now.getTime(),
        durationMinutes: serviceDur,
        occupied,
      })
    : null;
  const nextAvailable =
    fitMs != null ? new Date(fitMs) : findFirstFreeSlot(now, serviceDur, allIntervals);

  if (DEBUG_OPS) {
    console.log("[buildBarberOperationalTimeline]", {
      empId,
      empName,
      date,
      workStart,
      workEnd,
      workingWindows: workingWindows.length,
      isWorkingDay,
      isOvernightShift,
      denyReasonCode: plan.denyReasonCode,
      queueCount: qIntervals.length,
      bookingCount: bIntervals.length,
      gapCount: gaps.length,
    });
  }

  return {
    empId,
    empName,
    date,
    workStart,
    workEnd,
    isWorkingDay,
    isOvernightShift,
    now: now.toISOString(),
    nextAvailableAt: nextAvailable.toISOString(),
    queueCount: qIntervals.length,
    bookingCount: bIntervals.length,
    timeline,
    gaps,
    workingWindows,
    segments,
  };
}

// ── Simulate Queue Insertion ────────────────────────────────────────────────

export async function simulateQueueInsertion({
  empId,
  serviceIds,
  requestedAt,
  branchId,
}: {
  empId: number;
  serviceIds: number[];
  requestedAt?: string; // ISO string
  branchId?: number | null;
}): Promise<SimulateQueueResult> {
  const db = await getPool();
  const now = requestedAt ? new Date(requestedAt) : new Date();
  const dateStr = getCairoBusinessDate(now);

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
    branchId,
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

  // Find first free slot across all effective windows (Phase 3C) —
  // reuse timeline.workingWindows (already resolved once).
  const simWindows = (timeline.workingWindows ?? []).map((w) => ({
    start: '',
    end: '',
    endDayOffset: w.endDayOffset,
    startMs: new Date(w.startAt).getTime(),
    endMs: new Date(w.endAt).getTime(),
  }));
  const simOccupied = [
    ...allIntervals.map((iv) => ({
      startMs: iv.start.getTime(),
      endMs: iv.end.getTime(),
    })),
    ...(timeline.segments ?? [])
      .filter((s) => s.type === 'blocked')
      .map((s) => ({
        startMs: new Date(s.startAt).getTime(),
        endMs: new Date(s.endAt).getTime(),
      })),
  ];
  const fitMs = simWindows.length
    ? findEarliestFitInWindows({
        windows: simWindows,
        fromMs: now.getTime(),
        durationMinutes: serviceDur,
        occupied: simOccupied,
      })
    : null;
  const suggestedStart =
    fitMs != null
      ? new Date(fitMs)
      : findFirstFreeSlot(now, serviceDur, allIntervals);
  const suggestedEnd = new Date(suggestedStart.getTime() + serviceDur * 60000);

  // Reject slots that do not fit any single effective window.
  if (simWindows.length) {
    const { findWindowContainingInterval } = await import(
      '@/lib/availability/effectiveWindows'
    );
    if (
      !findWindowContainingInterval({
        windows: simWindows,
        startMs: suggestedStart.getTime(),
        endMs: suggestedEnd.getTime(),
      })
    ) {
      return {
        ok: false,
        decision: 'outside_hours',
        empId,
        empName,
        serviceDurationMinutes: serviceDur,
        suggestedStartTime: '',
        suggestedEndTime: '',
        peopleBefore: 0,
        message: 'لا يوجد وقت كافٍ قبل نهاية وردية الحلاق',
        timeline: timeline.timeline,
        protectedBookings: [],
        queueBefore: [],
      };
    }
  } else if (timeline.workStart && timeline.workEnd) {
    const startMin = timeToMinutes(timeline.workStart);
    const endMin = timeToMinutes(timeline.workEnd);
    const overnight = endMin <= startMin;
    const nextDay = (() => {
      const d = new Date(`${dateStr}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().slice(0, 10);
    })();
    const shiftEndMs = overnight
      ? salonDateTimeToMs(nextDay, timeline.workEnd, 'Africa/Cairo')
      : salonDateTimeToMs(dateStr, timeline.workEnd, 'Africa/Cairo');
    if (suggestedEnd.getTime() > shiftEndMs) {
      return {
        ok: false,
        decision: 'outside_hours',
        empId,
        empName,
        serviceDurationMinutes: serviceDur,
        suggestedStartTime: '',
        suggestedEndTime: '',
        peopleBefore: 0,
        message: 'لا يوجد وقت كافٍ قبل نهاية وردية الحلاق',
        timeline: timeline.timeline,
        protectedBookings: [],
        queueBefore: [],
      };
    }
  }

  // CRITICAL: Log conflict detection results for the proposed slot
  console.log("[simulate debug] === CONFLICT DETECTION ===");
  console.log("[simulate debug] Proposed interval:", {
    proposedStart: suggestedStart.toISOString(),
    proposedEnd: suggestedEnd.toISOString(),
    duration: serviceDur,
  });

  // Check for any overlaps with the proposed slot (using correct overlap condition)
  const proposedBookingConflicts = bIntervals.filter((b) =>
    intervalsOverlap(suggestedStart, suggestedEnd, b.start, b.end),
  );
  const proposedQueueConflicts = qIntervals.filter((q) =>
    intervalsOverlap(suggestedStart, suggestedEnd, q.start, q.end),
  );

  if (proposedBookingConflicts.length > 0 || proposedQueueConflicts.length > 0) {
    console.error("[simulateQueueInsertion] SLOT CONFLICT after findFirstFreeSlot", {
      empId,
      suggestedStart: suggestedStart.toISOString(),
      suggestedEnd: suggestedEnd.toISOString(),
      bookingConflicts: proposedBookingConflicts.length,
      queueConflicts: proposedQueueConflicts.length,
    });
    return {
      ok: false,
      decision: "no_gap_found",
      empId,
      empName,
      serviceDurationMinutes: serviceDur,
      suggestedStartTime: "",
      suggestedEndTime: "",
      peopleBefore: 0,
      message: "لا يوجد فترة متاحة بدون تعارض مع حجز أو دور موجود",
      timeline: timeline.timeline,
      protectedBookings: [],
      queueBefore: [],
    };
  }

  console.log("[simulate debug] Conflict check with proposed slot:", {
    bookingConflicts: proposedBookingConflicts.map(b => ({
      id: b.id,
      start: b.start.toISOString(),
      end: b.end.toISOString(),
      overlapMinutes: Math.max(0,
        Math.min(suggestedEnd.getTime(), b.end.getTime()) -
        Math.max(suggestedStart.getTime(), b.start.getTime())
      ) / 60000,
    })),
    queueConflicts: proposedQueueConflicts.map(q => ({
      id: q.id,
      code: q.ticketCode,
      start: q.start.toISOString(),
      end: q.end.toISOString(),
      overlapMinutes: Math.max(0,
        Math.min(suggestedEnd.getTime(), q.end.getTime()) -
        Math.max(suggestedStart.getTime(), q.start.getTime())
      ) / 60000,
    })),
    hasConflict: proposedBookingConflicts.length > 0 || proposedQueueConflicts.length > 0,
    overlapCondition: "newStart < existingEnd && newEnd > existingStart",
  });

  console.log("[simulate debug] Slot calculation:", {
    now: now.toISOString(),
    nowCairo: now.toLocaleString("en-GB", { timeZone: "Africa/Cairo" }),
    suggestedStart: suggestedStart.toISOString(),
    suggestedStartCairo: suggestedStart.toLocaleString("en-GB", { timeZone: "Africa/Cairo" }),
    suggestedEnd: suggestedEnd.toISOString(),
    serviceDuration: serviceDur,
    finalSlotSelected: suggestedStart.toISOString(),
  });

  // Count queue customers ahead (exclude bookings — not queue-line position)
  const queueBeforeItems = qIntervals.filter((q) => q.end <= suggestedStart);
  const queueCountBefore = queueBeforeItems.length;
  const peopleBefore = countQueueCustomersAhead(qIntervals, suggestedStart);

  // Bookings ending before slot — used for decision messaging only
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
    if (bookingCountBefore > 0 && queueCountBefore > 0) {
      message = `يوجد ${queueCountBefore} ${queueCountBefore === 1 ? 'دور' : 'أدوار'} و${bookingCountBefore} ${bookingCountBefore === 1 ? 'حجز' : 'حجوزات'} قبلك، ستبدأ بعدهم`;
    } else if (bookingCountBefore > 0) {
      message = `يوجد ${bookingCountBefore} ${bookingCountBefore === 1 ? 'حجز' : 'حجوزات'} قبل موعدك`;
    } else {
      message = `يوجد ${peopleBefore} ${peopleBefore === 1 ? 'دور' : 'أدوار'} قبلك، ستبدأ بعدهم`;
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
