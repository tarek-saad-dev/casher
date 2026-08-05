import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import {
  buildQueueIntervals,
  buildBookingIntervals,
  getDefaultDuration,
  type Interval,
} from '@/lib/queueEstimateEngine';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  findOverlappingIntervals,
  findEarliestAvailableInterval,
  type ScheduleInterval,
} from '@/lib/scheduleIntervals';
import {
  type EffectiveSchedule,
} from '@/lib/scheduleOverrides';
import { salonDateTimeToMs, getGlobalTimingDefaults } from '@/lib/publicBookingHelpers';
import { SALON_TZ } from '@/lib/bookingDateTime';
import { createStageTimer } from '@/lib/devStageTiming';
import {
  resolveEmployeeDayPlan,
  type DayPlanWindow,
  type EmployeeDayPlan,
} from '@/lib/availability/resolveEmployeeDayPlan';
import {
  findWindowContainingInterval,
  normalizeEffectiveWindows,
  outerDisplayBounds,
} from '@/lib/availability/effectiveWindows';

export class ScheduleConflictError extends Error {
  status = 409;
  code = 'SCHEDULE_CONFLICT';
  conflict: {
    type: 'booking' | 'queue' | 'block';
    id: number;
    empId?: number;
    startAt: string;
    endAt: string;
    reference?: string;
  };

  constructor(
    message: string,
    conflict: ScheduleConflictError['conflict'],
  ) {
    super(message);
    this.conflict = conflict;
  }
}

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

export interface EmployeeShiftBounds {
  /**
   * Outer display / occupancy-load bounds (min window start / max window end).
   * NOT runtime eligibility — gaps between windows remain unbookable.
   */
  shiftStartMs: number;
  shiftEndMs: number;
  effSched: EffectiveSchedule;
  isWorking: boolean;
  /** Phase 3C — all effective windows for containment checks. */
  effectiveWindows?: DayPlanWindow[];
}

export type EmployeeEffectiveWindowsResult = {
  isWorking: boolean;
  windows: DayPlanWindow[];
  blockedIntervals: Array<{ startMs: number; endMs: number; reason?: string }>;
  effSched: EffectiveSchedule | null;
  dayPlan: EmployeeDayPlan;
  plan: EmployeeDayPlan;
  /** Outer display bounds only — never use for eligibility. */
  displayStartMs: number;
  displayEndMs: number;
};

/**
 * Phase 3C — multi-window schedule for runtime write guards.
 * Resolves the day plan once; iterates windows in memory.
 */
export async function getEmployeeEffectiveWindows(args: {
  empId: number;
  operationalDate: string;
  branchId?: number | null;
  transaction?: Transaction;
  settings?: Awaited<ReturnType<typeof getGlobalTimingDefaults>>;
}): Promise<EmployeeEffectiveWindowsResult> {
  const plan = await resolveEmployeeDayPlan({
    empId: args.empId,
    businessDate: args.operationalDate,
    branchId: args.branchId ?? null,
    transaction: args.transaction,
    source: 'operations',
  });
  const windows = normalizeEffectiveWindows(plan.effectiveWindows);
  const outer = outerDisplayBounds(windows);
  const blockedIntervals = (plan.effSched?.blockedIntervals ?? []).map((b) => ({
    startMs: b.startMs,
    endMs: b.endMs,
    reason: b.reason,
  }));
  return {
    isWorking: Boolean(plan.isWorking && plan.effSched?.isWorking && windows.length),
    windows,
    blockedIntervals,
    effSched: plan.effSched,
    dayPlan: plan,
    plan,
    displayStartMs: outer?.startMs ?? 0,
    displayEndMs: outer?.endMs ?? 0,
  };
}

/**
 * Effective schedule for one employee on an operational date.
 * Phase 3C: `effectiveWindows` is authoritative for eligibility;
 * `shiftStartMs`/`shiftEndMs` are outer display / next-day busy load bounds only.
 */
export async function getEmployeeEffectiveSchedule(args: {
  empId: number;
  operationalDate: string;
  branchId?: number | null;
  transaction?: Transaction;
  settings?: Awaited<ReturnType<typeof getGlobalTimingDefaults>>;
}): Promise<EmployeeShiftBounds | null> {
  const multi = await getEmployeeEffectiveWindows(args);

  if (!multi.isWorking || !multi.effSched) {
    return {
      shiftStartMs: 0,
      shiftEndMs: 0,
      effSched: multi.effSched ?? {
        isWorking: false,
        start: '00:00',
        end: '00:00',
        blockedIntervals: [],
        appliedOverride: null,
      },
      isWorking: false,
      effectiveWindows: [],
    };
  }

  return {
    shiftStartMs: multi.displayStartMs,
    shiftEndMs: multi.displayEndMs,
    effSched: multi.effSched,
    isWorking: true,
    effectiveWindows: multi.windows,
  };
}

/**
 * Canonical busy-interval builder — queue, bookings, and block_range overrides.
 * Half-open [start, end). Used by availability engine and final write guard.
 *
 * Static schedule/settings may be passed to avoid duplicate slow reads.
 * Dynamic occupancy is always loaded fresh (preferably on the transaction connection).
 */
export async function getEmployeeBusyIntervals(args: {
  empId: number;
  operationalDate: string;
  now: Date;
  excludeQueueTicketId?: number;
  excludeBookingId?: number;
  /** Ignore this hold during occupancy (create after own hold). */
  excludeHoldKey?: string | null;
  transaction?: Transaction;
  branchId?: number | null;
  /** Absolute end of the candidate interval — when past operationalDate midnight, next-day busy is loaded. */
  rangeEndMs?: number;
  /** Reuse schedule already resolved after applock (do not treat as occupancy truth). */
  schedule?: EmployeeShiftBounds | null;
  settings?: Awaited<ReturnType<typeof getGlobalTimingDefaults>>;
  defaultDuration?: number;
}): Promise<ScheduleInterval[]> {
  const timer = createStageTimer();
  const db = (args.transaction ?? (await getPool())) as Awaited<ReturnType<typeof getPool>>;
  timer.mark('poolMs');

  const settings = args.settings ?? (await getGlobalTimingDefaults({
    transaction: args.transaction,
  }));
  timer.mark('settingsMs');
  const defaultDur =
    args.defaultDuration ??
    settings.defaultServiceDurationMinutes ??
    (await getDefaultDuration(db));
  timer.mark('defaultDurMs');

  const schedule =
    args.schedule !== undefined
      ? args.schedule
      : await getEmployeeEffectiveSchedule({
          empId: args.empId,
          operationalDate: args.operationalDate,
          branchId: args.branchId,
          transaction: args.transaction,
          settings,
        });
  timer.mark('scheduleMs');

  // node-mssql: one request per connection. Never Promise.all on a Transaction.
  const onTx = !!args.transaction;
  let qIvs: Interval[];
  let bIvs: Interval[];
  if (onTx) {
    qIvs = await buildQueueIntervals(
      db,
      args.empId,
      args.operationalDate,
      args.now,
      defaultDur,
      args.excludeQueueTicketId,
      {
        filterStale: true,
        graceMinutes: 30,
        debugContext: 'schedule-integrity',
        failHard: true,
      },
    );
    bIvs = await buildBookingIntervals(db, args.empId, args.operationalDate, defaultDur, {
      failHard: true,
    });
  } else {
    [qIvs, bIvs] = await Promise.all([
      buildQueueIntervals(
        db,
        args.empId,
        args.operationalDate,
        args.now,
        defaultDur,
        args.excludeQueueTicketId,
        { filterStale: true, graceMinutes: 30, debugContext: 'schedule-integrity' },
      ),
      buildBookingIntervals(db, args.empId, args.operationalDate, defaultDur),
    ]);
  }
  timer.mark('sameDayBusyMs');

  const filteredBookings = args.excludeBookingId
    ? bIvs.filter((iv) => iv.id !== args.excludeBookingId)
    : bIvs;

  const timezone = settings.timezone || SALON_TZ;
  const nextMidnightMs = salonDateTimeToMs(nextDate(args.operationalDate), '00:00', timezone);
  const overnightShift = !!schedule?.isWorking && schedule.shiftEndMs > nextMidnightMs;
  const rangeNeedsNextDay =
    args.rangeEndMs != null && args.rangeEndMs > nextMidnightMs;

  let nextDayBusy: Interval[] = [];
  if (schedule?.isWorking && (overnightShift || rangeNeedsNextDay)) {
    const nextDayStr = nextDate(args.operationalDate);
    let qIvsNext: Interval[];
    let bIvsNext: Interval[];
    if (onTx) {
      qIvsNext = await buildQueueIntervals(
        db,
        args.empId,
        nextDayStr,
        args.now,
        defaultDur,
        args.excludeQueueTicketId,
        {
          filterStale: true,
          graceMinutes: 30,
          debugContext: 'schedule-integrity-next-day',
          failHard: true,
        },
      );
      bIvsNext = await buildBookingIntervals(db, args.empId, nextDayStr, defaultDur, {
        failHard: true,
      });
    } else {
      [qIvsNext, bIvsNext] = await Promise.all([
        buildQueueIntervals(db, args.empId, nextDayStr, args.now, defaultDur, args.excludeQueueTicketId, {
          filterStale: true,
          graceMinutes: 30,
          debugContext: 'schedule-integrity-next-day',
        }),
        buildBookingIntervals(db, args.empId, nextDayStr, defaultDur),
      ]);
    }
    const inShiftWindow = (iv: Interval) =>
      iv.start.getTime() < schedule.shiftEndMs && iv.end.getTime() > schedule.shiftStartMs;
    const filteredNextBookings = args.excludeBookingId
      ? bIvsNext.filter((iv) => iv.id !== args.excludeBookingId)
      : bIvsNext;
    nextDayBusy = rangeNeedsNextDay && !overnightShift
      ? [...qIvsNext, ...filteredNextBookings]
      : [...qIvsNext, ...filteredNextBookings].filter(inShiftWindow);
  }
  timer.mark('nextDayBusyMs');

  const blockIvs: ScheduleInterval[] = (schedule?.effSched.blockedIntervals ?? []).map(
    (b, idx) => ({
      id: -(idx + 1),
      source: 'block' as const,
      start: new Date(b.startMs),
      end: new Date(b.endMs),
      label: b.reason,
    }),
  );

  timer.finish('[busy-intervals perf]', { empId: args.empId, date: args.operationalDate });

  let holdIvs: ScheduleInterval[] = [];
  try {
    const { listActiveBookingHoldsForEmployee } = await import('@/lib/booking/bookingHold');
    const rangeStart = new Date(
      salonDateTimeToMs(args.operationalDate, '00:00', timezone),
    );
    const rangeEnd = new Date(
      args.rangeEndMs ??
        salonDateTimeToMs(nextDate(args.operationalDate), '04:00', timezone),
    );
    const holds = await listActiveBookingHoldsForEmployee({
      empId: args.empId,
      rangeStart,
      rangeEnd,
      excludeHoldKey: args.excludeHoldKey ?? null,
    });
    holdIvs = holds.map((h, idx) => ({
      id: -(10_000 + idx),
      source: 'block' as const,
      start: h.startAt,
      end: h.endAt,
      label: 'HOLD_CONFLICT',
    }));
  } catch {
    /* hold table optional until ensured */
  }

  return [
    ...qIvs.map((iv) => ({
      id: iv.id,
      source: iv.source,
      start: iv.start,
      end: iv.end,
      label: iv.label,
      ticketCode: iv.ticketCode,
    })),
    ...filteredBookings.map((iv) => ({
      id: iv.id,
      source: iv.source,
      start: iv.start,
      end: iv.end,
      label: iv.label,
      ticketCode: iv.ticketCode,
    })),
    ...nextDayBusy.map((iv) => ({
      id: iv.id,
      source: iv.source,
      start: iv.start,
      end: iv.end,
      label: iv.label,
      ticketCode: iv.ticketCode,
    })),
    ...blockIvs,
    ...holdIvs,
  ];
}

/** Acquire schedule locks in deterministic order to avoid deadlocks (cross-barber moves). */
export async function acquireScheduleLocksSorted(
  transaction: Transaction,
  empIds: number[],
  operationalDate: string,
): Promise<void> {
  const unique = [...new Set(empIds)].sort((a, b) => a - b);
  for (const empId of unique) {
    await acquireEmployeeScheduleLock(transaction, empId, operationalDate);
  }
}

/** Last applock wait+exec duration (DEV measurement only; not concurrency-safe across parallel requests). */
export let lastScheduleLockMs = 0;

export async function acquireEmployeeScheduleLock(
  transaction: Transaction,
  empId: number,
  operationalDate: string,
): Promise<void> {
  const lockStart = Date.now();
  const lockResource = `operations-schedule:${empId}:${operationalDate}`;
  const lockRes = await transaction.request()
    .input('resource', sql.NVarChar, lockResource)
    .query(`
      DECLARE @result INT;
      EXEC @result = sp_getapplock
        @Resource = @resource,
        @LockMode = 'Exclusive',
        @LockOwner = 'Transaction',
        @LockTimeout = 10000;
      SELECT @result AS LockResult;
    `);
  lastScheduleLockMs = Date.now() - lockStart;

  const lockResult = lockRes.recordset[0]?.LockResult;
  if (lockResult !== 0 && lockResult !== 1) {
    throw new ScheduleConflictError(
      'تعذر قفل جدول الحلاق مؤقتاً، حاول مرة أخرى',
      { type: 'queue', id: 0, startAt: '', endAt: '' },
    );
  }
}

function conflictMessage(iv: ScheduleInterval): string {
  if (iv.source === 'block') return 'الفترة المختارة تتداخل مع فترة مغلقة أو استراحة';
  if (iv.source === 'queue') return 'الفترة المختارة تتداخل مع دور موجود';
  return 'الفترة المختارة تتداخل مع حجز موجود';
}

/**
 * Final write guard — re-reads busy intervals inside transaction after acquiring lock.
 * Validates full [startAt, endAt) against bookings, queue, block_range, and shift bounds.
 */
export async function assertEmployeeIntervalAvailable(args: {
  empId: number;
  startAt: Date;
  endAt: Date;
  now?: Date;
  operationalDate?: string;
  branchId?: number | null;
  excludeQueueTicketId?: number;
  excludeBookingId?: number;
  excludeHoldKey?: string | null;
  transaction?: Transaction;
}): Promise<void> {
  const timer = createStageTimer();
  const now = args.now ?? new Date();
  const operationalDate = args.operationalDate ?? getCairoBusinessDate(now);
  const settings = await getGlobalTimingDefaults({
    transaction: args.transaction,
  });
  timer.mark('settingsMs');

  if (args.transaction) {
    await acquireEmployeeScheduleLock(args.transaction, args.empId, operationalDate);
  }
  timer.mark('applockMs');

  const schedule = await getEmployeeEffectiveSchedule({
    empId: args.empId,
    operationalDate,
    branchId: args.branchId,
    transaction: args.transaction,
    settings,
  });
  timer.mark('scheduleMs');

  if (!schedule?.isWorking) {
    throw new ScheduleConflictError(
      'الحلاق غير متاح في هذا اليوم',
      { type: 'block', id: 0, empId: args.empId, startAt: '', endAt: '' },
    );
  }

  const startMs = args.startAt.getTime();
  const endMs = args.endAt.getTime();

  // Phase 3C: must fit completely inside ONE effective window (no gap bridging).
  const windows =
    schedule.effectiveWindows && schedule.effectiveWindows.length > 0
      ? schedule.effectiveWindows
      : schedule.shiftEndMs > schedule.shiftStartMs
        ? [
            {
              start: schedule.effSched.start,
              end: schedule.effSched.end,
              endDayOffset: 0 as const,
              startMs: schedule.shiftStartMs,
              endMs: schedule.shiftEndMs,
            },
          ]
        : [];
  const containing = findWindowContainingInterval({
    windows,
    startMs,
    endMs,
  });
  if (!containing) {
    throw new ScheduleConflictError(
      'الفترة خارج ساعات عمل الحلاق',
      {
        type: 'block',
        id: 0,
        empId: args.empId,
        startAt: new Date(schedule.shiftStartMs).toISOString(),
        endAt: new Date(schedule.shiftEndMs).toISOString(),
      },
    );
  }

  // Authoritative busy re-read AFTER lock — never reuse pre-validation occupancy.
  const busy = await getEmployeeBusyIntervals({
    empId: args.empId,
    operationalDate,
    now,
    excludeQueueTicketId: args.excludeQueueTicketId,
    excludeBookingId: args.excludeBookingId,
    excludeHoldKey: args.excludeHoldKey,
    transaction: args.transaction,
    rangeEndMs: endMs,
    schedule,
    settings,
    defaultDuration: settings.defaultServiceDurationMinutes,
  });
  timer.mark('busyMs');

  const overlaps = findOverlappingIntervals(args.startAt, args.endAt, busy);
  timer.finish('[assert-available perf]', { empId: args.empId });
  if (overlaps.length === 0) return;

  const first = overlaps[0];
  throw new ScheduleConflictError(
    conflictMessage(first),
    {
      type: first.source === 'block' ? 'block' : first.source,
      id: first.id,
      empId: args.empId,
      startAt: first.start.toISOString(),
      endAt: first.end.toISOString(),
      reference: first.ticketCode ?? first.label ?? String(first.id),
    },
  );
}

/** Find next available slot after a conflict (for 409 responses). */
export async function findNextAvailableForEmployee(args: {
  empId: number;
  operationalDate: string;
  candidateStart: Date;
  durationMinutes: number;
  now?: Date;
  excludeBookingId?: number;
  excludeQueueTicketId?: number;
}): Promise<{ startAt: string; endAt: string } | null> {
  const now = args.now ?? new Date();
  const busy = await getEmployeeBusyIntervals({
    empId: args.empId,
    operationalDate: args.operationalDate,
    now,
    excludeBookingId: args.excludeBookingId,
    excludeQueueTicketId: args.excludeQueueTicketId,
  });

  const next = findEarliestAvailableInterval({
    busyIntervals: busy,
    candidateStart: args.candidateStart,
    durationMinutes: args.durationMinutes,
  });

  if (!next) return null;
  return {
    startAt: next.toISOString(),
    endAt: new Date(next.getTime() + args.durationMinutes * 60000).toISOString(),
  };
}
