/**
 * Canonical booking availability — shared by public booking, operations drawer,
 * check-slot, and create guard. Uses buildQueueIntervals + buildBookingIntervals
 * from queueEstimateEngine (same source as operations timeline).
 */

import { getPool, sql } from '@/lib/db';
import {
  getPublicSettings,
  salonDateTimeToMs,
} from '@/lib/publicBookingHelpers';
import {
  buildQueueIntervals,
  buildBookingIntervals,
  getDefaultDuration,
  type Interval,
} from '@/lib/queueEstimateEngine';
import { calculateServicePlanDuration } from '@/lib/servicePlan';
import { getBarberWorkingWindow } from '@/lib/barberAvailability';
import { getAttendanceStatus } from '@/lib/availabilityEngine';
import {
  loadOverridesForDate,
  applyOverrides,
  slotBlockedByOverride,
  type EffectiveSchedule,
} from '@/lib/scheduleOverrides';
import { intervalsOverlap } from '@/lib/scheduleIntervals';
import { getCairoBusinessDate } from '@/lib/businessDate';

export type BookingSlotReasonCode =
  | 'insufficient_continuous_time'
  | 'booking_conflict'
  | 'queue_conflict'
  | 'break'
  | 'outside_working_hours'
  | 'minimum_notice'
  | 'barber_unavailable'
  | 'past';

export interface BookingSlotPlan {
  time: string;
  endTime: string;
  dayOffset: 0 | 1;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  empId: number;
  empName: string;
  available: boolean;
  reasonCode?: BookingSlotReasonCode;
  reasonMessage?: string;
  label: string;
}

export interface GapNotice {
  gapStart: string;
  gapEnd: string;
  gapMinutes: number;
  requiredMinutes: number;
  message: string;
}

export interface BarberAlternative {
  empId: number;
  empName: string;
  time: string;
  endTime: string;
  startAt: string;
  endAt: string;
}

export interface ListAvailableBookingSlotsResult {
  ok: true;
  date: string;
  mode: 'nearest' | 'specific';
  empId?: number;
  durationMinutes: number;
  durationSource: string;
  slots: BookingSlotPlan[];
  availableSlots: BookingSlotPlan[];
  gapNotice: GapNotice | null;
  nextAvailable: BookingSlotPlan | null;
  alternativeBarbers: BarberAlternative[];
  noSlotsReason: string | null;
  debug: Record<string, unknown>;
}

export interface BookingSlotValidation {
  available: boolean;
  plan: BookingSlotPlan | null;
  nextAvailable: BookingSlotPlan | null;
  reasonCode?: BookingSlotReasonCode;
  reasonMessage?: string;
}

/** Public booking UI cap — operations/admin receive the full set. */
export const PUBLIC_AVAILABLE_SLOTS_LIMIT = 12;

export type SlotRejectionBucket =
  | 'past_or_min_notice'
  | 'outside_working_hours'
  | 'booking_conflict'
  | 'queue_conflict'
  | 'block_range'
  | 'break'
  | 'insufficient_duration'
  | 'barber_unavailable'
  | 'unknown';

export const EMPTY_REJECTION_COUNTS: Record<SlotRejectionBucket, number> = {
  past_or_min_notice: 0,
  outside_working_hours: 0,
  booking_conflict: 0,
  queue_conflict: 0,
  block_range: 0,
  break: 0,
  insufficient_duration: 0,
  barber_unavailable: 0,
  unknown: 0,
};

function mapReasonToBucket(code?: BookingSlotReasonCode): SlotRejectionBucket {
  if (!code) return 'unknown';
  if (code === 'past' || code === 'minimum_notice') return 'past_or_min_notice';
  if (code === 'outside_working_hours') return 'outside_working_hours';
  if (code === 'booking_conflict') return 'booking_conflict';
  if (code === 'queue_conflict') return 'queue_conflict';
  if (code === 'break') return 'break';
  if (code === 'insufficient_continuous_time') return 'insufficient_duration';
  if (code === 'barber_unavailable') return 'barber_unavailable';
  return 'unknown';
}

export const BOOKING_SLOT_REASON_AR: Record<BookingSlotReasonCode, string> = {
  insufficient_continuous_time: 'المدة المطلوبة لا تتسع في هذه الفترة',
  booking_conflict: 'يوجد حجز في هذا الوقت',
  queue_conflict: 'يوجد دور نشط في هذا الوقت',
  break: 'فترة مغلقة أو استراحة',
  outside_working_hours: 'خارج ساعات العمل',
  minimum_notice: 'قريب جداً من الوقت الحالي',
  barber_unavailable: 'الحلاق غير متاح',
  past: 'وقت مضى',
};

type BarberCtx = {
  empId: number;
  empName: string;
  durationMinutes: number;
  busy: Interval[];
  effSched: EffectiveSchedule | null;
  shiftStartMs: number;
  shiftEndMs: number;
  dayOff: boolean;
};

async function buildBarberContexts(args: {
  date: string;
  serviceIds: number[];
  mode: 'nearest' | 'specific';
  empId?: number | null;
  source?: 'public' | 'operations' | 'admin';
  durationOverride?: number;
}): Promise<{
  contexts: BarberCtx[];
  totalDuration: number;
  durationSource: string;
  settings: Awaited<ReturnType<typeof getPublicSettings>>;
  db: Awaited<ReturnType<typeof getPool>>;
  now: Date;
  nowMs: number;
  isToday: boolean;
  timezone: string;
  effectiveMinNotice: number;
}> {
  const { date, serviceIds, mode, empId, source = 'public', durationOverride } = args;
  const settings = await getPublicSettings();
  const db = await getPool();
  const timezone = settings.timezone || 'Africa/Cairo';
  const isInternalSource = source === 'operations' || source === 'admin';
  const effectiveMinNotice = isInternalSource ? 0 : settings.minNoticeMinutes;
  const now = new Date();
  const nowMs = now.getTime();
  const todayBusinessDate = getCairoBusinessDate(now);
  const isToday = date === todayBusinessDate;

  const systemDefault = settings.defaultServiceDurationMinutes || 30;
  const defaultDur = await getDefaultDuration(db);
  let totalDuration = durationOverride ?? systemDefault;
  let durationSource: string = durationOverride ? 'OVERRIDE' : 'SYSTEM_DEFAULT';

  if (!durationOverride && serviceIds.length > 0) {
    try {
      const plan = await calculateServicePlanDuration(serviceIds);
      totalDuration = plan.totalDurationMinutes;
      durationSource = 'SERVICE_SUM';
      if (process.env.NODE_ENV !== 'production' && (source === 'operations' || source === 'admin')) {
        console.log('[bookingAvailability] service plan duration', {
          serviceIds,
          totalDurationMinutes: plan.totalDurationMinutes,
          services: plan.services.map((s) => ({ id: s.serviceId, name: s.serviceName, min: s.durationMinutes })),
        });
      }
    } catch (err) {
      console.error('[bookingAvailability] calculateServicePlanDuration failed', { serviceIds, err });
      throw err;
    }
  }

  const barberIds: number[] =
    mode === 'specific' && empId ? [empId] : await getAllBarberIds(db);

  const contexts: BarberCtx[] = [];
  if (barberIds.length) {
    const nameMap = await getBarberNames(db, barberIds);
    const dayOffSet = await loadDayOffSet(db, barberIds, date, isToday);
    const overridesMap = await loadOverridesForDate(db, barberIds, date);

    for (const id of barberIds) {
      if (dayOffSet.has(id)) continue;

      if (isToday) {
        const attendance = await getAttendanceStatus(id, date);
        if (attendance?.status === 'Absent') continue;
      }

      const dateObj = new Date(`${date}T12:00:00Z`);
      const baseWindow = await getBarberWorkingWindow(id, dateObj);
      const base = baseWindow.isWorkingDay && baseWindow.startTime && baseWindow.endTime
        ? { isWorking: true, start: baseWindow.startTime, end: baseWindow.endTime }
        : { isWorking: false, start: '00:00', end: '00:00' };

      const effSched = applyOverrides(id, date, base, overridesMap.get(id) ?? []);
      if (!effSched.isWorking) continue;

      const shiftStartMs = salonDateTimeToMs(date, effSched.start, timezone);
      const isOvernight = hhmmToMinutes(effSched.end) <= hhmmToMinutes(effSched.start);
      const shiftEndMs = isOvernight
        ? salonDateTimeToMs(nextDate(date), effSched.end, timezone)
        : salonDateTimeToMs(date, effSched.end, timezone);

      const nextDayStr = isOvernight ? nextDate(date) : null;
      const [qIntervals, bIntervals, qIntervalsNext, bIntervalsNext] = await Promise.all([
        buildQueueIntervals(db, id, date, now, defaultDur, undefined, {
          filterStale: true,
          graceMinutes: 30,
          debugContext: 'booking-availability',
        }),
        buildBookingIntervals(db, id, date, defaultDur),
        nextDayStr
          ? buildQueueIntervals(db, id, nextDayStr, now, defaultDur, undefined, {
              filterStale: true,
              graceMinutes: 30,
              debugContext: 'booking-availability-next-day',
            })
          : Promise.resolve<Interval[]>([]),
        nextDayStr ? buildBookingIntervals(db, id, nextDayStr, defaultDur) : Promise.resolve<Interval[]>([]),
      ]);

      const inShiftWindow = (iv: Interval) => iv.start.getTime() < shiftEndMs && iv.end.getTime() > shiftStartMs;
      const nextDayBusy = nextDayStr
        ? [...qIntervalsNext, ...bIntervalsNext].filter(inShiftWindow)
        : [];

      contexts.push({
        empId: id,
        empName: nameMap[id] ?? '',
        durationMinutes: totalDuration,
        busy: [...qIntervals, ...bIntervals, ...nextDayBusy],
        effSched,
        shiftStartMs,
        shiftEndMs,
        dayOff: false,
      });
    }
  }

  return {
    contexts,
    totalDuration,
    durationSource,
    settings,
    db,
    now,
    nowMs,
    isToday,
    timezone,
    effectiveMinNotice,
  };
}

/** Half-open [start, end) conflict test against busy intervals. */
export function evaluateBookingSlotAt(
  slotStartMs: number,
  durationMinutes: number,
  busyIntervals: Array<{ start: Date; end: Date; source?: string }>,
  options?: {
    shiftStartMs?: number;
    shiftEndMs?: number;
    nowMs?: number;
    minNoticeMs?: number;
    overrideBlock?: boolean;
  },
): {
  available: boolean;
  slotEndMs: number;
  reasonCode?: BookingSlotReasonCode;
} {
  const slotEndMs = slotStartMs + durationMinutes * 60_000;
  const {
    shiftStartMs,
    shiftEndMs,
    nowMs,
    minNoticeMs = 0,
    overrideBlock = false,
  } = options ?? {};

  if (nowMs != null && slotStartMs <= nowMs) {
    return { available: false, slotEndMs, reasonCode: 'past' };
  }
  if (nowMs != null && slotStartMs < nowMs + minNoticeMs) {
    return { available: false, slotEndMs, reasonCode: 'minimum_notice' };
  }
  if (shiftStartMs != null && slotStartMs < shiftStartMs) {
    return { available: false, slotEndMs, reasonCode: 'outside_working_hours' };
  }
  if (shiftEndMs != null && slotEndMs > shiftEndMs) {
    return { available: false, slotEndMs, reasonCode: 'insufficient_continuous_time' };
  }
  if (overrideBlock) {
    return { available: false, slotEndMs, reasonCode: 'break' };
  }

  const slotStart = new Date(slotStartMs);
  const slotEnd = new Date(slotEndMs);

  for (const iv of busyIntervals) {
    if (intervalsOverlap(slotStart, slotEnd, iv.start, iv.end)) {
      const code: BookingSlotReasonCode =
        iv.source === 'queue' ? 'queue_conflict' : 'booking_conflict';
      return { available: false, slotEndMs, reasonCode: code };
    }
  }

  return { available: true, slotEndMs };
}

/** Find a visible gap shorter than required duration (for UX notice). */
export function findInsufficientGapNotice(
  busyIntervals: Array<{ start: Date; end: Date }>,
  requiredMinutes: number,
  workingStartMs: number,
  workingEndMs: number,
): GapNotice | null {
  if (requiredMinutes <= 0) return null;

  const sorted = [...busyIntervals]
    .map((iv) => ({
      startMs: Math.max(iv.start.getTime(), workingStartMs),
      endMs: Math.min(iv.end.getTime(), workingEndMs),
    }))
    .filter((iv) => iv.endMs > iv.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const merged: Array<{ startMs: number; endMs: number }> = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (!last || iv.startMs > last.endMs) {
      merged.push({ ...iv });
    } else {
      last.endMs = Math.max(last.endMs, iv.endMs);
    }
  }

  let best: GapNotice | null = null;

  for (let i = 0; i < merged.length - 1; i++) {
    const gapStartMs = merged[i].endMs;
    const gapEndMs = merged[i + 1].startMs;
    if (gapEndMs <= gapStartMs) continue;
    const gapMinutes = Math.round((gapEndMs - gapStartMs) / 60_000);
    if (gapMinutes > 0 && gapMinutes < requiredMinutes) {
      const notice = buildGapNotice(gapStartMs, gapEndMs, gapMinutes, requiredMinutes);
      if (!best || gapMinutes > best.gapMinutes) best = notice;
    }
  }

  return best;
}

function buildGapNotice(
  startMs: number,
  endMs: number,
  gapMinutes: number,
  requiredMinutes: number,
): GapNotice {
  const gapStart = msToCairoHhmm(startMs);
  const gapEnd = msToCairoHhmm(endMs);
  return {
    gapStart,
    gapEnd,
    gapMinutes,
    requiredMinutes,
    message: `الفترة بين ${formatArTime(gapStart)} و${formatArTime(gapEnd)} مدتها ${gapMinutes} دقيقة فقط، بينما الخدمات المختارة تحتاج ${requiredMinutes} دقيقة.`,
  };
}

export async function listAvailableBookingSlots(args: {
  date: string;
  serviceIds: number[];
  mode: 'nearest' | 'specific';
  empId?: number | null;
  source?: 'public' | 'operations' | 'admin';
}): Promise<ListAvailableBookingSlotsResult> {
  const { date, serviceIds, mode, empId, source = 'public' } = args;
  const today = new Date();
  const todayBusinessDate = getCairoBusinessDate(today);
  const isPast = date < todayBusinessDate;

  const {
    contexts,
    totalDuration,
    durationSource,
    settings,
    nowMs,
    isToday,
    timezone,
    effectiveMinNotice,
  } = await buildBarberContexts({
    date,
    serviceIds,
    mode,
    empId,
    source,
  });

  if (isPast) {
    return emptyResult(args, totalDuration, 'SYSTEM_DEFAULT', 'تاريخ مضى');
  }

  const nameMap: Record<number, string> = {};
  for (const ctx of contexts) nameMap[ctx.empId] = ctx.empName;

  const slotIntervalMinutes = settings.slotIntervalMinutes || 15;
  const minNoticeMs = effectiveMinNotice * 60_000;

  const slotMap = new Map<string, 0 | 1>();
  for (const ctx of contexts) {
    if (!ctx.effSched) continue;
    for (const entry of generateSlotEntries(
      ctx.effSched.start,
      ctx.effSched.end,
      slotIntervalMinutes,
      totalDuration,
    )) {
      if (!slotMap.has(entry.time) || entry.dayOffset < slotMap.get(entry.time)!) {
        slotMap.set(entry.time, entry.dayOffset);
      }
    }
  }

  const sortedSlotTimes = [...slotMap.entries()].sort(([aT, aD], [bT, bD]) =>
    aD !== bD ? aD - bD : aT.localeCompare(bT),
  );
  const generatedCandidateCount = sortedSlotTimes.length;

  const rejectionCounts = { ...EMPTY_REJECTION_COUNTS };
  const allPlans = evaluateSlotsForContexts({
    date,
    contexts,
    sortedSlotTimes,
    mode,
    empId,
    timezone,
    isToday,
    nowMs,
    minNoticeMs,
    rejectionCounts,
  });

  const availableSlotsUnlimited = allPlans.filter((s: BookingSlotPlan) => s.available);
  const validSlotCountBeforeLimit = availableSlotsUnlimited.length;
  const isInternalSource = source === 'operations' || source === 'admin';
  const limitApplied = !isInternalSource && validSlotCountBeforeLimit > PUBLIC_AVAILABLE_SLOTS_LIMIT;
  const availableSlots = limitApplied
    ? availableSlotsUnlimited.slice(0, PUBLIC_AVAILABLE_SLOTS_LIMIT)
    : availableSlotsUnlimited;
  const returnedSlotCount = availableSlots.length;
  const nextAvailable = availableSlots[0] ?? null;

  const primaryCtx =
    (mode === 'specific' && empId ? contexts.find((c) => c.empId === empId) : null)
    ?? contexts[0]
    ?? null;
  const scheduleStartAt = primaryCtx?.effSched?.start ?? null;
  const scheduleEndAt = primaryCtx?.effSched?.end ?? null;
  const isOvernight = scheduleStartAt && scheduleEndAt
    ? hhmmToMinutes(scheduleEndAt) <= hhmmToMinutes(scheduleStartAt)
    : false;

  const slotAudit = {
    date,
    mode,
    empId: empId ?? null,
    serviceIds,
    totalDurationMinutes: totalDuration,
    slotIntervalMinutes,
    minNoticeMinutes: effectiveMinNotice,
    nowCairo: msToHhmm(nowMs, timezone, date),
    scheduleStartAt,
    scheduleEndAt,
    isOvernight,
    busyIntervalsCount: primaryCtx?.busy.length ?? 0,
    busyIntervals: (primaryCtx?.busy ?? []).slice(0, 20).map((iv) => ({
      type: iv.source ?? 'unknown',
      startAt: iv.start.toISOString(),
      endAt: iv.end.toISOString(),
    })),
    generatedCandidateCount,
    validSlotCountBeforeLimit,
    returnedSlotCount,
    limitApplied,
    rejectedByReason: rejectionCounts,
  };

  if (process.env.NODE_ENV !== 'production' && isInternalSource) {
    console.log('[available-slots audit]', slotAudit);
  }

  let gapNotice: GapNotice | null = null;
  if (mode === 'specific' && empId) {
    const ctx = contexts.find((c) => c.empId === empId);
    if (ctx) {
      gapNotice = findInsufficientGapNotice(
        ctx.busy,
        ctx.durationMinutes,
        ctx.shiftStartMs,
        ctx.shiftEndMs,
      );
    }
  }

  const alternativeBarbers: BarberAlternative[] = [];
  if (mode === 'specific' && empId && availableSlots.length === 0) {
    for (const ctx of contexts) {
      if (ctx.empId === empId) continue;
      for (const [time, dayOffset] of sortedSlotTimes) {
        const slotDate = dayOffset === 1 ? nextDate(date) : date;
        const slotStartMs = salonDateTimeToMs(slotDate, time, timezone);
        const plan = evaluateBarberSlot({
          ctx,
          time,
          dayOffset,
          slotDate,
          slotStartMs,
          timezone,
          isToday,
          nowMs,
          minNoticeMs: effectiveMinNotice * 60_000,
        });
        if (plan?.available) {
          alternativeBarbers.push({
            empId: plan.empId,
            empName: plan.empName,
            time: plan.time,
            endTime: plan.endTime,
            startAt: plan.startAt,
            endAt: plan.endAt,
          });
          break;
        }
      }
      if (alternativeBarbers.length >= 3) break;
    }
  }

  let noSlotsReason: string | null = null;
  if (availableSlots.length === 0) {
    const barberName = mode === 'specific' && empId ? nameMap[empId] ?? 'الحلاق' : null;
    if (contexts.length === 0) {
      noSlotsReason = 'جميع الموظفين في إجازة أو بدون جدول عمل';
    } else if (barberName) {
      noSlotsReason = `لا توجد فترة متصلة مدتها ${totalDuration} دقيقة متاحة مع ${barberName} في هذا اليوم.`;
    } else {
      noSlotsReason = `لا توجد فترة متصلة مدتها ${totalDuration} دقيقة متاحة في هذا اليوم.`;
    }
  }

  return {
    ok: true,
    date,
    mode,
    ...(mode === 'specific' && empId ? { empId } : {}),
    durationMinutes: totalDuration,
    durationSource,
    slots: allPlans,
    availableSlots,
    gapNotice,
    nextAvailable,
    alternativeBarbers,
    noSlotsReason,
    debug: {
      serviceIds,
      totalDurationMinutes: totalDuration,
      isToday,
      isInternalSource,
      effectiveMinNotice,
      barberCount: contexts.length,
      slotsTotal: allPlans.length,
      slotsAvailable: returnedSlotCount,
      validSlotCountBeforeLimit,
      generatedCandidateCount,
      limitApplied,
      slotAudit,
    },
  };
}

function evaluateSlotsForContexts(args: {
  date: string;
  contexts: BarberCtx[];
  sortedSlotTimes: Array<[string, 0 | 1]>;
  mode: 'nearest' | 'specific';
  empId?: number | null;
  timezone: string;
  isToday: boolean;
  nowMs: number;
  minNoticeMs: number;
  rejectionCounts?: Record<SlotRejectionBucket, number>;
}): BookingSlotPlan[] {
  const {
    date,
    contexts,
    sortedSlotTimes,
    mode,
    empId,
    timezone,
    isToday,
    nowMs,
    minNoticeMs,
    rejectionCounts,
  } = args;
  const allPlans: BookingSlotPlan[] = [];

  const recordRejection = (plan: BookingSlotPlan | null) => {
    if (!rejectionCounts || !plan || plan.available) return;
    const bucket = mapReasonToBucket(plan.reasonCode);
    rejectionCounts[bucket] += 1;
  };

  for (const [time, dayOffset] of sortedSlotTimes) {
    const slotDate = dayOffset === 1 ? nextDate(date) : date;
    const slotStartMs = salonDateTimeToMs(slotDate, time, timezone);

    if (mode === 'specific' && empId) {
      const ctx = contexts.find((c) => c.empId === empId);
      if (!ctx) continue;
      const plan = evaluateBarberSlot({
        ctx,
        time,
        dayOffset,
        slotDate,
        slotStartMs,
        timezone,
        isToday,
        nowMs,
        minNoticeMs,
        includeSilentRejections: !!rejectionCounts,
      });
      recordRejection(plan);
      if (plan) allPlans.push(plan);
    } else {
      let best: BookingSlotPlan | null = null;
      let bestOrder = Number.POSITIVE_INFINITY;
      for (let i = 0; i < contexts.length; i++) {
        const ctx = contexts[i];
        const plan = evaluateBarberSlot({
          ctx,
          time,
          dayOffset,
          slotDate,
          slotStartMs,
          timezone,
          isToday,
          nowMs,
          minNoticeMs,
          includeSilentRejections: false,
        });
        if (plan?.available) {
          if (i < bestOrder) {
            best = plan;
            bestOrder = i;
          }
        }
      }
      if (!best && rejectionCounts) {
        const ctx = contexts[0];
        if (ctx) {
          const probe = evaluateBarberSlot({
            ctx,
            time,
            dayOffset,
            slotDate,
            slotStartMs,
            timezone,
            isToday,
            nowMs,
            minNoticeMs,
            includeSilentRejections: true,
          });
          recordRejection(probe);
        }
      }
      if (best) allPlans.push(best);
    }
  }

  return allPlans;
}

/**
 * Canonical single-slot validation used by the create and check-slot APIs.
 * Reuses the same barber contexts, busy intervals, and evaluation logic as
 * listAvailableBookingSlots so the server is the single source of truth.
 */
export async function validateBookingSlot(args: {
  date: string;
  time: string;
  dayOffset?: 0 | 1;
  serviceIds?: number[];
  durationOverride?: number;
  mode: 'nearest' | 'specific';
  empId?: number | null;
  source?: 'public' | 'operations' | 'admin';
}): Promise<BookingSlotValidation> {
  const { date, time, dayOffset = 0, serviceIds, durationOverride, mode, empId, source = 'public' } = args;

  const {
    contexts,
    totalDuration,
    settings,
    nowMs,
    isToday,
    timezone,
    effectiveMinNotice,
  } = await buildBarberContexts({
    date,
    serviceIds: serviceIds ?? [],
    mode,
    empId,
    source,
    durationOverride,
  });

  const minNoticeMs = effectiveMinNotice * 60_000;
  const slotDate = dayOffset === 1 ? nextDate(date) : date;
  const slotStartMs = salonDateTimeToMs(slotDate, time, timezone);

  let plan: BookingSlotPlan | null = null;
  let nextAvailable: BookingSlotPlan | null = null;

  if (mode === 'specific' && empId) {
    const ctx = contexts.find((c) => c.empId === empId);
    if (ctx) {
      plan = evaluateBarberSlot({
        ctx,
        time,
        dayOffset,
        slotDate,
        slotStartMs,
        timezone,
        isToday,
        nowMs,
        minNoticeMs,
        includeSilentRejections: true,
      });
    }
  } else {
    for (const ctx of contexts) {
      const candidate = evaluateBarberSlot({
        ctx,
        time,
        dayOffset,
        slotDate,
        slotStartMs,
        timezone,
        isToday,
        nowMs,
        minNoticeMs,
        includeSilentRejections: true,
      });
      if (candidate?.available) {
        plan = candidate;
        break;
      }
      if (!plan && candidate) {
        plan = candidate;
      }
    }
  }

  // Find the next available slot as a fallback (using the same 15-min grid).
  const slotInterval = settings.slotIntervalMinutes || 15;
  const slotTimes: Array<[string, 0 | 1]> = [];
  for (const ctx of contexts) {
    if (!ctx.effSched) continue;
    for (const entry of generateSlotEntries(ctx.effSched.start, ctx.effSched.end, slotInterval, totalDuration)) {
      if (!slotTimes.some(([t, d]) => t === entry.time && d === entry.dayOffset)) {
        slotTimes.push([entry.time, entry.dayOffset]);
      }
    }
  }
  slotTimes.sort(([aT, aD], [bT, bD]) => (aD !== bD ? aD - bD : aT.localeCompare(bT)));

  const allPlans = evaluateSlotsForContexts({
    date,
    contexts,
    sortedSlotTimes: slotTimes,
    mode,
    empId,
    timezone,
    isToday,
    nowMs,
    minNoticeMs,
  });
  const available = allPlans.find((p) => p.available);
  if (available) {
    if (!plan?.available) nextAvailable = available;
    else if (available.time !== plan.time || available.dayOffset !== plan.dayOffset) {
      nextAvailable = available;
    }
  }

  return {
    available: plan?.available ?? false,
    plan,
    nextAvailable,
    reasonCode: plan?.reasonCode,
    reasonMessage: plan?.reasonMessage,
  };
}

function evaluateBarberSlot(args: {
  ctx: {
    empId: number;
    empName: string;
    durationMinutes: number;
    busy: Interval[];
    effSched: EffectiveSchedule | null;
    shiftStartMs: number;
    shiftEndMs: number;
  };
  time: string;
  dayOffset: 0 | 1;
  slotDate: string;
  slotStartMs: number;
  timezone: string;
  isToday: boolean;
  nowMs: number;
  minNoticeMs: number;
  includeSilentRejections?: boolean;
}): BookingSlotPlan | null {
  const { ctx, time, dayOffset, slotDate, slotStartMs, isToday, nowMs, minNoticeMs, includeSilentRejections } = args;
  const overrideBlock = ctx.effSched
    ? !!slotBlockedByOverride(
        slotStartMs,
        slotStartMs + ctx.durationMinutes * 60_000,
        ctx.effSched,
      )
    : false;

  const evalResult = evaluateBookingSlotAt(slotStartMs, ctx.durationMinutes, ctx.busy, {
    shiftStartMs: ctx.shiftStartMs,
    shiftEndMs: ctx.shiftEndMs,
    nowMs: isToday ? nowMs : undefined,
    minNoticeMs: isToday ? minNoticeMs : 0,
    overrideBlock,
  });

  if (!evalResult.available) {
    if (
      !includeSilentRejections &&
      (evalResult.reasonCode === 'past' ||
        evalResult.reasonCode === 'minimum_notice' ||
        evalResult.reasonCode === 'outside_working_hours')
    ) {
      return null;
    }
  }

  const endTime = msToHhmm(evalResult.slotEndMs, args.timezone, slotDate);
  const label = formatSlotLabel(time, endTime);

  return {
    time,
    endTime,
    dayOffset,
    startAt: new Date(slotStartMs).toISOString(),
    endAt: new Date(evalResult.slotEndMs).toISOString(),
    durationMinutes: ctx.durationMinutes,
    empId: ctx.empId,
    empName: ctx.empName,
    available: evalResult.available,
    reasonCode: evalResult.reasonCode,
    reasonMessage: evalResult.reasonCode
      ? BOOKING_SLOT_REASON_AR[evalResult.reasonCode]
      : undefined,
    label,
  };
}

function emptyResult(
  args: { date: string; mode: 'nearest' | 'specific'; empId?: number | null },
  durationMinutes: number,
  durationSource: string,
  noSlotsReason: string,
): ListAvailableBookingSlotsResult {
  return {
    ok: true,
    date: args.date,
    mode: args.mode,
    ...(args.mode === 'specific' && args.empId ? { empId: args.empId } : {}),
    durationMinutes,
    durationSource,
    slots: [],
    availableSlots: [],
    gapNotice: null,
    nextAvailable: null,
    alternativeBarbers: [],
    noSlotsReason,
    debug: {},
  };
}

function generateSlotEntries(
  start: string,
  end: string,
  intervalMin: number,
  minDurationMinutes = 0,
): Array<{ time: string; dayOffset: 0 | 1 }> {
  const entries: Array<{ time: string; dayOffset: 0 | 1 }> = [];
  const startMin = hhmmToMinutes(start);
  const endMin = hhmmToMinutes(end);
  const overnight = endMin <= startMin;
  const endTotal = overnight ? endMin + 24 * 60 : endMin;
  const lastStartInclusive = minDurationMinutes > 0
    ? endTotal - minDurationMinutes
    : endTotal - intervalMin;
  let cur = startMin;
  while (cur <= lastStartInclusive) {
    const tod = cur % (24 * 60);
    const dayOffset: 0 | 1 = cur >= 24 * 60 ? 1 : 0;
    entries.push({
      time: `${String(Math.floor(tod / 60)).padStart(2, '0')}:${String(tod % 60).padStart(2, '0')}`,
      dayOffset,
    });
    cur += intervalMin;
  }
  return entries;
}

async function getAllBarberIds(
  db: Awaited<ReturnType<typeof getPool>>,
): Promise<number[]> {
  const res = await db
    .request()
    .query(`
      SELECT EmpID FROM dbo.TblEmp
      WHERE ISNULL(isActive,1)=1 AND Job IN (N'حلاق',N'مساعد',N'Barber',N'barber')
      ORDER BY EmpName
    `)
    .catch(() => ({ recordset: [] as Array<{ EmpID: number }> }));
  return res.recordset.map((r) => r.EmpID);
}

async function getBarberNames(
  db: Awaited<ReturnType<typeof getPool>>,
  ids: number[],
): Promise<Record<number, string>> {
  if (!ids.length) return {};
  const res = await db
    .request()
    .query(`SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID IN (${ids.join(',')})`)
    .catch(() => ({ recordset: [] as Array<{ EmpID: number; EmpName: string }> }));
  const map: Record<number, string> = {};
  for (const r of res.recordset) map[r.EmpID] = r.EmpName;
  return map;
}

async function loadDayOffSet(
  db: Awaited<ReturnType<typeof getPool>>,
  barberIds: number[],
  date: string,
  isToday: boolean,
): Promise<Set<number>> {
  const set = new Set<number>();
  const list = barberIds.join(',');
  try {
    const doRes = await db.request().input('offDate', sql.Date, date).query(`
      SELECT EmpID FROM dbo.TblEmpDayOff
      WHERE EmpID IN (${list}) AND OffDate = @offDate AND IsDeleted = 0
    `);
    for (const r of doRes.recordset) set.add(r.EmpID);
  } catch { /* optional table */ }

  if (isToday) {
    try {
      const attRes = await db.request().input('workDate', sql.Date, date).query(`
        SELECT EmpID FROM dbo.TblEmpAttendance
        WHERE EmpID IN (${list}) AND WorkDate = @workDate AND Status = 'Absent'
      `);
      for (const r of attRes.recordset) set.add(r.EmpID);
    } catch { /* optional table */ }
  }
  return set;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function msToCairoHhmm(ms: number): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms));
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${h}:${m}`;
  } catch {
    const d = new Date(ms);
    return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  }
}

function msToHhmm(ms: number, timezone: string, _dateStr: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms));
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    return `${h}:${m}`;
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

function formatArTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function formatSlotLabel(start: string, end: string): string {
  return `${formatArTime(start)} – ${formatArTime(end)}`;
}

/**
 * Canonical per-employee slot finder — wraps listAvailableBookingSlots for
 * operations drawer, APIs, and tests.
 */
export async function findAvailableSlotsForEmployee(args: {
  empId: number;
  operationalDate: string;
  serviceIds: number[];
  slotIntervalMinutes?: number;
  mode?: 'nearest' | 'specific';
  source?: 'public' | 'operations' | 'admin';
  limit?: number;
}) {
  const result = await listAvailableBookingSlots({
    date: args.operationalDate,
    serviceIds: args.serviceIds,
    mode: args.mode ?? 'specific',
    empId: args.empId,
    source: args.source ?? 'operations',
  });

  const slots = args.limit
    ? result.availableSlots.slice(0, args.limit)
    : result.availableSlots;

  if (process.env.NODE_ENV !== 'production' && args.source === 'operations') {
    console.log('[findAvailableSlotsForEmployee]', {
      empId: args.empId,
      date: args.operationalDate,
      serviceIds: args.serviceIds,
      durationMinutes: result.durationMinutes,
      busyBarbers: result.debug.barberCount,
      slotsAvailable: slots.length,
      firstSlot: slots[0]?.startAt ?? null,
    });
  }

  return {
    ...result,
    slots,
  };
}
