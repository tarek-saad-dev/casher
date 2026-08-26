/**
 * Canonical booking availability — shared by public booking, operations drawer,
 * check-slot, and create guard. Uses batched buildQueueIntervalsForEmps +
 * buildBookingIntervalsForEmps from queueEstimateEngine (same source as operations timeline).
 */

import { getPool, sql } from '@/lib/db';
import {
  getPublicSettings,
  getGlobalTimingDefaults,
  salonDateTimeToMs,
} from '@/lib/publicBookingHelpers';
import { listBookableEmployeeIdsForBranch, isEmployeeBookableAtBranch } from '@/lib/branch/bookingQueueOwnership';
import { BOOKING_SLOT_BARBER_JOBS_SQL_LIST } from '@/lib/availabilityEngine';
import {
  buildQueueIntervals,
  buildQueueIntervalsForEmps,
  buildBookingIntervalsForEmps,
  getDefaultDuration,
  type Interval,
} from '@/lib/queueEstimateEngine';
import { calculateServicePlanDuration, type ServicePlanDuration } from '@/lib/servicePlan';
import { resolveDurationTotalsByEmp } from '@/lib/empServiceDuration';
import {
  applyOverrides,
  slotBlockedByOverride,
  type EffectiveSchedule,
  type ScheduleOverride,
} from '@/lib/scheduleOverrides';
import { intervalsOverlap } from '@/lib/scheduleIntervals';
import { getCairoBusinessDate } from '@/lib/businessDate';
import { isMinNoticeNotMetMs } from '@/lib/booking/domain/minNoticeEligibility';
import { createStageTimer } from '@/lib/devStageTiming';
import { loadFreelanceBookingUnlocks } from '@/lib/hr/freelanceBookingUnlock';
import { loadBookingOverridesForDate } from '@/lib/hr/attendance-shift-schedule-sync';
import { loadWorkingWindowsBatch } from '@/lib/availability/loadWorkingWindowsBatch';
import {
  mapLegacySlotReason,
  inferDayDenyReason,
  type AvailabilityReasonCode,
  type EmployeeAvailabilityReason,
} from '@/lib/availability/reasonCodes';
import {
  resolveEmployeeDayPlansBatch,
  type DayPlanWindow,
} from '@/lib/availability/resolveEmployeeDayPlan';
import {
  findWindowContainingInterval,
  findContainingWindow,
  iterateWindowSlotStarts,
  normalizeEffectiveWindows,
  outerDisplayBounds,
} from '@/lib/availability/effectiveWindows';

export type BookingSlotReasonCode =
  | 'insufficient_continuous_time'
  | 'booking_conflict'
  | 'queue_conflict'
  | 'break'
  | 'daily_adjustment'
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
  /** Human-readable Arabic message (kept for existing clients). */
  noSlotsReason: string | null;
  /** Machine-readable reason when no available slots (Phase 1C). */
  reasonCode?: AvailabilityReasonCode | null;
  /** Per-employee deny/unavailable reasons when practical. */
  employeeReasons?: EmployeeAvailabilityReason[];
  debug: Record<string, unknown>;
}

export interface BookingSlotValidation {
  available: boolean;
  plan: BookingSlotPlan | null;
  nextAvailable: BookingSlotPlan | null;
  reasonCode?: BookingSlotReasonCode;
  reasonMessage?: string;
}

/** Soft historical caps — kept for helpers/tests; public available-slots no longer truncates. */
export const PUBLIC_AVAILABLE_SLOTS_LIMIT = 36;
/** Overnight soft cap (legacy); public path returns the full available set. */
export const PUBLIC_OVERNIGHT_SLOTS_LIMIT = 56;

/**
 * Cap public slot lists without dropping evening/base-shift times when
 * attendance early-expand opens many morning slots (those would otherwise
 * consume the entire limit via a naive slice(0, limit)).
 *
 * Prefer slots at/after the weekly base start (and overnight dayOffset=1),
 * then fill remaining quota with the latest early-expand slots.
 */
export function applyPublicAvailableSlotsLimit<
  T extends { time: string; dayOffset?: 0 | 1 },
>(slots: T[], limit: number, baseStartHhmm?: string | null): T[] {
  if (slots.length <= limit) return slots;
  if (!baseStartHhmm) return slots.slice(0, limit);

  const baseMin = hhmmToMinutes(baseStartHhmm);
  const inBaseWindow = (s: T) =>
    (s.dayOffset ?? 0) === 1 || hhmmToMinutes(s.time) >= baseMin;
  const core = slots.filter(inBaseWindow);
  const early = slots.filter((s) => !inBaseWindow(s));

  if (core.length >= limit) {
    // Prefer keeping post-midnight slots when the base window itself exceeds the cap.
    const overnight = core.filter((s) => (s.dayOffset ?? 0) === 1);
    const sameDay = core.filter((s) => (s.dayOffset ?? 0) === 0);
    if (overnight.length > 0 && overnight.length < limit) {
      return [...sameDay.slice(0, limit - overnight.length), ...overnight];
    }
    return core.slice(0, limit);
  }

  const remaining = limit - core.length;
  const earlyKeep = early.slice(Math.max(0, early.length - remaining));
  return [...earlyKeep, ...core];
}

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
  if (code === 'break' || code === 'daily_adjustment') return 'break';
  if (code === 'insufficient_continuous_time') return 'insufficient_duration';
  if (code === 'barber_unavailable') return 'barber_unavailable';
  return 'unknown';
}

export const BOOKING_SLOT_REASON_AR: Record<BookingSlotReasonCode, string> = {
  insufficient_continuous_time: 'المدة المطلوبة لا تتسع في هذه الفترة',
  booking_conflict: 'يوجد حجز في هذا الوقت',
  queue_conflict: 'يوجد دور نشط في هذا الوقت',
  break: 'فترة مغلقة أو استراحة',
  daily_adjustment: 'محظور بتعديل يومي',
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
  /** Weekly/base start before attendance early-expand (for public slot capping). */
  baseStart: string | null;
  /** Outer display bounds only — eligibility uses effectiveWindows. */
  shiftStartMs: number;
  shiftEndMs: number;
  dayOff: boolean;
  /** True when any effective window crosses midnight. */
  isOvernight: boolean;
  /** Phase 3C — all bookable windows for this operational date. */
  effectiveWindows: DayPlanWindow[];
};

async function buildBarberContexts(args: {
  date: string;
  serviceIds: number[];
  mode: 'nearest' | 'specific';
  empId?: number | null;
  source?: 'public' | 'operations' | 'admin';
  durationOverride?: number;
  /** Preloaded service plan — skips a second TblPro round-trip. */
  servicePlan?: ServicePlanDuration;
  /** Branch scoping: restricts visible barbers to branch-eligible employees. */
  branchId?: number | null;
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
  servicePlan: ServicePlanDuration | null;
  /** Candidate emp IDs before day-off / override filtering (for reason enrichment). */
  candidateEmpIds: number[];
}> {
  const timer = createStageTimer();
  const { date, serviceIds, mode, empId, source = 'public', durationOverride, servicePlan, branchId } = args;
  const settings = branchId != null ? await getPublicSettings(branchId) : await getGlobalTimingDefaults();
  timer.mark('settingsMs');
  const db = await getPool();
  timer.mark('poolMs');
  const timezone = settings.timezone || 'Africa/Cairo';
  const isInternalSource = source === 'operations' || source === 'admin';
  const effectiveMinNotice = isInternalSource ? 0 : settings.minNoticeMinutes;
  const now = new Date();
  const nowMs = now.getTime();
  const todayBusinessDate = getCairoBusinessDate(now);
  const isToday = date === todayBusinessDate;

  const systemDefault = settings.defaultServiceDurationMinutes || 30;
  const defaultDur = systemDefault || (await getDefaultDuration(db));
  let totalDuration = durationOverride ?? systemDefault;
  let durationSource: string = durationOverride ? 'OVERRIDE' : 'SYSTEM_DEFAULT';
  let resolvedPlan: ServicePlanDuration | null = servicePlan ?? null;

  // Catalog / specific-emp baseline (used when durationOverride not provided)
  if (!durationOverride && serviceIds.length > 0) {
    try {
      const planEmpId = mode === 'specific' && empId ? empId : null;
      resolvedPlan =
        servicePlan && (!planEmpId || servicePlan.empId === planEmpId)
          ? servicePlan
          : await calculateServicePlanDuration(serviceIds, { empId: planEmpId });
      totalDuration = resolvedPlan.totalDurationMinutes;
      durationSource = resolvedPlan.durationSource || 'SERVICE_SUM';
    } catch (err) {
      console.error('[bookingAvailability] calculateServicePlanDuration failed', { serviceIds, err });
      throw err;
    }
  }
  timer.mark('servicesMs');

  // Branch-first roster avoids loading every barber then filtering.
  let barberIds: number[];
  if (mode === 'specific' && empId) {
    // Specific: do NOT load the full branch roster — one cheap eligibility check.
    if (branchId != null) {
      const ok = await isEmployeeBookableAtBranch(empId, branchId, date, {
        publicOnly: source === 'public',
      });
      barberIds = ok ? [empId] : [];
    } else {
      barberIds = [empId];
    }
  } else if (branchId != null) {
    barberIds = await listBookableEmployeeIdsForBranch(branchId, date, {
      publicOnly: source === 'public',
    });
  } else {
    barberIds = await getAllBarberIds(db);
  }
  timer.mark('barbersMs');

  // Per-barber duration map (overrides differ by emp in nearest mode)
  let durationByEmp = new Map<number, number>();
  if (!durationOverride && serviceIds.length > 0 && barberIds.length > 0) {
    try {
      const { totals, sources, basePlan } = await resolveDurationTotalsByEmp({
        empIds: barberIds,
        serviceIds,
        systemDefaultMinutes: systemDefault,
      });
      durationByEmp = totals;
      if (!resolvedPlan) {
        resolvedPlan = {
          serviceIds: basePlan.serviceIds,
          totalDurationMinutes: basePlan.totalDurationMinutes,
          totalPrice: basePlan.totalPrice,
          durationSource: basePlan.durationSource === 'LEGACY_FALLBACK'
            ? 'LEGACY_FALLBACK'
            : basePlan.durationSource === 'EMPTY'
              ? 'EMPTY'
              : basePlan.durationSource === 'EMP_SERVICE_OVERRIDE' ||
                  basePlan.durationSource === 'MIXED' ||
                  basePlan.durationSource === 'SERVICE_DEFAULT' ||
                  basePlan.durationSource === 'SYSTEM_DEFAULT'
                ? basePlan.durationSource
                : 'SERVICE_SUM',
          services: basePlan.services.map((l) => ({
            serviceId: l.serviceId,
            serviceName: l.serviceName,
            durationMinutes: l.durationMinutes,
            price: l.price,
            sequence: l.sequence,
          })),
          empId: null,
        };
      }
      // Representational durationSource for the response envelope
      const sourceValues = [...sources.values()];
      if (sourceValues.some((s) => s === 'EMP_SERVICE_OVERRIDE' || s === 'MIXED')) {
        durationSource = sourceValues.every((s) => s === 'EMP_SERVICE_OVERRIDE')
          ? 'EMP_SERVICE_OVERRIDE'
          : 'MIXED';
      }
      if (mode === 'specific' && empId && durationByEmp.has(empId)) {
        totalDuration = durationByEmp.get(empId)!;
      }
    } catch (err) {
      console.warn('[bookingAvailability] emp duration resolve failed; using catalog plan', err);
      for (const id of barberIds) durationByEmp.set(id, totalDuration);
    }
  } else if (durationOverride) {
    for (const id of barberIds) durationByEmp.set(id, durationOverride);
  } else {
    for (const id of barberIds) durationByEmp.set(id, totalDuration);
  }
  timer.mark('empDurationsMs');

  const contexts: BarberCtx[] = [];
  if (barberIds.length) {
    const dayOfWeek = new Date(`${date}T12:00:00Z`).getDay();
    // loadDayOffSet already includes Absent for the requested work date (any day).
    const [nameMap, dayOffSet, overridesMap, windowsMap, freelanceUnlocks] = await Promise.all([
      getBarberNames(db, barberIds),
      loadDayOffSet(db, barberIds, date),
      loadBookingOverridesForDate(db, barberIds, date),
      loadWorkingWindowsBatch(db, barberIds, dayOfWeek, {
        branchId: branchId ?? undefined,
        workDate: date,
      }),
      loadFreelanceBookingUnlocks(barberIds, date),
    ]);
    timer.mark('staticBatchMs');

    // Merge freelance attendance unlock into weekly windows (day-off / absent still exclude)
    for (const [id, unlock] of freelanceUnlocks) {
      if (dayOffSet.has(id)) continue;
      const existing = windowsMap.get(id);
      if (!existing?.isWorkingDay) {
        windowsMap.set(id, {
          isWorkingDay: true,
          startTime: unlock.start,
          endTime: unlock.end,
        });
      }
    }

    const eligible = barberIds.filter((id) => !dayOffSet.has(id));

    type PendingBarber = {
      empId: number;
      empName: string;
      durationMinutes: number;
      effSched: EffectiveSchedule;
      baseStart: string | null;
      shiftStartMs: number;
      shiftEndMs: number;
      isOvernight: boolean;
    };
    const pending: PendingBarber[] = [];

    for (const id of eligible) {
      const baseWindow = windowsMap.get(id) ?? {
        isWorkingDay: false,
        startTime: null,
        endTime: null,
      };
      const base =
        baseWindow.isWorkingDay && baseWindow.startTime && baseWindow.endTime
          ? { isWorking: true, start: baseWindow.startTime, end: baseWindow.endTime }
          : { isWorking: false, start: '00:00', end: '00:00' };

      const effSched = applyOverrides(id, date, base, overridesMap.get(id) ?? []);
      if (!effSched.isWorking) continue;

      // Preserve overnight from the BASE schedule. Early attendance expand can move
      // start earlier (e.g. 11:30) while end stays 01:00 — still overnight.
      // Never let a collapsed same-day read drop the post-midnight shift end.
      const baseOvernight =
        base.isWorking && hhmmToMinutes(base.end) <= hhmmToMinutes(base.start);
      const effOvernight =
        hhmmToMinutes(effSched.end) <= hhmmToMinutes(effSched.start);
      const isOvernight = baseOvernight || effOvernight;

      const shiftStartMs = salonDateTimeToMs(date, effSched.start, timezone);
      const shiftEndMs = isOvernight
        ? salonDateTimeToMs(nextDate(date), effSched.end, timezone)
        : salonDateTimeToMs(date, effSched.end, timezone);

      pending.push({
        empId: id,
        empName: nameMap[id] ?? '',
        durationMinutes: durationByEmp.get(id) ?? totalDuration,
        effSched,
        baseStart: base.isWorking ? base.start : null,
        shiftStartMs,
        shiftEndMs,
        isOvernight,
      });
    }

    const pendingIds = pending.map((p) => p.empId);
    const overnightIds = pending.filter((p) => p.isOvernight).map((p) => p.empId);
    const nextDayStr = overnightIds.length ? nextDate(date) : null;
    const emptyBusy = new Map<number, Interval[]>();
    // Future public days have no live queue — skip those round-trips (calendar fan-out).
    const loadQueue = !(source === 'public' && date > todayBusinessDate);

    const failHardBusy = source === 'public';
    const [qToday, bToday, qNext, bNext] = await Promise.all([
      loadQueue
        ? buildQueueIntervalsForEmps(db, pendingIds, date, now, defaultDur, {
            filterStale: true,
            graceMinutes: 30,
            debugContext: 'booking-availability',
            failHard: failHardBusy,
          })
        : Promise.resolve(emptyBusy),
      buildBookingIntervalsForEmps(db, pendingIds, date, defaultDur, {
        failHard: failHardBusy,
      }),
      loadQueue && nextDayStr
        ? buildQueueIntervalsForEmps(db, overnightIds, nextDayStr, now, defaultDur, {
            filterStale: true,
            graceMinutes: 30,
            debugContext: 'booking-availability-next-day',
            failHard: failHardBusy,
          })
        : Promise.resolve(emptyBusy),
      nextDayStr
        ? buildBookingIntervalsForEmps(db, overnightIds, nextDayStr, defaultDur, {
            failHard: failHardBusy,
          })
        : Promise.resolve(emptyBusy),
    ]);

    for (const p of pending) {
      const inShiftWindow = (iv: Interval) =>
        iv.start.getTime() < p.shiftEndMs && iv.end.getTime() > p.shiftStartMs;
      const nextDayBusy = p.isOvernight
        ? [...(qNext.get(p.empId) ?? []), ...(bNext.get(p.empId) ?? [])].filter(inShiftWindow)
        : [];
      contexts.push({
        empId: p.empId,
        empName: p.empName,
        durationMinutes: p.durationMinutes,
        busy: [...(qToday.get(p.empId) ?? []), ...(bToday.get(p.empId) ?? []), ...nextDayBusy],
        effSched: p.effSched,
        baseStart: p.baseStart,
        shiftStartMs: p.shiftStartMs,
        shiftEndMs: p.shiftEndMs,
        dayOff: false,
        isOvernight: p.isOvernight,
        // Populated from canonical day plan immediately after (Phase 3C).
        effectiveWindows: [
          {
            start: p.effSched.start,
            end: p.effSched.end,
            endDayOffset: p.isOvernight ? 1 : 0,
            startMs: p.shiftStartMs,
            endMs: p.shiftEndMs,
          },
        ],
      });
    }
    timer.mark('busyParallelMs');
  }

  // Phase 3C — canonical day plan is authoritative over legacy weekly+override
  // windows. CLOSE_DAY / empty windows must drop the barber (otherwise public
  // slots/check/plan stay open while assertEmployeeIntervalAvailable 409s).
  if (contexts.length > 0) {
    const plans = await resolveEmployeeDayPlansBatch({
      empIds: contexts.map((c) => c.empId),
      businessDate: date,
      branchId: branchId ?? null,
      source: source === 'public' ? 'public' : 'operations',
    });
    const deniedEmpIds = new Set<number>();
    for (const ctx of contexts) {
      const plan = plans.get(ctx.empId);
      if (!plan) continue;
      if (!plan.isWorking || !plan.effSched) {
        deniedEmpIds.add(ctx.empId);
        continue;
      }
      const windows = normalizeEffectiveWindows(plan.effectiveWindows);
      if (!windows.length) {
        deniedEmpIds.add(ctx.empId);
        continue;
      }
      ctx.effectiveWindows = windows;
      ctx.effSched = plan.effSched;
      const outer = outerDisplayBounds(windows)!;
      ctx.shiftStartMs = outer.startMs;
      ctx.shiftEndMs = outer.endMs;
      ctx.isOvernight =
        plan.isOvernight || windows.some((w) => w.endDayOffset === 1);
    }
    if (deniedEmpIds.size > 0) {
      for (let i = contexts.length - 1; i >= 0; i--) {
        if (deniedEmpIds.has(contexts[i].empId)) contexts.splice(i, 1);
      }
    }
  }

  // Public reads must see active holds — write guard already does; mismatch → SLOT_UNAVAILABLE.
  // Batch one SQL round-trip for all context empIds (EmpID is global across branches).
  if (source === 'public' && contexts.length > 0) {
    try {
      const {
        listActiveBookingHoldsForEmployees,
        filterActiveHoldsForEmployeeRange,
      } = await import('@/lib/booking/bookingHold');
      const empIds = contexts.map((c) => c.empId);
      const rangeStartMs = Math.min(...contexts.map((c) => c.shiftStartMs));
      const rangeEndMs = Math.max(...contexts.map((c) => c.shiftEndMs));
      const allHolds = await listActiveBookingHoldsForEmployees({
        empIds,
        rangeStart: new Date(rangeStartMs),
        rangeEnd: new Date(rangeEndMs),
      });
      for (const ctx of contexts) {
        const holds = filterActiveHoldsForEmployeeRange(allHolds, {
          empId: ctx.empId,
          rangeStart: new Date(ctx.shiftStartMs),
          rangeEnd: new Date(ctx.shiftEndMs),
        });
        for (const h of holds) {
          ctx.busy.push({
            id: -(100_000 + h.holdId),
            source: 'booking',
            start: h.startAt,
            end: h.endAt,
            label: 'HOLD_CONFLICT',
          });
        }
      }
    } catch {
      /* hold table optional until ensured */
    }
  }

  timer.finish('[buildBarberContexts perf]', {
    mode,
    barberCount: barberIds.length,
    contextCount: contexts.length,
  });

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
    servicePlan: resolvedPlan,
    candidateEmpIds: barberIds,
  };
}

/** Half-open [start, end) conflict test against busy intervals. */
export function evaluateBookingSlotAt(
  slotStartMs: number,
  durationMinutes: number,
  busyIntervals: Array<{ start: Date; end: Date; source?: string }>,
  options?: {
    /** @deprecated Outer bounds only — prefer effectiveWindows for multi-window. */
    shiftStartMs?: number;
    /** @deprecated Outer bounds only — prefer effectiveWindows for multi-window. */
    shiftEndMs?: number;
    /** Phase 3C — when set, interval must fit entirely inside one window. */
    effectiveWindows?: DayPlanWindow[] | null;
    nowMs?: number;
    minNoticeMs?: number;
    overrideBlock?: boolean;
    /** Raw block reason from effSched (may be tagged `daily_adjustment:…`). */
    overrideBlockReason?: string | null;
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
    effectiveWindows,
    nowMs,
    minNoticeMs = 0,
    overrideBlock = false,
    overrideBlockReason = null,
  } = options ?? {};

  if (nowMs != null && slotStartMs <= nowMs) {
    return { available: false, slotEndMs, reasonCode: 'past' };
  }
  if (
    nowMs != null &&
    isMinNoticeNotMetMs({
      startAtMs: slotStartMs,
      nowMs,
      minNoticeMs,
    })
  ) {
    return { available: false, slotEndMs, reasonCode: 'minimum_notice' };
  }

  const windows = effectiveWindows?.length
    ? normalizeEffectiveWindows(effectiveWindows)
    : null;
  if (windows) {
    const containing = findWindowContainingInterval({
      windows,
      startMs: slotStartMs,
      endMs: slotEndMs,
    });
    if (!containing) {
      const pointWin = findContainingWindow(windows, slotStartMs);
      if (pointWin && slotEndMs > pointWin.endMs) {
        return { available: false, slotEndMs, reasonCode: 'insufficient_continuous_time' };
      }
      return { available: false, slotEndMs, reasonCode: 'outside_working_hours' };
    }
  } else {
    if (shiftStartMs != null && slotStartMs < shiftStartMs) {
      return { available: false, slotEndMs, reasonCode: 'outside_working_hours' };
    }
    if (shiftEndMs != null && slotEndMs > shiftEndMs) {
      return { available: false, slotEndMs, reasonCode: 'insufficient_continuous_time' };
    }
  }

  if (overrideBlock || overrideBlockReason) {
    const tagged =
      typeof overrideBlockReason === 'string' &&
      overrideBlockReason.startsWith('daily_adjustment');
    return {
      available: false,
      slotEndMs,
      reasonCode: tagged ? 'daily_adjustment' : 'break',
    };
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
  /** Branch scoping: restricts visible barbers to branch-eligible employees. */
  branchId?: number | null;
  /**
   * When set, every barber uses this duration (Phase 4 public catalog sum).
   * Skips emp-override / system-default duration resolution.
   */
  durationOverride?: number;
  /**
   * Nearest/any-barber: include every available barber at each time
   * (merged later by public wrapper). Specific mode ignores this.
   */
  collectAllCandidates?: boolean;
  /**
   * Stop after this many available slot times (calendar/summary path).
   * Skips full-day grid evaluation once enough free slots are found.
   */
  maxAvailableSlots?: number;
}): Promise<ListAvailableBookingSlotsResult> {
  const {
    date,
    serviceIds,
    mode,
    empId,
    source = 'public',
    branchId,
    durationOverride,
    collectAllCandidates,
    maxAvailableSlots,
  } = args;
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
    candidateEmpIds,
  } = await buildBarberContexts({
    date,
    serviceIds,
    mode,
    empId,
    source,
    branchId,
    durationOverride,
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
    const starts = iterateWindowSlotStarts({
      windows: ctx.effectiveWindows,
      durationMinutes: totalDuration,
      intervalMinutes: slotIntervalMinutes,
    });
    for (const slot of starts) {
      const entry = absoluteMsToSlotEntry(slot.startMs, date, timezone);
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
    collectAllCandidates: !!collectAllCandidates && mode !== 'specific',
    maxAvailableSlots:
      maxAvailableSlots != null && maxAvailableSlots > 0 ? maxAvailableSlots : undefined,
  });

  const availableSlotsUnlimited = allPlans.filter((s: BookingSlotPlan) => s.available);
  const validSlotCountBeforeLimit = collectAllCandidates
    ? new Set(availableSlotsUnlimited.map((s) => `${s.dayOffset}|${s.time}`)).size
    : availableSlotsUnlimited.length;
  const isInternalSource = source === 'operations' || source === 'admin';
  // Public clients need every bookable start (e.g. 12:00→23:00 shift) — do not truncate.
  const limitApplied = false;
  const availableSlots = availableSlotsUnlimited;
  const primaryCtx =
    (mode === 'specific' && empId ? contexts.find((c) => c.empId === empId) : null)
    ?? contexts[0]
    ?? null;
  const returnedSlotCount = collectAllCandidates
    ? new Set(availableSlots.map((s) => `${s.dayOffset}|${s.time}`)).size
    : availableSlots.length;
  const nextAvailable = availableSlots[0] ?? null;

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

  let alternativeBarbers: BarberAlternative[] = [];
  // Public clients do not consume alternatives — skip the O(barbers×slots) scan.
  if (
    source !== 'public' &&
    mode === 'specific' &&
    empId &&
    availableSlots.length === 0 &&
    !(maxAvailableSlots != null && maxAvailableSlots > 0)
  ) {
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
  let reasonCode: AvailabilityReasonCode | null = null;
  const employeeReasons: EmployeeAvailabilityReason[] = [];

  if (availableSlots.length === 0) {
    const barberName = mode === 'specific' && empId ? nameMap[empId] ?? 'الحلاق' : null;
    const reasonEmpIds =
      candidateEmpIds.length > 0
        ? candidateEmpIds
        : mode === 'specific' && empId
          ? [empId]
          : [...new Set(allPlans.map((p) => p.empId))];

    // Public path: skip second day-plan batch — use in-memory rejections only.
    const dayPlans =
      source === 'public' || reasonEmpIds.length === 0
        ? new Map()
        : await resolveEmployeeDayPlansBatch({
            empIds: reasonEmpIds,
            businessDate: date,
            branchId: branchId ?? null,
            source: 'operations',
          });

    const DAY_DENY_PRECEDENCE: AvailabilityReasonCode[] = [
      'EMPLOYEE_INACTIVE',
      'NOT_ASSIGNED_TO_BRANCH',
      'EMPLOYEE_ABSENT',
      'DAY_CLOSED_BY_ADJUSTMENT',
      'NO_USABLE_WINDOW_AFTER_ADJUSTMENTS',
      'EMPLOYEE_OFF_DAY',
      'FREELANCER_NOT_PLANNED',
      'SCHEDULE_NOT_CONFIGURED',
      'OUTSIDE_WORKING_WINDOW',
      'BLOCKED_BY_DAILY_ADJUSTMENT',
      'BLOCKED_BY_OVERRIDE',
    ];

    const byEmp = new Map<number, AvailabilityReasonCode>();
    for (const id of reasonEmpIds) {
      const plan = dayPlans.get(id);
      if (plan && !plan.isWorking && plan.denyReasonCode) {
        byEmp.set(id, plan.denyReasonCode);
        continue;
      }
      // Working day but no slots — prefer slot rejection reasons
      const samplePlan = allPlans.find((p) => p.empId === id && p.reasonCode && !p.available);
      const mapped = mapLegacySlotReason(samplePlan?.reasonCode);
      if (mapped) byEmp.set(id, mapped);
    }

    for (const [id, code] of byEmp) {
      const samplePlan = allPlans.find((p) => p.empId === id && p.reasonCode);
      employeeReasons.push({
        empId: id,
        reasonCode: code,
        message: samplePlan?.reasonMessage,
      });
    }

    if (contexts.length === 0) {
      noSlotsReason = 'جميع الموظفين في إجازة أو بدون جدول عمل';
      const firstDeny = [...byEmp.values()].sort(
        (a, b) => DAY_DENY_PRECEDENCE.indexOf(a) - DAY_DENY_PRECEDENCE.indexOf(b),
      )[0];
      reasonCode =
        firstDeny
        ?? inferDayDenyReason({
          contextsEmpty: true,
          specificEmp: mode === 'specific' && !!empId,
        });
      if (mode === 'specific' && empId && !byEmp.has(empId)) {
        employeeReasons.push({ empId, reasonCode: reasonCode });
      }
    } else if (barberName) {
      noSlotsReason = `لا توجد فترة متصلة مدتها ${totalDuration} دقيقة متاحة مع ${barberName} في هذا اليوم.`;
      const empDeny = empId != null ? byEmp.get(empId) : undefined;
      const samplePlan = allPlans.find((p) => p.empId === empId && p.reasonCode);
      const mapped = mapLegacySlotReason(samplePlan?.reasonCode);
      // Prefer day-plan deny over generic envelope when the employee has no usable day
      reasonCode =
        (empDeny && DAY_DENY_PRECEDENCE.includes(empDeny) ? empDeny : undefined)
        ?? mapped
        ?? 'NO_CONTIGUOUS_WINDOW';
    } else {
      noSlotsReason = `لا توجد فترة متصلة مدتها ${totalDuration} دقيقة متاحة في هذا اليوم.`;
      const distinct = [...new Set(byEmp.values())];
      const preferredDeny = distinct
        .filter((c) => DAY_DENY_PRECEDENCE.includes(c))
        .sort((a, b) => DAY_DENY_PRECEDENCE.indexOf(a) - DAY_DENY_PRECEDENCE.indexOf(b))[0];
      reasonCode =
        preferredDeny
        ?? (distinct.length === 1 ? distinct[0] : 'NO_EMPLOYEE_AVAILABLE');
      // Prefer day-plan deny over generic NO_EMPLOYEE_AVAILABLE / SLOT_UNAVAILABLE
      if (
        (reasonCode === 'NO_EMPLOYEE_AVAILABLE' || reasonCode === 'SLOT_UNAVAILABLE')
        && preferredDeny
      ) {
        reasonCode = preferredDeny;
      }
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
    reasonCode,
    employeeReasons: employeeReasons.length ? employeeReasons : undefined,
    debug: {
      serviceIds,
      totalDurationMinutes: totalDuration,
      isToday,
      isInternalSource,
      effectiveMinNotice,
      barberCount: contexts.length,
      candidateEmpIds,
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
  collectAllCandidates?: boolean;
  /** Stop once this many available plans (or unique times) are found. */
  maxAvailableSlots?: number;
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
    collectAllCandidates,
    maxAvailableSlots,
  } = args;
  const allPlans: BookingSlotPlan[] = [];
  const availableTimeKeys = new Set<string>();

  const recordRejection = (plan: BookingSlotPlan | null) => {
    if (!rejectionCounts || !plan || plan.available) return;
    const bucket = mapReasonToBucket(plan.reasonCode);
    rejectionCounts[bucket] += 1;
  };

  const hitCap = () =>
    maxAvailableSlots != null &&
    maxAvailableSlots > 0 &&
    availableTimeKeys.size >= maxAvailableSlots;

  for (const [time, dayOffset] of sortedSlotTimes) {
    if (hitCap()) break;

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
      if (plan) {
        allPlans.push(plan);
        if (plan.available) availableTimeKeys.add(`${dayOffset}|${time}`);
      }
    } else if (collectAllCandidates) {
      let anyAvailable = false;
      for (const ctx of contexts) {
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
          allPlans.push(plan);
          anyAvailable = true;
        }
      }
      if (anyAvailable) availableTimeKeys.add(`${dayOffset}|${time}`);
      if (!anyAvailable && rejectionCounts && contexts[0]) {
        const probe = evaluateBarberSlot({
          ctx: contexts[0],
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
      if (best) {
        allPlans.push(best);
        if (best.available) availableTimeKeys.add(`${dayOffset}|${time}`);
      }
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
  /** Preloaded services — avoids duplicate TblPro query. */
  servicePlan?: ServicePlanDuration;
  /**
   * When true and the requested slot is available, skip the expensive next-slot grid.
   * Create path uses this; conflict handlers can compute nextAvailable separately.
   */
  skipNextAvailableWhenOk?: boolean;
  /** Branch scoping: restricts visible barbers to branch-eligible employees. */
  branchId?: number | null;
}): Promise<BookingSlotValidation> {
  const {
    date,
    time,
    dayOffset = 0,
    serviceIds,
    durationOverride,
    mode,
    empId,
    source = 'public',
    servicePlan,
    skipNextAvailableWhenOk = false,
    branchId,
  } = args;

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
    servicePlan,
    branchId,
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

  const skipNext =
    skipNextAvailableWhenOk && !!plan?.available;

  if (!skipNext) {
    const slotInterval = settings.slotIntervalMinutes || 15;
    const slotTimes: Array<[string, 0 | 1]> = [];
    for (const ctx of contexts) {
      if (!ctx.effSched) continue;
      const starts = iterateWindowSlotStarts({
        windows: ctx.effectiveWindows,
        durationMinutes: ctx.durationMinutes,
        intervalMinutes: slotInterval,
      });
      for (const slot of starts) {
        const entry = absoluteMsToSlotEntry(slot.startMs, date, timezone);
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
    effectiveWindows?: DayPlanWindow[];
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
  const overrideBlockReason = ctx.effSched
    ? slotBlockedByOverride(
        slotStartMs,
        slotStartMs + ctx.durationMinutes * 60_000,
        ctx.effSched,
      )
    : null;

  const evalResult = evaluateBookingSlotAt(slotStartMs, ctx.durationMinutes, ctx.busy, {
    shiftStartMs: ctx.shiftStartMs,
    shiftEndMs: ctx.shiftEndMs,
    effectiveWindows: ctx.effectiveWindows,
    nowMs: isToday ? nowMs : undefined,
    minNoticeMs: isToday ? minNoticeMs : 0,
    overrideBlock: !!overrideBlockReason,
    overrideBlockReason,
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
  reasonCode: AvailabilityReasonCode = 'SLOT_UNAVAILABLE',
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
    reasonCode,
    employeeReasons: args.empId
      ? [{ empId: args.empId, reasonCode }]
      : undefined,
    debug: {},
  };
}

function generateSlotEntries(
  start: string,
  end: string,
  intervalMin: number,
  minDurationMinutes = 0,
  forceOvernight = false,
): Array<{ time: string; dayOffset: 0 | 1 }> {
  const entries: Array<{ time: string; dayOffset: 0 | 1 }> = [];
  const startMin = hhmmToMinutes(start);
  const endMin = hhmmToMinutes(end);
  const overnight = forceOvernight || endMin <= startMin;
  const endTotal = overnight ? endMin + 24 * 60 : endMin;
  const lastStartInclusive = minDurationMinutes > 0
    ? endTotal - minDurationMinutes
    : endTotal - intervalMin;
  let cur = startMin;
  // If forceOvernight but start is after midnight portion (start < end on clock
  // while base was overnight), still walk from start through next-day end.
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
      WHERE ISNULL(isActive,1)=1 AND Job IN (${BOOKING_SLOT_BARBER_JOBS_SQL_LIST})
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

  try {
    const attRes = await db.request().input('workDate', sql.Date, date).query(`
      SELECT EmpID FROM dbo.TblEmpAttendance
      WHERE EmpID IN (${list}) AND WorkDate = @workDate AND Status = N'Absent'
    `);
    for (const r of attRes.recordset) set.add(r.EmpID);
  } catch { /* optional table */ }
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

/** Convert absolute slot start to HH:MM + dayOffset relative to business date. */
function absoluteMsToSlotEntry(
  ms: number,
  businessDate: string,
  timezone: string,
): { time: string; dayOffset: 0 | 1 } {
  const time = (() => {
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
      return msToCairoHhmm(ms);
    }
  })();
  let ymd = businessDate;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms));
    const y = parts.find((p) => p.type === 'year')?.value;
    const mo = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && mo && d) ymd = `${y}-${mo}-${d}`;
  } catch {
    /* keep businessDate */
  }
  const dayOffset: 0 | 1 = ymd > businessDate ? 1 : 0;
  return { time, dayOffset };
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
  /** Branch scoping: restricts visible barbers to branch-eligible employees. */
  branchId?: number | null;
}) {
  const result = await listAvailableBookingSlots({
    date: args.operationalDate,
    serviceIds: args.serviceIds,
    mode: args.mode ?? 'specific',
    empId: args.empId,
    source: args.source ?? 'operations',
    branchId: args.branchId,
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

/**
 * Phase 10C — specific emp × one branch × many dates (batched, low round-trips).
 */
export async function listSpecificEmpPublicSlotsMultiDate(args: {
  empId: number;
  branchId: number;
  dates: string[];
  serviceIds: number[];
  durationOverride: number;
  /** Caller already filtered bookable assignment days — skip per-date eligibility SQL. */
  assumeEligible?: boolean;
}): Promise<Map<string, BookingSlotPlan[]>> {
  const out = new Map<string, BookingSlotPlan[]>();
  const dates = [...new Set(args.dates)].filter(Boolean).sort();
  if (!dates.length) return out;

  const settings = await getPublicSettings(args.branchId);
  const db = await getPool();
  const timezone = settings.timezone || 'Africa/Cairo';
  const effectiveMinNotice = settings.minNoticeMinutes;
  const slotIntervalMinutes = settings.slotIntervalMinutes || 15;
  const totalDuration = args.durationOverride;
  const now = new Date();
  const nowMs = now.getTime();
  const todayBusinessDate = getCairoBusinessDate(now);
  const defaultDur = settings.defaultServiceDurationMinutes || 30;

  let workDates = dates.filter((d) => d >= todayBusinessDate);
  if (!args.assumeEligible) {
    const eligibleByDate = await Promise.all(
      workDates.map(async (date) => {
        const ids = await listBookableEmployeeIdsForBranch(args.branchId, date, {
          publicOnly: true,
        });
        return { date, ok: ids.includes(args.empId) };
      }),
    );
    workDates = eligibleByDate.filter((d) => d.ok).map((d) => d.date);
  }
  for (const d of dates) {
    if (!workDates.includes(d)) out.set(d, []);
  }
  if (!workDates.length) return out;

  const dateFrom = workDates[0];
  const dateTo = workDates[workDates.length - 1];
  const dateToPlus1 = nextDate(dateTo);

  const fmtWin = (v: unknown): string | null => {
    if (!v) return null;
    if (typeof v === 'string') return v.slice(0, 5);
    if (v instanceof Date) {
      return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
    }
    return null;
  };

  const [
    nameMap,
    dayOffRows,
    weeklyByDow,
    transfers,
    rawOverridesByDate,
    todayOverrides,
    bookingBusyByDate,
    queueBusyToday,
    queueBusyTomorrow,
  ] = await Promise.all([
    getBarberNames(db, [args.empId]),
    (async () => {
      const set = new Set<string>();
      try {
        const r = await db
          .request()
          .input('empId', sql.Int, args.empId)
          .input('from', sql.Date, dateFrom)
          .input('to', sql.Date, dateTo)
          .query(`
            SELECT CONVERT(VARCHAR(10), OffDate, 120) AS OffDate
            FROM dbo.TblEmpDayOff
            WHERE EmpID = @empId AND OffDate >= @from AND OffDate <= @to AND IsDeleted = 0
          `);
        for (const row of r.recordset) set.add(String(row.OffDate).slice(0, 10));
      } catch {
        /* optional */
      }
      // Absent on any date in the horizon blocks that date (not only business-today).
      try {
        const a = await db
          .request()
          .input('empId', sql.Int, args.empId)
          .input('from', sql.Date, dateFrom)
          .input('to', sql.Date, dateTo)
          .query(`
            SELECT CONVERT(VARCHAR(10), WorkDate, 120) AS WorkDate
            FROM dbo.TblEmpAttendance
            WHERE EmpID = @empId
              AND WorkDate >= @from AND WorkDate <= @to
              AND Status = N'Absent'
          `);
        for (const row of a.recordset) set.add(String(row.WorkDate).slice(0, 10));
      } catch {
        /* optional */
      }
      return set;
    })(),
    (async () => {
      const map = new Map<
        number,
        { startTime: string | null; endTime: string | null; isWorkingDay: boolean }
      >();
      try {
        const r = await db
          .request()
          .input('empId', sql.Int, args.empId)
          .input('branchId', sql.Int, args.branchId)
          .input('from', sql.Date, dateFrom)
          .input('to', sql.Date, dateTo)
          .query(`
            SELECT DayOfWeek, IsWorking, StartTime, EndTime,
              ROW_NUMBER() OVER (
                PARTITION BY DayOfWeek ORDER BY EffectiveFrom DESC, ScheduleID DESC
              ) AS rn
            FROM dbo.TblEmpBranchWorkSchedule
            WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
              AND EffectiveFrom <= @to
              AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
          `);
        for (const row of r.recordset) {
          if (Number(row.rn) !== 1) continue;
          map.set(Number(row.DayOfWeek), {
            isWorkingDay: !!row.IsWorking,
            startTime: fmtWin(row.StartTime),
            endTime: fmtWin(row.EndTime),
          });
        }
      } catch {
        /* optional */
      }
      return map;
    })(),
    (async () => {
      type Xfer = {
        workDate: string;
        toBranchId: number;
        fromBranchId: number;
        startTime: string | null;
        endTime: string | null;
      };
      const list: Xfer[] = [];
      try {
        const r = await db
          .request()
          .input('empId', sql.Int, args.empId)
          .input('from', sql.Date, dateFrom)
          .input('to', sql.Date, dateTo)
          .query(`
            SELECT ToBranchID, FromBranchID, WorkDate, StartTime, EndTime
            FROM dbo.TblEmpTemporaryBranchTransfer
            WHERE EmpID = @empId AND IsActive = 1
              AND WorkDate >= @from AND WorkDate <= @to
          `);
        for (const row of r.recordset) {
          list.push({
            workDate: String(row.WorkDate instanceof Date
              ? row.WorkDate.toISOString().slice(0, 10)
              : row.WorkDate).slice(0, 10),
            toBranchId: Number(row.ToBranchID),
            fromBranchId: Number(row.FromBranchID),
            startTime: fmtWin(row.StartTime),
            endTime: fmtWin(row.EndTime),
          });
        }
      } catch {
        /* optional */
      }
      return list;
    })(),
    (async () => {
      const map = new Map<string, ScheduleOverride[]>();
      for (const d of workDates) map.set(d, []);
      try {
        const { ensureOverridesTable } = await import('@/lib/scheduleOverrides');
        await ensureOverridesTable(db);
        const r = await db
          .request()
          .input('empId', sql.Int, args.empId)
          .input('from', sql.Date, dateFrom)
          .input('to', sql.Date, dateTo)
          .query(`
            SELECT
              OverrideID, EmpID, CONVERT(VARCHAR(10), OverrideDate, 120) AS OverrideDate,
              Type,
              CASE WHEN StartTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), StartTime, 108), 5) ELSE NULL END AS StartTime,
              CASE WHEN EndTime IS NOT NULL THEN LEFT(CONVERT(VARCHAR(8), EndTime, 108), 5) ELSE NULL END AS EndTime,
              Reason, IsActive,
              CONVERT(VARCHAR(30), CreatedAt, 126) AS CreatedAt,
              CreatedBy
            FROM dbo.TblEmpScheduleOverrides
            WHERE EmpID = @empId AND OverrideDate >= @from AND OverrideDate <= @to AND IsActive = 1
            ORDER BY OverrideDate, OverrideID
          `);
        for (const row of r.recordset) {
          const d = String(row.OverrideDate).slice(0, 10);
          const list = map.get(d) ?? [];
          list.push(row as ScheduleOverride);
          map.set(d, list);
        }
      } catch {
        /* optional */
      }
      return map;
    })(),
    workDates.includes(todayBusinessDate)
      ? loadBookingOverridesForDate(db, [args.empId], todayBusinessDate)
      : Promise.resolve(new Map<number, ScheduleOverride[]>()),
    (async () => {
      const map = new Map<string, Interval[]>();
      for (const d of [...workDates, dateToPlus1]) map.set(d, []);
      const statusList = (
        await import('@/lib/scheduleIntervals')
      ).ACTIVE_BOOKING_BLOCK_STATUSES.map((s) => `'${s}'`).join(',');
      const { normalizeBookingTimes } = await import('@/lib/bookingDateTime');
      try {
        const r = await db
          .request()
          .input('empId', sql.Int, args.empId)
          .input('from', sql.Date, dateFrom)
          .input('to', sql.Date, dateToPlus1)
          .query(`
            SELECT
              b.BookingID,
              CONVERT(VARCHAR(10), b.BookingDate, 120) AS BookingDate,
              b.StartTime,
              b.EndTime,
              ISNULL((
                SELECT SUM(bs.DurationMinutes)
                FROM [dbo].[BookingServices] bs
                WHERE bs.BookingID = b.BookingID
              ), 0) AS TotalDuration
            FROM [dbo].[Bookings] b
            WHERE b.AssignedEmpID = @empId
              AND b.BookingDate >= @from
              AND b.BookingDate <= @to
              AND LOWER(b.Status) IN (${statusList})
            ORDER BY b.BookingDate, b.StartTime
          `);
        for (const b of r.recordset) {
          const d = String(b.BookingDate).slice(0, 10);
          const totalDurationRow =
            Number(b.TotalDuration) > 0 ? Number(b.TotalDuration) : defaultDur;
          const normalized = normalizeBookingTimes(
            b.BookingDate ?? d,
            b.StartTime,
            b.EndTime,
            totalDurationRow,
            b.BookingID,
          );
          const list = map.get(d) ?? [];
          list.push({
            start: new Date(normalized.startDateTimeCairo),
            end: new Date(normalized.endDateTimeCairo),
            source: 'booking' as const,
            id: b.BookingID as number,
          });
          map.set(d, list);
        }
      } catch {
        /* fall back empty */
      }
      return map;
    })(),
    workDates.includes(todayBusinessDate)
      ? buildQueueIntervals(db, args.empId, todayBusinessDate, now, defaultDur, undefined, {
          filterStale: true,
          graceMinutes: 30,
          debugContext: 'xbranch-availability',
        })
      : Promise.resolve([] as Interval[]),
    workDates.includes(todayBusinessDate)
      ? buildQueueIntervals(db, args.empId, nextDate(todayBusinessDate), now, defaultDur, undefined, {
          filterStale: true,
          graceMinutes: 30,
          debugContext: 'xbranch-availability-next',
        })
      : Promise.resolve([] as Interval[]),
  ]);

  const empName = nameMap[args.empId] ?? '';
  const tomorrow = nextDate(todayBusinessDate);

  for (const date of workDates) {
    if (dayOffRows.has(date)) {
      out.set(date, []);
      continue;
    }

    const dow = new Date(`${date}T12:00:00Z`).getDay();
    let baseWindow = weeklyByDow.get(dow) ?? {
      isWorkingDay: false,
      startTime: null,
      endTime: null,
    };
    for (const x of transfers) {
      if (x.workDate !== date) continue;
      if (x.toBranchId === args.branchId) {
        baseWindow = {
          isWorkingDay: true,
          startTime: x.startTime,
          endTime: x.endTime,
        };
      } else if (x.fromBranchId === args.branchId) {
        baseWindow = { isWorkingDay: false, startTime: null, endTime: null };
      }
    }

    const base =
      baseWindow.isWorkingDay && baseWindow.startTime && baseWindow.endTime
        ? { isWorking: true, start: baseWindow.startTime, end: baseWindow.endTime }
        : { isWorking: false, start: '00:00', end: '00:00' };

    const overrides =
      date === todayBusinessDate
        ? todayOverrides.get(args.empId) ?? []
        : rawOverridesByDate.get(date) ?? [];
    const effSched = applyOverrides(args.empId, date, base, overrides);
    if (!effSched.isWorking) {
      out.set(date, []);
      continue;
    }

    const baseOvernight =
      base.isWorking && hhmmToMinutes(base.end) <= hhmmToMinutes(base.start);
    const effOvernight = hhmmToMinutes(effSched.end) <= hhmmToMinutes(effSched.start);
    const isOvernight = baseOvernight || effOvernight;
    const shiftStartMs = salonDateTimeToMs(date, effSched.start, timezone);
    const shiftEndMs = isOvernight
      ? salonDateTimeToMs(nextDate(date), effSched.end, timezone)
      : salonDateTimeToMs(date, effSched.end, timezone);

    const bIntervals = bookingBusyByDate.get(date) ?? [];
    const bIntervalsNext = isOvernight ? bookingBusyByDate.get(nextDate(date)) ?? [] : [];
    const qIntervals =
      date === todayBusinessDate ? queueBusyToday : date === tomorrow ? queueBusyTomorrow : [];
    const qIntervalsNext =
      isOvernight && date === todayBusinessDate ? queueBusyTomorrow : [];

    const inShiftWindow = (iv: Interval) =>
      iv.start.getTime() < shiftEndMs && iv.end.getTime() > shiftStartMs;
    const nextDayBusy = isOvernight
      ? [...qIntervalsNext, ...bIntervalsNext].filter(inShiftWindow)
      : [];
    const busy = [...qIntervals, ...bIntervals, ...nextDayBusy];

    // Phase 3C — prefer canonical day-plan windows for this date.
    const dayPlan = (
      await resolveEmployeeDayPlansBatch({
        empIds: [args.empId],
        businessDate: date,
        branchId: args.branchId,
        source: 'public',
      })
    ).get(args.empId);
    const windows = normalizeEffectiveWindows(
      dayPlan?.isWorking ? dayPlan.effectiveWindows : [],
    );
    const useWindows =
      windows.length > 0
        ? windows
        : [
            {
              start: effSched.start,
              end: effSched.end,
              endDayOffset: (isOvernight ? 1 : 0) as 0 | 1,
              startMs: shiftStartMs,
              endMs: shiftEndMs,
            },
          ];
    const outer = outerDisplayBounds(useWindows);
    const sched = dayPlan?.effSched ?? effSched;

    const ctx: BarberCtx = {
      empId: args.empId,
      empName,
      durationMinutes: totalDuration,
      busy,
      effSched: sched,
      baseStart: base.isWorking ? base.start : null,
      shiftStartMs: outer?.startMs ?? shiftStartMs,
      shiftEndMs: outer?.endMs ?? shiftEndMs,
      dayOff: false,
      isOvernight:
        dayPlan?.isOvernight
        || useWindows.some((w) => w.endDayOffset === 1)
        || isOvernight,
      effectiveWindows: useWindows,
    };

    const slotMap = new Map<string, 0 | 1>();
    for (const slot of iterateWindowSlotStarts({
      windows: ctx.effectiveWindows,
      durationMinutes: totalDuration,
      intervalMinutes: slotIntervalMinutes,
    })) {
      const entry = absoluteMsToSlotEntry(slot.startMs, date, timezone);
      if (!slotMap.has(entry.time) || entry.dayOffset < slotMap.get(entry.time)!) {
        slotMap.set(entry.time, entry.dayOffset);
      }
    }
    const sortedSlotTimes = [...slotMap.entries()].sort(([aT, aD], [bT, bD]) =>
      aD !== bD ? aD - bD : aT.localeCompare(bT),
    );

    const isToday = date === todayBusinessDate;
    const rejectionCounts = { ...EMPTY_REJECTION_COUNTS };
    const allPlans = evaluateSlotsForContexts({
      date,
      contexts: [ctx],
      sortedSlotTimes,
      mode: 'specific',
      empId: args.empId,
      timezone,
      isToday,
      nowMs,
      minNoticeMs: effectiveMinNotice * 60_000,
      rejectionCounts,
      collectAllCandidates: false,
    });

    const available = allPlans.filter((s) => s.available);
    out.set(date, available);
  }

  return out;
}
