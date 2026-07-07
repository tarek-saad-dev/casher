import type { Transaction } from 'mssql';
import { getPool, sql } from '@/lib/db';
import {
  buildQueueIntervals,
  buildBookingIntervals,
  getDefaultDuration,
} from '@/lib/queueEstimateEngine';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  findOverlappingIntervals,
  findEarliestAvailableInterval,
  type ScheduleInterval,
} from '@/lib/scheduleIntervals';
import { getBarberWorkingWindow } from '@/lib/barberAvailability';
import {
  applyOverrides,
  loadOverridesForDate,
  type EffectiveSchedule,
} from '@/lib/scheduleOverrides';
import { salonDateTimeToMs, getPublicSettings } from '@/lib/publicBookingHelpers';
import { SALON_TZ } from '@/lib/bookingDateTime';

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

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
}

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

export interface EmployeeShiftBounds {
  shiftStartMs: number;
  shiftEndMs: number;
  effSched: EffectiveSchedule;
  isWorking: boolean;
}

/** Effective shift window + block ranges for one employee on an operational date. */
export async function getEmployeeEffectiveSchedule(args: {
  empId: number;
  operationalDate: string;
  transaction?: Transaction;
}): Promise<EmployeeShiftBounds | null> {
  const settings = await getPublicSettings();
  const timezone = settings.timezone || SALON_TZ;

  const dateObj = new Date(`${args.operationalDate}T12:00:00`);
  const baseWindow = await getBarberWorkingWindow(args.empId, dateObj);
  const base = baseWindow.isWorkingDay && baseWindow.startTime && baseWindow.endTime
    ? { isWorking: true, start: baseWindow.startTime, end: baseWindow.endTime }
    : { isWorking: false, start: '00:00', end: '00:00' };

  const overridesMap = await loadOverridesForDate(
    await getPool(),
    [args.empId],
    args.operationalDate,
  );
  const effSched = applyOverrides(
    args.empId,
    args.operationalDate,
    base,
    overridesMap.get(args.empId) ?? [],
  );

  if (!effSched.isWorking) {
    return { shiftStartMs: 0, shiftEndMs: 0, effSched, isWorking: false };
  }

  const shiftStartMs = salonDateTimeToMs(args.operationalDate, effSched.start, timezone);
  const isOvernight = hhmmToMinutes(effSched.end) <= hhmmToMinutes(effSched.start);
  const shiftEndMs = isOvernight
    ? salonDateTimeToMs(nextDate(args.operationalDate), effSched.end, timezone)
    : salonDateTimeToMs(args.operationalDate, effSched.end, timezone);

  return { shiftStartMs, shiftEndMs, effSched, isWorking: true };
}

/**
 * Canonical busy-interval builder — queue, bookings, and block_range overrides.
 * Half-open [start, end). Used by availability engine and final write guard.
 */
export async function getEmployeeBusyIntervals(args: {
  empId: number;
  operationalDate: string;
  now: Date;
  excludeQueueTicketId?: number;
  excludeBookingId?: number;
  transaction?: Transaction;
}): Promise<ScheduleInterval[]> {
  const db = await getPool();
  const defaultDur = await getDefaultDuration(db);

  const qIvs = await buildQueueIntervals(
    db,
    args.empId,
    args.operationalDate,
    args.now,
    defaultDur,
    args.excludeQueueTicketId,
    { filterStale: true, graceMinutes: 30, debugContext: 'schedule-integrity' },
  );

  const bIvs = await buildBookingIntervals(db, args.empId, args.operationalDate, defaultDur);
  const filteredBookings = args.excludeBookingId
    ? bIvs.filter((iv) => iv.id !== args.excludeBookingId)
    : bIvs;

  const schedule = await getEmployeeEffectiveSchedule({
    empId: args.empId,
    operationalDate: args.operationalDate,
    transaction: args.transaction,
  });

  const blockIvs: ScheduleInterval[] = (schedule?.effSched.blockedIntervals ?? []).map(
    (b, idx) => ({
      id: -(idx + 1),
      source: 'block' as const,
      start: new Date(b.startMs),
      end: new Date(b.endMs),
      label: b.reason,
    }),
  );

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
    ...blockIvs,
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

export async function acquireEmployeeScheduleLock(
  transaction: Transaction,
  empId: number,
  operationalDate: string,
): Promise<void> {
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
  excludeQueueTicketId?: number;
  excludeBookingId?: number;
  transaction?: Transaction;
}): Promise<void> {
  const now = args.now ?? new Date();
  const operationalDate = args.operationalDate ?? getCairoBusinessDate(now);

  if (args.transaction) {
    await acquireEmployeeScheduleLock(args.transaction, args.empId, operationalDate);
  }

  const schedule = await getEmployeeEffectiveSchedule({
    empId: args.empId,
    operationalDate,
    transaction: args.transaction,
  });

  if (!schedule?.isWorking) {
    throw new ScheduleConflictError(
      'الحلاق غير متاح في هذا اليوم',
      { type: 'block', id: 0, empId: args.empId, startAt: '', endAt: '' },
    );
  }

  const startMs = args.startAt.getTime();
  const endMs = args.endAt.getTime();

  if (startMs < schedule.shiftStartMs || endMs > schedule.shiftEndMs) {
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

  const busy = await getEmployeeBusyIntervals({
    empId: args.empId,
    operationalDate,
    now,
    excludeQueueTicketId: args.excludeQueueTicketId,
    excludeBookingId: args.excludeBookingId,
    transaction: args.transaction,
  });

  const overlaps = findOverlappingIntervals(args.startAt, args.endAt, busy);
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
