/**
 * Booking V2 B5 — batch occupancy SoT loaders (server).
 *
 * Query budget for EmpIDs × BusinessDate:
 * - bookings: 1 query (BookingDate IN (businessDate, nextDay) for overnight)
 * - holds: 1 query via listActiveBookingHoldsForEmployees
 *
 * Does NOT invent occupancy truth beyond DB rows. Projection may cache results.
 */

import 'server-only';
import { getPool, sql } from '@/lib/db';
import { ACTIVE_BOOKING_BLOCK_STATUSES } from '@/lib/scheduleIntervals';
import { listActiveBookingHoldsForEmployees } from '@/lib/booking/bookingHold';
import { normalizeBookingTimes } from '@/lib/bookingDateTime';
import { shiftCalendarDate } from '@/lib/businessDate';
import type { AbsoluteOccupancyInterval } from '@/lib/booking/projection/OccupancyTimeline';
import type { HoldOccupancyInterval } from '@/lib/booking/projection/HoldOccupancyProjection';
import { BOOKING_TZ, businessDateTimeToEpochMs } from '@/lib/booking/domain/BusinessDate';

function bookingDateYmd(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    // DATE columns typically arrive as UTC midnight for the calendar day.
    return v.toISOString().slice(0, 10);
  }
  const s = String(v ?? '');
  const m = s.match(/(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1]!;
  return s.slice(0, 10);
}

export type BookingOccupancyBatchResult = {
  /** empId → intervals (any branch). */
  byEmpId: Map<number, AbsoluteOccupancyInterval[]>;
  queryCount: number;
};

export type HoldOccupancyBatchResult = {
  byEmpId: Map<number, HoldOccupancyInterval[]>;
  queryCount: number;
};

/**
 * Batch load active booking occupancy for many employees on a BusinessDate.
 * Includes next calendar BookingDate rows so overnight absolute intervals are covered.
 * Global EmpID — BranchID is attribution only.
 */
export async function loadBookingOccupancyIntervalsBatch(args: {
  employeeIds: number[];
  businessDate: string;
  defaultDurationMinutes?: number;
}): Promise<BookingOccupancyBatchResult> {
  const empIds = [
    ...new Set(args.employeeIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const byEmpId = new Map<number, AbsoluteOccupancyInterval[]>();
  for (const id of empIds) byEmpId.set(id, []);
  if (!empIds.length) return { byEmpId, queryCount: 0 };

  const nextDay = shiftCalendarDate(args.businessDate, 1);
  const statusList = ACTIVE_BOOKING_BLOCK_STATUSES.map((s) => `'${s}'`).join(',');
  const defaultDur = args.defaultDurationMinutes ?? 30;
  const db = await getPool();
  const req = db
    .request()
    .input('d0', sql.Date, args.businessDate)
    .input('d1', sql.Date, nextDay);
  empIds.forEach((id, i) => req.input(`e${i}`, sql.Int, id));

  const res = await req.query(`
    SELECT
      b.BookingID,
      b.AssignedEmpID,
      b.BranchID,
      b.BookingDate,
      b.StartTime,
      b.EndTime,
      ISNULL((
        SELECT SUM(bs.DurationMinutes)
        FROM dbo.BookingServices bs
        WHERE bs.BookingID = b.BookingID
      ), 0) AS TotalDuration
    FROM dbo.Bookings b
    WHERE b.BookingDate IN (@d0, @d1)
      AND b.AssignedEmpID IN (${empIds.map((_, i) => `@e${i}`).join(',')})
      AND LOWER(b.Status) IN (${statusList})
    ORDER BY b.AssignedEmpID ASC, b.StartTime ASC
  `);

  const midnight = businessDateTimeToEpochMs({
    businessDate: args.businessDate,
    clockTimeHhmm: '00:00',
  });
  const timelineEnd = midnight + 48 * 60 * 60_000;

  for (const row of res.recordset as Array<Record<string, unknown>>) {
    const empId = Number(row.AssignedEmpID);
    const bookingId = Number(row.BookingID);
    const branchId = row.BranchID == null ? null : Number(row.BranchID);
    const totalDuration =
      Number(row.TotalDuration) > 0 ? Number(row.TotalDuration) : defaultDur;
    const dateStr = bookingDateYmd(row.BookingDate);
    let startAtMs: number;
    let endAtMs: number;
    try {
      const normalized = normalizeBookingTimes(
        dateStr,
        row.StartTime,
        row.EndTime,
        totalDuration,
        bookingId,
      );
      startAtMs = new Date(normalized.startDateTimeCairo).getTime();
      endAtMs = new Date(normalized.endDateTimeCairo).getTime();
    } catch {
      continue;
    }
    if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs)) continue;
    // Keep intervals that intersect this BusinessDate's 48h projection window.
    if (endAtMs <= midnight || startAtMs >= timelineEnd) continue;
    const list = byEmpId.get(empId) ?? [];
    list.push({ id: bookingId, startAtMs, endAtMs, branchId });
    byEmpId.set(empId, list);
  }

  return { byEmpId, queryCount: 1 };
}

function windowForBusinessDate(businessDate: string, timeZone = BOOKING_TZ) {
  const midnight = businessDateTimeToEpochMs({
    businessDate,
    clockTimeHhmm: '00:00',
    timeZone,
  });
  return { midnight, timelineEnd: midnight + 48 * 60 * 60_000 };
}

function filterIntervalsForBusinessDate<
  T extends { startAtMs: number; endAtMs: number },
>(intervals: T[], businessDate: string, timeZone = BOOKING_TZ): T[] {
  const { midnight, timelineEnd } = windowForBusinessDate(businessDate, timeZone);
  return intervals.filter(
    (iv) => iv.endAtMs > midnight && iv.startAtMs < timelineEnd,
  );
}

/**
 * One bookings query for EmpIDs × [from, to] (+ next day after `to` for overnight).
 * Callers slice per BusinessDate via {@link sliceBookingOccupancyForDate}.
 */
export async function loadBookingOccupancyIntervalsRangeBatch(args: {
  employeeIds: number[];
  from: string;
  to: string;
  defaultDurationMinutes?: number;
}): Promise<{
  allByEmpId: Map<number, AbsoluteOccupancyInterval[]>;
  queryCount: number;
}> {
  const empIds = [
    ...new Set(args.employeeIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const allByEmpId = new Map<number, AbsoluteOccupancyInterval[]>();
  for (const id of empIds) allByEmpId.set(id, []);
  if (!empIds.length || args.from > args.to) {
    return { allByEmpId, queryCount: 0 };
  }

  const lastOvernight = shiftCalendarDate(args.to, 1);
  const statusList = ACTIVE_BOOKING_BLOCK_STATUSES.map((s) => `'${s}'`).join(',');
  const defaultDur = args.defaultDurationMinutes ?? 30;
  const db = await getPool();
  const req = db
    .request()
    .input('from', sql.Date, args.from)
    .input('to', sql.Date, lastOvernight);
  empIds.forEach((id, i) => req.input(`e${i}`, sql.Int, id));

  const res = await req.query(`
    SELECT
      b.BookingID,
      b.AssignedEmpID,
      b.BranchID,
      b.BookingDate,
      b.StartTime,
      b.EndTime,
      ISNULL((
        SELECT SUM(bs.DurationMinutes)
        FROM dbo.BookingServices bs
        WHERE bs.BookingID = b.BookingID
      ), 0) AS TotalDuration
    FROM dbo.Bookings b
    WHERE b.BookingDate BETWEEN @from AND @to
      AND b.AssignedEmpID IN (${empIds.map((_, i) => `@e${i}`).join(',')})
      AND LOWER(b.Status) IN (${statusList})
    ORDER BY b.AssignedEmpID ASC, b.StartTime ASC
  `);

  for (const row of res.recordset as Array<Record<string, unknown>>) {
    const empId = Number(row.AssignedEmpID);
    const bookingId = Number(row.BookingID);
    const branchId = row.BranchID == null ? null : Number(row.BranchID);
    const totalDuration =
      Number(row.TotalDuration) > 0 ? Number(row.TotalDuration) : defaultDur;
    const dateStr = bookingDateYmd(row.BookingDate);
    let startAtMs: number;
    let endAtMs: number;
    try {
      const normalized = normalizeBookingTimes(
        dateStr,
        row.StartTime,
        row.EndTime,
        totalDuration,
        bookingId,
      );
      startAtMs = new Date(normalized.startDateTimeCairo).getTime();
      endAtMs = new Date(normalized.endDateTimeCairo).getTime();
    } catch {
      continue;
    }
    if (!Number.isFinite(startAtMs) || !Number.isFinite(endAtMs)) continue;
    const list = allByEmpId.get(empId) ?? [];
    list.push({ id: bookingId, startAtMs, endAtMs, branchId });
    allByEmpId.set(empId, list);
  }

  return { allByEmpId, queryCount: 1 };
}

export function sliceBookingOccupancyForDate(
  allByEmpId: Map<number, AbsoluteOccupancyInterval[]>,
  employeeIds: number[],
  businessDate: string,
): Map<number, AbsoluteOccupancyInterval[]> {
  const byEmpId = new Map<number, AbsoluteOccupancyInterval[]>();
  for (const empId of employeeIds) {
    byEmpId.set(
      empId,
      filterIntervalsForBusinessDate(allByEmpId.get(empId) ?? [], businessDate),
    );
  }
  return byEmpId;
}

/**
 * Batch active unexpired holds overlapping the BusinessDate 48h window.
 * One SQL round-trip for all employees.
 */
export async function loadHoldOccupancyIntervalsBatch(args: {
  employeeIds: number[];
  businessDate: string;
  nowMs?: number;
  timeZone?: string;
}): Promise<HoldOccupancyBatchResult> {
  const empIds = [
    ...new Set(args.employeeIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const byEmpId = new Map<number, HoldOccupancyInterval[]>();
  for (const id of empIds) byEmpId.set(id, []);
  if (!empIds.length) return { byEmpId, queryCount: 0 };

  const tz = args.timeZone ?? BOOKING_TZ;
  const rangeStartMs = businessDateTimeToEpochMs({
    businessDate: args.businessDate,
    clockTimeHhmm: '00:00',
    timeZone: tz,
  });
  const rangeEndMs = rangeStartMs + 48 * 60 * 60_000;
  const nowMs = args.nowMs ?? Date.now();

  const rows = await listActiveBookingHoldsForEmployees({
    empIds,
    rangeStart: new Date(rangeStartMs),
    rangeEnd: new Date(rangeEndMs),
  });

  for (const row of rows) {
    const list = byEmpId.get(row.empId) ?? [];
    list.push({
      id: row.holdId,
      startAtMs: row.startAt.getTime(),
      endAtMs: row.endAt.getTime(),
      branchId: row.branchId,
      // listActive* already filtered Status=active AND ExpiresAt > now
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      status: 'active',
    });
    byEmpId.set(row.empId, list);
  }

  void nowMs;
  return { byEmpId, queryCount: 1 };
}

/**
 * One holds query covering EmpIDs × [from midnight, to midnight + 48h).
 */
export async function loadHoldOccupancyIntervalsRangeBatch(args: {
  employeeIds: number[];
  from: string;
  to: string;
  nowMs?: number;
  timeZone?: string;
}): Promise<{
  allByEmpId: Map<number, HoldOccupancyInterval[]>;
  queryCount: number;
}> {
  const empIds = [
    ...new Set(args.employeeIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const allByEmpId = new Map<number, HoldOccupancyInterval[]>();
  for (const id of empIds) allByEmpId.set(id, []);
  if (!empIds.length || args.from > args.to) {
    return { allByEmpId, queryCount: 0 };
  }

  const tz = args.timeZone ?? BOOKING_TZ;
  const rangeStartMs = businessDateTimeToEpochMs({
    businessDate: args.from,
    clockTimeHhmm: '00:00',
    timeZone: tz,
  });
  const rangeEndMs =
    businessDateTimeToEpochMs({
      businessDate: args.to,
      clockTimeHhmm: '00:00',
      timeZone: tz,
    }) +
    48 * 60 * 60_000;

  const rows = await listActiveBookingHoldsForEmployees({
    empIds,
    rangeStart: new Date(rangeStartMs),
    rangeEnd: new Date(rangeEndMs),
  });

  for (const row of rows) {
    const list = allByEmpId.get(row.empId) ?? [];
    list.push({
      id: row.holdId,
      startAtMs: row.startAt.getTime(),
      endAtMs: row.endAt.getTime(),
      branchId: row.branchId,
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      status: 'active',
    });
    allByEmpId.set(row.empId, list);
  }

  void args.nowMs;
  return { allByEmpId, queryCount: 1 };
}

export function sliceHoldOccupancyForDate(
  allByEmpId: Map<number, HoldOccupancyInterval[]>,
  employeeIds: number[],
  businessDate: string,
): Map<number, HoldOccupancyInterval[]> {
  const byEmpId = new Map<number, HoldOccupancyInterval[]>();
  for (const empId of employeeIds) {
    byEmpId.set(
      empId,
      filterIntervalsForBusinessDate(allByEmpId.get(empId) ?? [], businessDate),
    );
  }
  return byEmpId;
}

/** Combined batch: bookings + holds for many emps on one BusinessDate. */
export async function loadOccupancyIntervalsBatch(args: {
  employeeIds: number[];
  businessDate: string;
  defaultDurationMinutes?: number;
  nowMs?: number;
}): Promise<{
  bookings: BookingOccupancyBatchResult;
  holds: HoldOccupancyBatchResult;
  queryCount: number;
}> {
  const [bookings, holds] = await Promise.all([
    loadBookingOccupancyIntervalsBatch(args),
    loadHoldOccupancyIntervalsBatch(args),
  ]);
  return {
    bookings,
    holds,
    queryCount: bookings.queryCount + holds.queryCount,
  };
}

export type QueueOccupancyBatchResult = {
  byEmpId: Map<number, AbsoluteOccupancyInterval[]>;
  queryCount: number;
};

/**
 * Batch queue occupancy for EmpIDs on businessDate (+ next day for overnight).
 * Skipped by callers for future public calendar days (parity with live engine).
 */
export async function loadQueueOccupancyIntervalsBatch(args: {
  employeeIds: number[];
  businessDate: string;
  now?: Date;
  defaultDurationMinutes?: number;
  includeNextDay?: boolean;
}): Promise<QueueOccupancyBatchResult> {
  const empIds = [
    ...new Set(args.employeeIds.filter((id) => Number.isInteger(id) && id > 0)),
  ];
  const byEmpId = new Map<number, AbsoluteOccupancyInterval[]>();
  for (const id of empIds) byEmpId.set(id, []);
  if (!empIds.length) return { byEmpId, queryCount: 0 };

  const { getPool } = await import('@/lib/db');
  const { buildQueueIntervalsForEmps } = await import('@/lib/queueEstimateEngine');
  const { shiftCalendarDate } = await import('@/lib/businessDate');
  const db = await getPool();
  const now = args.now ?? new Date();
  const defaultDur = args.defaultDurationMinutes ?? 30;
  let queryCount = 0;

  const todayMap = await buildQueueIntervalsForEmps(
    db,
    empIds,
    args.businessDate,
    now,
    defaultDur,
    { filterStale: true, graceMinutes: 30, failHard: false },
  );
  queryCount += 1;

  let nextMap = new Map<number, Array<{ start: Date; end: Date; id: number }>>();
  if (args.includeNextDay !== false) {
    const nextDay = shiftCalendarDate(args.businessDate, 1);
    nextMap = await buildQueueIntervalsForEmps(
      db,
      empIds,
      nextDay,
      now,
      defaultDur,
      { filterStale: true, graceMinutes: 30, failHard: false },
    );
    queryCount += 1;
  }

  const midnight = businessDateTimeToEpochMs({
    businessDate: args.businessDate,
    clockTimeHhmm: '00:00',
  });
  const timelineEnd = midnight + 48 * 60 * 60_000;

  const pushAll = (
    map: Map<number, Array<{ start: Date; end: Date; id: number }>>,
  ) => {
    for (const [empId, ivs] of map) {
      const list = byEmpId.get(empId) ?? [];
      for (const iv of ivs) {
        const startAtMs = iv.start.getTime();
        const endAtMs = iv.end.getTime();
        if (endAtMs <= midnight || startAtMs >= timelineEnd) continue;
        list.push({
          id: iv.id,
          startAtMs,
          endAtMs,
          branchId: null,
        });
      }
      byEmpId.set(empId, list);
    }
  };
  pushAll(todayMap as Map<number, Array<{ start: Date; end: Date; id: number }>>);
  pushAll(nextMap);

  return { byEmpId, queryCount };
}
