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
  type ScheduleInterval,
} from '@/lib/scheduleIntervals';

export class ScheduleConflictError extends Error {
  status = 409;
  code = 'SCHEDULE_CONFLICT';
  conflict: {
    type: 'booking' | 'queue';
    id: number;
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

export async function getEmployeeBusyIntervals(args: {
  empId: number;
  operationalDate: string;
  now: Date;
  excludeQueueTicketId?: number;
  excludeBookingId?: number;
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

  return [...qIvs, ...filteredBookings].map((iv) => ({
    id: iv.id,
    source: iv.source,
    start: iv.start,
    end: iv.end,
    label: iv.label,
    ticketCode: iv.ticketCode,
  }));
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

  const busy = await getEmployeeBusyIntervals({
    empId: args.empId,
    operationalDate,
    now,
    excludeQueueTicketId: args.excludeQueueTicketId,
    excludeBookingId: args.excludeBookingId,
  });

  const overlaps = findOverlappingIntervals(args.startAt, args.endAt, busy);
  if (overlaps.length === 0) return;

  const first = overlaps[0];
  throw new ScheduleConflictError(
    'هذا الحلاق لديه حجز أو دور متداخل في الفترة المطلوبة',
    {
      type: first.source,
      id: first.id,
      startAt: first.start.toISOString(),
      endAt: first.end.toISOString(),
      reference: first.ticketCode ?? String(first.id),
    },
  );
}
