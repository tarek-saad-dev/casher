/**
 * Admin Diagnostic Endpoint: Overnight Availability Audit
 *
 * GET /api/admin/debug/overnight-availability?date=2026-07-08&empId=<id>
 *
 * Returns a per-slot audit from 21:00 to 02:00 for a single employee,
 * using the same logic as the production booking availability engine.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAuthResult, requireDevelopmentAdmin } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import { getBarberWorkingWindow } from '@/lib/barberAvailability';
import {
  loadOverridesForDate,
  applyOverrides,
  slotBlockedByOverride,
  type EffectiveSchedule,
} from '@/lib/scheduleOverrides';
import {
  buildQueueIntervals,
  buildBookingIntervals,
  getDefaultDuration,
  type Interval,
} from '@/lib/queueEstimateEngine';
import { salonDateTimeToMs } from '@/lib/publicBookingHelpers';
import { intervalsOverlap } from '@/lib/scheduleIntervals';
import { getCairoBusinessDate } from '@/lib/businessDate';

export const runtime = 'nodejs';

const SALON_TZ = 'Africa/Cairo';
const DEV = process.env.NODE_ENV !== 'production';

interface SlotAudit {
  displayTime: string;
  dayOffset: 0 | 1;
  actualDateTime: string;
  actualDate: string;
  slotStartMs: number;
  slotEndMs: number;
  isInsideShift: boolean;
  isBlockedByOverride: boolean;
  hasBookingConflict: boolean;
  hasQueueConflict: boolean;
  available: boolean;
  reason: string | null;
  reasonCode: string | null;
}


function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function generateAuditSlots(): Array<{ displayTime: string; dayOffset: 0 | 1 }> {
  const slots: Array<{ displayTime: string; dayOffset: 0 | 1 }> = [];
  // 21:00 .. 23:45 same day
  for (let m = 21 * 60; m < 24 * 60; m += 15) {
    slots.push({ displayTime: minutesToHhmm(m), dayOffset: 0 });
  }
  // 00:00 .. 02:00 next day
  for (let m = 0; m <= 2 * 60; m += 15) {
    slots.push({ displayTime: minutesToHhmm(m), dayOffset: 1 });
  }
  return slots;
}

export async function GET(req: NextRequest) {
  const __auth = await requireDevelopmentAdmin();
  if (!isAuthResult(__auth)) return __auth;

  /* secret gate replaced by requireDevelopmentAdmin (Phase 1A) */

  const { searchParams } = new URL(req.url);
  const dateParam = searchParams.get('date');
  const empIdParam = searchParams.get('empId');

  if (!dateParam || !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    return NextResponse.json({ error: 'date مطلوب بصيغة YYYY-MM-DD' }, { status: 400 });
  }
  if (!empIdParam || isNaN(Number(empIdParam))) {
    return NextResponse.json({ error: 'empId مطلوب' }, { status: 400 });
  }

  const businessDate = dateParam;
  const empId = Number(empIdParam);

  try {
    const db = await getPool();

    const empRes = await db
      .request()
      .input('empId', sql.Int, empId)
      .query('SELECT EmpName FROM dbo.TblEmp WHERE EmpID = @empId');
    const empName = (empRes.recordset[0]?.EmpName as string) ?? '';

    const dateObj = new Date(`${businessDate}T12:00:00Z`);
    const dayOfWeek = dateObj.getDay();

    const baseWindow = await getBarberWorkingWindow(empId, dateObj);
    const base = baseWindow.isWorkingDay && baseWindow.startTime && baseWindow.endTime
      ? { isWorking: true, start: baseWindow.startTime, end: baseWindow.endTime }
      : { isWorking: false, start: '00:00', end: '00:00' };

    const overridesMap = await loadOverridesForDate(db, [empId], businessDate);
    const overrides = overridesMap.get(empId) ?? [];
    const effSched = applyOverrides(empId, businessDate, base, overrides);

    const defaultDur = await getDefaultDuration(db);
    const durationMinutes = 30; // fixed audit duration; conflict checks use this window

    const now = new Date();
    const nowMs = now.getTime();
    const todayBusinessDate = getCairoBusinessDate(now);
    const isTodayBusiness = businessDate === todayBusinessDate;

    const shiftStartMs = salonDateTimeToMs(businessDate, effSched.start, SALON_TZ);
    const isOvernight = hhmmToMinutes(effSched.end) <= hhmmToMinutes(effSched.start);
    const shiftEndMs = isOvernight
      ? salonDateTimeToMs(nextDate(businessDate), effSched.end, SALON_TZ)
      : salonDateTimeToMs(businessDate, effSched.end, SALON_TZ);

    const [qIntervals, bIntervals, qIntervalsNext, bIntervalsNext] = await Promise.all([
      buildQueueIntervals(db, empId, businessDate, now, defaultDur, undefined, {
        filterStale: true,
        graceMinutes: 30,
        debugContext: 'overnight-audit',
      }),
      buildBookingIntervals(db, empId, businessDate, defaultDur),
      isOvernight
        ? buildQueueIntervals(db, empId, nextDate(businessDate), now, defaultDur, undefined, {
            filterStale: true,
            graceMinutes: 30,
            debugContext: 'overnight-audit-next-day',
          })
        : Promise.resolve<Interval[]>([]),
      isOvernight ? buildBookingIntervals(db, empId, nextDate(businessDate), defaultDur) : Promise.resolve<Interval[]>([]),
    ]);

    const inShiftWindow = (iv: Interval) =>
      iv.start.getTime() < shiftEndMs && iv.end.getTime() > shiftStartMs;
    const nextDayBusy = isOvernight
      ? [...qIntervalsNext, ...bIntervalsNext].filter(inShiftWindow)
      : [];

    const busyIntervals = [...qIntervals, ...bIntervals, ...nextDayBusy];

    const slots: SlotAudit[] = [];

    for (const { displayTime, dayOffset } of generateAuditSlots()) {
      const actualDate = dayOffset === 1 ? nextDate(businessDate) : businessDate;
      const slotStartMs = salonDateTimeToMs(actualDate, displayTime, SALON_TZ);
      const slotEndMs = slotStartMs + durationMinutes * 60_000;

      const isInsideShift = slotStartMs >= shiftStartMs && slotEndMs <= shiftEndMs;

      const overrideReason = slotBlockedByOverride(slotStartMs, slotEndMs, effSched);
      const isBlockedByOverride = !!overrideReason;

      let hasBookingConflict = false;
      let hasQueueConflict = false;
      let conflictReason: string | null = null;

      const slotStart = new Date(slotStartMs);
      const slotEnd = new Date(slotEndMs);

      for (const iv of busyIntervals) {
        if (intervalsOverlap(slotStart, slotEnd, iv.start, iv.end)) {
          if (iv.source === 'queue') {
            hasQueueConflict = true;
            conflictReason = 'تعارض مع دور في الصف';
          } else {
            hasBookingConflict = true;
            conflictReason = 'يوجد حجز في هذا الوقت';
          }
          break;
        }
      }

      let reason: string | null = null;
      let reasonCode: string | null = null;
      let available = true;

      if (isTodayBusiness && slotStartMs <= nowMs) {
        available = false;
        reason = 'وقت مضى';
        reasonCode = 'past';
      } else if (!isInsideShift) {
        available = false;
        reason = 'خارج ساعات العمل';
        reasonCode = 'outside_working_hours';
      } else if (isBlockedByOverride) {
        available = false;
        reason = overrideReason ?? 'فترة مغلقة أو استراحة';
        reasonCode = 'override_block';
      } else if (hasBookingConflict || hasQueueConflict) {
        available = false;
        reason = conflictReason ?? 'تعارض';
        reasonCode = hasQueueConflict ? 'queue_conflict' : 'booking_conflict';
      }

      slots.push({
        displayTime,
        dayOffset,
        actualDateTime: new Date(slotStartMs).toISOString(),
        actualDate,
        slotStartMs,
        slotEndMs,
        isInsideShift,
        isBlockedByOverride,
        hasBookingConflict,
        hasQueueConflict,
        available,
        reason,
        reasonCode,
      });
    }

    const bIntervalsAll = [...bIntervals, ...bIntervalsNext.filter(inShiftWindow)];
    const qIntervalsAll = [...qIntervals, ...qIntervalsNext.filter(inShiftWindow)];

    const bookingsUsed = bIntervalsAll.map((b) => ({
      bookingId: b.id,
      source: b.source,
      startAt: b.start.toISOString(),
      endAt: b.end.toISOString(),
      overlapsAnySlot: slots.some((s) => {
        const sStart = new Date(s.slotStartMs);
        const sEnd = new Date(s.slotEndMs);
        return intervalsOverlap(sStart, sEnd, b.start, b.end);
      }),
    }));

    const queueUsed = qIntervalsAll.map((q) => ({
      queueTicketId: q.id,
      ticketCode: q.ticketCode,
      source: q.source,
      startAt: q.start.toISOString(),
      endAt: q.end.toISOString(),
      overlapsAnySlot: slots.some((s) => {
        const sStart = new Date(s.slotStartMs);
        const sEnd = new Date(s.slotEndMs);
        return intervalsOverlap(sStart, sEnd, q.start, q.end);
      }),
    }));

    return NextResponse.json({
      ok: true,
      empId,
      empName,
      businessDate,
      dayOfWeek,
      isTodayBusiness,
      nowCairo: new Date(nowMs).toISOString(),
      baseSchedule: {
        start: base.start,
        end: base.end,
        isWorkingDay: base.isWorking,
        crossesMidnight:
          base.isWorking && hhmmToMinutes(base.end) <= hhmmToMinutes(base.start),
      },
      effectiveSchedule: {
        start: effSched.start,
        end: effSched.end,
        isWorking: effSched.isWorking,
        crossesMidnight: isOvernight,
        appliedOverride: effSched.appliedOverride
          ? {
              overrideId: effSched.appliedOverride.OverrideID,
              type: effSched.appliedOverride.Type,
              reason: effSched.appliedOverride.Reason,
              startTime: effSched.appliedOverride.StartTime,
              endTime: effSched.appliedOverride.EndTime,
            }
          : null,
        blockedIntervals: effSched.blockedIntervals.map((iv) => ({
          startAt: new Date(iv.startMs).toISOString(),
          endAt: new Date(iv.endMs).toISOString(),
          reason: iv.reason,
        })),
      },
      shiftBoundaries: {
        shiftStartMs,
        shiftEndMs,
        shiftStartAt: new Date(shiftStartMs).toISOString(),
        shiftEndAt: new Date(shiftEndMs).toISOString(),
      },
      slots,
      bookingsUsedForConflict: bookingsUsed,
      queueUsedForConflict: queueUsed,
      overridesUsed: overrides.map((o) => ({
        overrideId: o.OverrideID,
        type: o.Type,
        startTime: o.StartTime,
        endTime: o.EndTime,
        reason: o.Reason,
        isActive: o.IsActive,
      })),
    });
  } catch (err: any) {
    console.error('[admin/debug/overnight-availability] error:', err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? 'Unknown error' },
      { status: 500 },
    );
  }
}
