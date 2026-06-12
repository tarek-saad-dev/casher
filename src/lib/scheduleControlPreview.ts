/**
 * scheduleControlPreview.ts
 *
 * Shared logic for computing "which bookings/queue tickets would be affected
 * if a schedule override is applied?" — used by both the preview and apply
 * endpoints so both enforce identical rules.
 *
 * Overnight shift handling:
 *   When a shift's EndTime lexicographically < StartTime (e.g., 14:00 -> 02:00)
 *   the EndTime belongs to the NEXT calendar day.  We resolve this by computing
 *   each epoch via salonDateTimeToMs and, for times that are "before" the start
 *   in clock terms, adding 24 h to land on the next day.
 *
 * Half-open interval contract [start, end):
 *   All overlap tests use: itemStart < ivEnd && itemEnd > ivStart
 *   - booking/queue exactly at the end boundary of a block is NOT affected.
 *   - booking/queue ending exactly at the start boundary is NOT affected.
 *
 * Verified test cases (default shift 14:00 -> 02:00):
 *
 *   A. late_start 16:00
 *      blocked = [14:00, 16:00)  →  14:30 booking affected, 16:00 booking not affected
 *
 *   B. early_leave 23:00
 *      blocked = [23:00, 02:00)  →  23:30 booking affected, 02:00 queue not affected
 *
 *   C. block_range 19:00 -> 20:00
 *      blocked = [19:00, 20:00)  →  19:30 booking affected, 20:00 booking NOT affected
 *                                    18:45-19:15 queue affected, 18:30-19:00 queue NOT affected
 *
 *   D. custom_hours 16:00 -> 23:00
 *      blocked = [14:00, 16:00) + [23:00, 02:00)  →  14:30 and 01:00 bookings affected
 *      Existing block_range 19:00-20:00 is NOT double-counted as affected by this override
 *
 *   E. day_off (shift 14:00 -> 02:00)
 *      blocked = [14:00, 02:00 next day)  →  all bookings in shift window affected
 */

import { getPool, sql } from "@/lib/db";
import { getDefaultSchedule, getScheduleOverrides, SALON_TZ } from "@/lib/availabilityEngine";
import { applyOverrides } from "@/lib/scheduleOverrides";
import { salonDateTimeToMs } from "@/lib/publicBookingHelpers";
import type { OverrideType } from "@/lib/scheduleOverrides";

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UnavailableInterval {
  startMs: number;
  endMs:   number;
  reason:  string;
}

export interface AffectedBooking {
  bookingId:      number;
  bookingCode:    string | null;
  startTime:      string;
  endTime:        string | null;
  status:         string;
  clientName:     string | null;
  serviceName:    string | null;
  conflictReason: string;
}

export interface AffectedQueueTicket {
  ticketId:            number;
  ticketCode:          string;
  status:              string;
  estimatedStartTime:  string;
  durationMinutes:     number;
  clientName:          string | null;
  conflictReason:      string;
}

export interface PreviewResult {
  safe:                      boolean;
  unavailableIntervals:      UnavailableInterval[];
  affectedBookings:          AffectedBooking[];
  affectedQueueTickets:      AffectedQueueTicket[];
  warnings:                  string[];
  effectiveSchedulePreview: {
    isWorking:        boolean;
    start:            string;
    end:              string;
    blockedIntervals: any[];
  };
  // Logging context
  oldEffectiveStart:  string | null;
  oldEffectiveEnd:    string | null;
  newEffectiveStart:  string | null;
  newEffectiveEnd:    string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Build a Cairo-epoch ms for a wall-clock HH:MM on a given date.
 * If the time is "overnight" relative to shiftStart (i.e., it wraps midnight),
 * we add 24 h to place it on the next calendar day.
 */
function epochForTime(
  date: string,
  hhmm: string,
  shiftStartMin: number,
): number {
  const tMin = hhmmToMin(hhmm);
  const base  = salonDateTimeToMs(date, hhmm, SALON_TZ);
  // If tMin < shiftStartMin the clock time crosses midnight → next day
  if (tMin < shiftStartMin) return base + DAY_MS;
  return base;
}

// ── Core export ───────────────────────────────────────────────────────────────

export async function computePreview(
  empId:      number,
  date:       string,
  type:       OverrideType,
  startTime?: string,
  endTime?:   string,
): Promise<PreviewResult> {

  const db = await getPool();

  // 1. Load the CURRENT effective schedule (before mock override)
  const schedule  = await getDefaultSchedule(empId, date);
  const existingOverrides = await getScheduleOverrides(empId, date);

  const base = {
    isWorking: schedule.isWorkingDay && !!schedule.start && !!schedule.end,
    start: schedule.start ?? "00:00",
    end:   schedule.end   ?? "00:00",
  };

  const currentEffective = applyOverrides(empId, date, base, existingOverrides);

  const oldStart = currentEffective.isWorking ? currentEffective.start : null;
  const oldEnd   = currentEffective.isWorking ? currentEffective.end   : null;

  // 2. Build the PROPOSED effective schedule (with mock override on top)
  const mockOverride = {
    OverrideID:   -1,
    EmpID:         empId,
    OverrideDate:  date,
    Type:          type,
    StartTime:     startTime ?? null,
    EndTime:       endTime   ?? null,
    Reason:        null,
    IsActive:      true,
  } as any;

  // For non-additive types, strip existing same-type override from the list
  const overridesForMock = type === "block_range"
    ? [...existingOverrides, mockOverride]
    : [...existingOverrides.filter(o => o.Type !== type), mockOverride];

  const newEffective = applyOverrides(empId, date, base, overridesForMock);
  const newStart = newEffective.isWorking ? newEffective.start : null;
  const newEnd   = newEffective.isWorking ? newEffective.end   : null;

  // 3. Derive unavailable intervals introduced by this specific override
  const unavailableIntervals: UnavailableInterval[] = [];
  const warnings: string[] = [];

  // The shift start minute (used to detect overnight times)
  const shiftStartMin = oldStart ? hhmmToMin(oldStart) : 0;

  if (type === "day_off") {
    // Block the entire current effective working range.
    // NOTE: day_off makes the barber fully unavailable regardless of
    // any existing block_range records (applyOverrides returns early on day_off).
    if (oldStart && oldEnd) {
      const s = salonDateTimeToMs(date, oldStart, SALON_TZ);
      const e = epochForTime(date, oldEnd, shiftStartMin);
      unavailableIntervals.push({
        startMs: s,
        endMs:   e,
        reason: "غياب اليوم",
      });
    } else {
      // No current schedule — block calendar day as a safety net
      unavailableIntervals.push({
        startMs: salonDateTimeToMs(date, "00:00", SALON_TZ),
        endMs:   salonDateTimeToMs(date, "23:59", SALON_TZ),
        reason:  "غياب اليوم",
      });
    }
    warnings.push("هذا التعديل سيجعل الصنايعي غير متاح طوال اليوم");

  } else if (type === "late_start" && startTime) {
    // Blocked = [oldEffectiveStart, newStartTime)
    if (oldStart) {
      const oldStartMs = salonDateTimeToMs(date, oldStart, SALON_TZ);
      const newStartMs = epochForTime(date, startTime, shiftStartMin);
      if (newStartMs > oldStartMs) {
        unavailableIntervals.push({
          startMs: oldStartMs,
          endMs:   newStartMs,
          reason:  `تأخير البداية: ${oldStart} ← ${startTime}`,
        });
      }
    }

  } else if (type === "early_leave" && endTime) {
    // Blocked = [newEndTime, oldEffectiveEnd)
    if (oldEnd) {
      const newEndMs = epochForTime(date, endTime, shiftStartMin);
      const oldEndMs = epochForTime(date, oldEnd,  shiftStartMin);
      if (newEndMs < oldEndMs) {
        unavailableIntervals.push({
          startMs: newEndMs,
          endMs:   oldEndMs,
          reason:  `مغادرة مبكرة: ${endTime} ← ${oldEnd}`,
        });
      }
    }

  } else if (type === "block_range" && startTime && endTime) {
    const blockStartMs = epochForTime(date, startTime, shiftStartMin);
    const blockEndMs   = epochForTime(date, endTime,   shiftStartMin);
    unavailableIntervals.push({
      startMs: blockStartMs,
      endMs:   blockEndMs,
      reason:  `محجوب ${startTime} - ${endTime}`,
    });

  } else if (type === "custom_hours" && startTime && endTime) {
    // Blocked = parts of current working window OUTSIDE [newStart, newEnd)
    // Handle overnight: compute epochs anchored to shiftStartMin
    if (oldStart && oldEnd) {
      const oldStartMs  = salonDateTimeToMs(date, oldStart, SALON_TZ);
      const oldEndMs    = epochForTime(date, oldEnd,   shiftStartMin);
      const newStartMs  = epochForTime(date, startTime, shiftStartMin);
      const newEndMs    = epochForTime(date, endTime,   shiftStartMin);

      // Before new start
      if (newStartMs > oldStartMs) {
        unavailableIntervals.push({
          startMs: oldStartMs,
          endMs:   newStartMs,
          reason:  `محجوب قبل ${startTime}`,
        });
      }
      // After new end
      if (newEndMs < oldEndMs) {
        unavailableIntervals.push({
          startMs: newEndMs,
          endMs:   oldEndMs,
          reason:  `محجوب بعد ${endTime}`,
        });
      }
    }
  }

  // Collect already-blocked intervals from the CURRENT effective schedule
  // (i.e., existing block_range overrides already in force). When previewing
  // a custom_hours override we must NOT double-count bookings that are already
  // inside a block_range — they were blocked before this change.
  const alreadyBlockedIntervals: Array<{ startMs: number; endMs: number }> =
    currentEffective.blockedIntervals ?? [];

  // 4. Find affected bookings
  // Overlap test uses half-open intervals [start, end):
  //   booking/ticket at EXACTLY the end boundary is NOT affected.
  //   booking/ticket ending EXACTLY at start boundary is NOT affected.
  const affectedBookings: AffectedBooking[] = [];
  if (unavailableIntervals.length > 0) {
    const bookingsRes = await db
      .request()
      .input("empId", sql.Int, empId)
      .input("bDate", sql.Date, date)
      .query(`
        SELECT
          b.BookingID, b.BookingCode, b.StartTime, b.EndTime, b.Status,
          c.Name AS ClientName,
          (SELECT TOP 1 p.ProName FROM dbo.BookingServices bs
           JOIN dbo.TblPro p ON p.ProID = bs.ProID
           WHERE bs.BookingID = b.BookingID) AS ServiceName
        FROM dbo.Bookings b
        LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
        WHERE b.BookingDate = @bDate
          AND b.AssignedEmpID = @empId
          AND b.Status IN ('confirmed', 'arrived', 'queued', 'in_service')
        ORDER BY b.StartTime
      `)
      .catch(() => ({ recordset: [] as any[] }));

    for (const bk of bookingsRes.recordset) {
      const bkStartHhmm = sqlTimeToHhmm(bk.StartTime);
      const bkEndHhmm   = sqlTimeToHhmm(bk.EndTime);
      if (!bkStartHhmm) continue;

      const bkStartMs = epochForTime(date, bkStartHhmm, shiftStartMin);
      const bkEndMs   = bkEndHhmm
        ? epochForTime(date, bkEndHhmm, shiftStartMin)
        : bkStartMs + 30 * 60_000;

      for (const iv of unavailableIntervals) {
        // Half-open: [iv.startMs, iv.endMs)
        if (bkStartMs < iv.endMs && bkEndMs > iv.startMs) {
          // Skip if this booking was already blocked by an existing block_range
          // (don't blame the new override for a pre-existing block)
          const alreadyBlocked = alreadyBlockedIntervals.some(
            ab => bkStartMs < ab.endMs && bkEndMs > ab.startMs,
          );
          if (alreadyBlocked) break;
          affectedBookings.push({
            bookingId:      bk.BookingID,
            bookingCode:    bk.BookingCode ?? null,
            startTime:      bkStartHhmm,
            endTime:        bkEndHhmm,
            status:         bk.Status,
            clientName:     bk.ClientName ?? null,
            serviceName:    bk.ServiceName ?? null,
            conflictReason: iv.reason,
          });
          break;
        }
      }
    }
  }

  // 5. Find affected queue tickets
  const affectedQueueTickets: AffectedQueueTicket[] = [];
  if (unavailableIntervals.length > 0) {
    const queueRes = await db
      .request()
      .input("empId", sql.Int, empId)
      .input("qDate", sql.Date, date)
      .query(`
        SELECT
          qt.QueueTicketID, qt.TicketCode, qt.Status,
          CASE WHEN COL_LENGTH('dbo.QueueTickets','EstimatedStartTime') IS NOT NULL
               THEN qt.EstimatedStartTime ELSE NULL END AS EstimatedStartTime,
          ISNULL(
            (SELECT SUM(ISNULL(qts.DurationMinutes, 30))
             FROM dbo.QueueTicketServices qts
             WHERE qts.QueueTicketID = qt.QueueTicketID),
            30
          ) AS DurationMinutes,
          c.Name AS ClientName
        FROM dbo.QueueTickets qt
        LEFT JOIN dbo.TblClient c ON c.ClientID = qt.ClientID
        WHERE qt.QueueDate = @qDate
          AND qt.EmpID = @empId
          AND LOWER(qt.Status) IN ('waiting','called','in_service')
        ORDER BY qt.TicketNumber
      `)
      .catch(() => ({ recordset: [] as any[] }));

    for (const qt of queueRes.recordset) {
      if (!qt.EstimatedStartTime) continue;
      const qtStartMs = new Date(qt.EstimatedStartTime).getTime();
      const dur = Math.max(1, Number(qt.DurationMinutes) || 30);
      const qtEndMs = qtStartMs + dur * 60_000;

      for (const iv of unavailableIntervals) {
        // Half-open: [iv.startMs, iv.endMs)
        if (qtStartMs < iv.endMs && qtEndMs > iv.startMs) {
          // Skip if already blocked by an existing block_range
          const alreadyBlocked = alreadyBlockedIntervals.some(
            ab => qtStartMs < ab.endMs && qtEndMs > ab.startMs,
          );
          if (alreadyBlocked) break;
          affectedQueueTickets.push({
            ticketId:           qt.QueueTicketID,
            ticketCode:         qt.TicketCode,
            status:             qt.Status,
            estimatedStartTime: new Date(qt.EstimatedStartTime).toISOString(),
            durationMinutes:    dur,
            clientName:         qt.ClientName ?? null,
            conflictReason:     iv.reason,
          });
          break;
        }
      }
    }
  }

  const safe = affectedBookings.length === 0 && affectedQueueTickets.length === 0;

  if (!safe) {
    const parts: string[] = [];
    if (affectedBookings.length > 0)    parts.push(`${affectedBookings.length} حجز`);
    if (affectedQueueTickets.length > 0) parts.push(`${affectedQueueTickets.length} دور`);
    warnings.push(`هذا التعديل سيؤثر على ${parts.join(" و ")}`);
  }

  // 6. QA logs
  console.log("[schedule-control/preview]", JSON.stringify({
    empId, date, type,
    oldEffectiveStart:  oldStart,
    oldEffectiveEnd:    oldEnd,
    newEffectiveStart:  newStart,
    newEffectiveEnd:    newEnd,
    unavailableIntervals: unavailableIntervals.map(iv => ({
      start: new Date(iv.startMs).toISOString(),
      end:   new Date(iv.endMs).toISOString(),
      reason: iv.reason,
    })),
    affectedBookingsCount:      affectedBookings.length,
    affectedQueueTicketsCount:  affectedQueueTickets.length,
    safe,
  }));

  return {
    safe,
    unavailableIntervals,
    affectedBookings,
    affectedQueueTickets,
    warnings,
    effectiveSchedulePreview: {
      isWorking:        newEffective.isWorking,
      start:            newEffective.start,
      end:              newEffective.end,
      blockedIntervals: newEffective.blockedIntervals,
    },
    oldEffectiveStart: oldStart,
    oldEffectiveEnd:   oldEnd,
    newEffectiveStart: newStart,
    newEffectiveEnd:   newEnd,
  };
}

// ── SQL TIME → HH:MM helper ───────────────────────────────────────────────────

function sqlTimeToHhmm(val: unknown): string | null {
  if (!val) return null;
  if (val instanceof Date) {
    return `${String(val.getUTCHours()).padStart(2,"0")}:${String(val.getUTCMinutes()).padStart(2,"0")}`;
  }
  if (typeof val === "string") {
    const m = val.trim().match(/^(\d{1,2}):(\d{2})/);
    if (m) return `${m[1].padStart(2,"0")}:${m[2]}`;
  }
  return null;
}
