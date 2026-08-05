/**
 * Public available-days — ONE range preload + in-memory first-slot probes.
 * Avoids N× buildBarberContexts (the cold ~15–23s wall).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getCairoBusinessDate } from '@/lib/businessDate';
import {
  getPublicSettings,
  salonDateTimeToMs,
} from '@/lib/publicBookingHelpers';
import { listBookableEmployeeIdsForBranch } from '@/lib/branch/bookingQueueOwnership';
import {
  buildQueueIntervalsForEmps,
  getDefaultDuration,
  type Interval,
} from '@/lib/queueEstimateEngine';
import {
  applyOverrides,
  ensureOverridesTable,
  slotBlockedByOverride,
  type EffectiveSchedule,
  type ScheduleOverride,
} from '@/lib/scheduleOverrides';
import {
  loadAttendanceExpandOverridesRange,
  mergeAttendanceExpandOverrides,
} from '@/lib/hr/attendance-shift-schedule-sync';
import { loadFreelanceBookingUnlocks } from '@/lib/hr/freelanceBookingUnlock';
import { evaluateBookingSlotAt } from '@/lib/bookingAvailabilityEngine';
import { ACTIVE_BOOKING_BLOCK_STATUSES } from '@/lib/scheduleIntervals';
import { normalizeBookingTimes } from '@/lib/bookingDateTime';
import { resolveEmployeeDayPlansBatch } from '@/lib/availability/resolveEmployeeDayPlan';
import {
  iterateWindowSlotStarts,
  normalizeEffectiveWindows,
  outerDisplayBounds,
} from '@/lib/availability/effectiveWindows';

export type DaySummaryProbe = {
  date: string;
  available: boolean;
  firstAvailableTime: string | null;
  firstAvailableDayOffset: 0 | 1 | null;
  eligibleBarberCount: number;
  availableBarberCount: number;
};

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fmtScheduleTime(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 5);
  if (v instanceof Date) {
    return `${String(v.getUTCHours()).padStart(2, '0')}:${String(v.getUTCMinutes()).padStart(2, '0')}`;
  }
  return null;
}

function sqlDateToYmd(v: unknown): string {
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
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
  const lastStartInclusive =
    minDurationMinutes > 0 ? endTotal - minDurationMinutes : endTotal - intervalMin;
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

function absoluteMsToSlotEntry(
  ms: number,
  businessDate: string,
  timezone: string,
): { time: string; dayOffset: 0 | 1 } {
  let time = '00:00';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms));
    const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
    time = `${h}:${m}`;
  } catch {
    time = new Date(ms).toISOString().slice(11, 16);
  }
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
    /* keep */
  }
  return { time, dayOffset: ymd > businessDate ? 1 : 0 };
}

async function loadOverridesForDateRange(
  db: Awaited<ReturnType<typeof getPool>>,
  empIds: number[],
  from: string,
  to: string,
): Promise<Map<string, Map<number, ScheduleOverride[]>>> {
  const byDate = new Map<string, Map<number, ScheduleOverride[]>>();
  if (!empIds.length) return byDate;
  try {
    await ensureOverridesTable(db);
    const res = await db
      .request()
      .input('from', sql.Date, from)
      .input('to', sql.Date, to)
      .query(`
        SELECT
          OverrideID, EmpID, CONVERT(VARCHAR(10), OverrideDate, 120) AS OverrideDate,
          Type,
          CASE WHEN StartTime IS NOT NULL
               THEN LEFT(CONVERT(VARCHAR(8), StartTime, 108), 5) ELSE NULL END AS StartTime,
          CASE WHEN EndTime IS NOT NULL
               THEN LEFT(CONVERT(VARCHAR(8), EndTime, 108), 5) ELSE NULL END AS EndTime,
          Reason, IsActive,
          CONVERT(VARCHAR(30), CreatedAt, 126) AS CreatedAt,
          CreatedBy
        FROM dbo.TblEmpScheduleOverrides
        WHERE EmpID IN (${empIds.join(',')})
          AND OverrideDate BETWEEN @from AND @to
          AND IsActive = 1
        ORDER BY OverrideDate, EmpID, OverrideID
      `);
    for (const row of res.recordset as ScheduleOverride[]) {
      const d = String(row.OverrideDate).slice(0, 10);
      if (!byDate.has(d)) byDate.set(d, new Map());
      const m = byDate.get(d)!;
      const list = m.get(row.EmpID) ?? [];
      list.push(row);
      m.set(row.EmpID, list);
    }
  } catch {
    /* optional */
  }
  return byDate;
}

async function loadDayOffAbsentRange(
  db: Awaited<ReturnType<typeof getPool>>,
  empIds: number[],
  from: string,
  to: string,
): Promise<Map<string, Set<number>>> {
  const byDate = new Map<string, Set<number>>();
  if (!empIds.length) return byDate;
  const ensure = (d: string) => {
    if (!byDate.has(d)) byDate.set(d, new Set());
    return byDate.get(d)!;
  };
  try {
    const doRes = await db
      .request()
      .input('from', sql.Date, from)
      .input('to', sql.Date, to)
      .query(`
        SELECT EmpID, CONVERT(VARCHAR(10), OffDate, 120) AS OffDate
        FROM dbo.TblEmpDayOff
        WHERE EmpID IN (${empIds.join(',')})
          AND OffDate BETWEEN @from AND @to
          AND IsDeleted = 0
      `);
    for (const r of doRes.recordset) ensure(String(r.OffDate)).add(Number(r.EmpID));
  } catch {
    /* optional */
  }
  try {
    const att = await db
      .request()
      .input('from', sql.Date, from)
      .input('to', sql.Date, to)
      .query(`
        SELECT EmpID, CONVERT(VARCHAR(10), WorkDate, 120) AS WorkDate
        FROM dbo.TblEmpAttendance
        WHERE EmpID IN (${empIds.join(',')})
          AND WorkDate BETWEEN @from AND @to
          AND Status = N'Absent'
      `);
    for (const r of att.recordset) ensure(String(r.WorkDate)).add(Number(r.EmpID));
  } catch {
    /* optional */
  }
  return byDate;
}

type WindowRow = {
  empId: number;
  dow: number;
  isWorking: boolean;
  start: string | null;
  end: string | null;
  effectiveFrom: string;
};

async function loadBranchWindowsRange(
  db: Awaited<ReturnType<typeof getPool>>,
  empIds: number[],
  branchId: number,
  from: string,
  to: string,
): Promise<{
  schedules: WindowRow[];
  transfersIn: Map<string, Map<number, { start: string | null; end: string | null }>>;
  transfersOut: Map<string, Set<number>>;
}> {
  const schedules: WindowRow[] = [];
  const transfersIn = new Map<string, Map<number, { start: string | null; end: string | null }>>();
  const transfersOut = new Map<string, Set<number>>();
  if (!empIds.length) return { schedules, transfersIn, transfersOut };

  try {
    const { ensureEmpBranchWorkScheduleTable } = await import('@/lib/hr/empBranchWorkSchedule');
    await ensureEmpBranchWorkScheduleTable();
    const res = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .input('from', sql.Date, from)
      .input('to', sql.Date, to)
      .query(`
        SELECT EmpID, DayOfWeek, IsWorking, StartTime, EndTime,
          CONVERT(VARCHAR(10), EffectiveFrom, 120) AS EffectiveFrom,
          CONVERT(VARCHAR(10), EffectiveTo, 120) AS EffectiveTo
        FROM dbo.TblEmpBranchWorkSchedule
        WHERE BranchID = @branchId AND IsActive = 1
          AND EffectiveFrom <= @to
          AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
          AND EmpID IN (${empIds.join(',')})
      `);
    for (const row of res.recordset) {
      schedules.push({
        empId: Number(row.EmpID),
        dow: Number(row.DayOfWeek),
        isWorking: !!row.IsWorking,
        start: fmtScheduleTime(row.StartTime),
        end: fmtScheduleTime(row.EndTime),
        effectiveFrom: String(row.EffectiveFrom).slice(0, 10),
      });
    }
  } catch {
    /* fall through */
  }

  try {
    const xfer = await db
      .request()
      .input('branchId', sql.Int, branchId)
      .input('from', sql.Date, from)
      .input('to', sql.Date, to)
      .query(`
        SELECT EmpID, CONVERT(VARCHAR(10), WorkDate, 120) AS WorkDate,
          StartTime, EndTime, FromBranchID, ToBranchID
        FROM dbo.TblEmpTemporaryBranchTransfer
        WHERE IsActive = 1
          AND WorkDate BETWEEN @from AND @to
          AND EmpID IN (${empIds.join(',')})
          AND (ToBranchID = @branchId OR FromBranchID = @branchId)
      `);
    for (const row of xfer.recordset) {
      const d = String(row.WorkDate);
      const empId = Number(row.EmpID);
      if (Number(row.ToBranchID) === branchId) {
        if (!transfersIn.has(d)) transfersIn.set(d, new Map());
        transfersIn.get(d)!.set(empId, {
          start: fmtScheduleTime(row.StartTime),
          end: fmtScheduleTime(row.EndTime),
        });
      }
      if (Number(row.FromBranchID) === branchId) {
        if (!transfersOut.has(d)) transfersOut.set(d, new Set());
        transfersOut.get(d)!.add(empId);
      }
    }
  } catch {
    /* optional */
  }

  // Legacy weekly fallback for emps with no branch rows at all
  const covered = new Set(schedules.map((s) => s.empId));
  const missing = empIds.filter((id) => !covered.has(id));
  if (missing.length) {
    try {
      const res = await db.request().query(`
        SELECT EmpID, DayOfWeek, IsWorkingDay, StartTime, EndTime
        FROM dbo.TblEmpWorkSchedule
        WHERE EmpID IN (${missing.join(',')})
      `);
      for (const row of res.recordset) {
        schedules.push({
          empId: Number(row.EmpID),
          dow: Number(row.DayOfWeek),
          isWorking: !!row.IsWorkingDay,
          start: fmtScheduleTime(row.StartTime),
          end: fmtScheduleTime(row.EndTime),
          effectiveFrom: '1970-01-01',
        });
      }
    } catch {
      /* empty */
    }
  }

  return { schedules, transfersIn, transfersOut };
}

function windowForEmpDate(
  schedules: WindowRow[],
  transfersIn: Map<string, Map<number, { start: string | null; end: string | null }>>,
  transfersOut: Map<string, Set<number>>,
  empId: number,
  date: string,
): { isWorkingDay: boolean; startTime: string | null; endTime: string | null } {
  if (transfersOut.get(date)?.has(empId)) {
    return { isWorkingDay: false, startTime: null, endTime: null };
  }
  const tin = transfersIn.get(date)?.get(empId);
  if (tin) {
    return { isWorkingDay: true, startTime: tin.start, endTime: tin.end };
  }
  const dow = new Date(`${date}T12:00:00Z`).getDay();
  const candidates = schedules
    .filter((s) => s.empId === empId && s.dow === dow && s.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const best = candidates[0];
  if (!best) return { isWorkingDay: false, startTime: null, endTime: null };
  return {
    isWorkingDay: best.isWorking,
    startTime: best.start,
    endTime: best.end,
  };
}

async function loadBookingsBusyRange(
  db: Awaited<ReturnType<typeof getPool>>,
  empIds: number[],
  from: string,
  toInclusiveNext: string,
  defaultDuration: number,
): Promise<Map<string, Map<number, Interval[]>>> {
  const byDate = new Map<string, Map<number, Interval[]>>();
  if (!empIds.length) return byDate;
  const statusList = ACTIVE_BOOKING_BLOCK_STATUSES.map((s) => `'${s}'`).join(',');
  const res = await db
    .request()
    .input('from', sql.Date, from)
    .input('to', sql.Date, toInclusiveNext)
    .query(
      `
      SELECT
        b.BookingID, b.AssignedEmpID, b.BookingDate, b.StartTime, b.EndTime,
        ISNULL((
          SELECT SUM(bs.DurationMinutes) FROM dbo.BookingServices bs WHERE bs.BookingID = b.BookingID
        ), 0) AS TotalDuration
      FROM dbo.Bookings b
      WHERE b.BookingDate BETWEEN @from AND @to
        AND b.AssignedEmpID IN (${empIds.join(',')})
        AND LOWER(b.Status) IN (${statusList})
      ORDER BY b.BookingDate, b.AssignedEmpID, b.StartTime
    `,
    )
    .catch(() => ({ recordset: [] as any[] }));

  for (const b of res.recordset) {
    const dateStr = sqlDateToYmd(b.BookingDate);
    const empId = Number(b.AssignedEmpID);
    const totalDuration = b.TotalDuration > 0 ? b.TotalDuration : defaultDuration;
    const normalized = normalizeBookingTimes(
      dateStr,
      b.StartTime,
      b.EndTime,
      totalDuration,
      b.BookingID,
    );
    if (!byDate.has(dateStr)) byDate.set(dateStr, new Map());
    const m = byDate.get(dateStr)!;
    const list = m.get(empId) ?? [];
    list.push({
      start: new Date(normalized.startDateTimeCairo),
      end: new Date(normalized.endDateTimeCairo),
      source: 'booking',
      id: b.BookingID,
    });
    m.set(empId, list);
  }
  return byDate;
}

/**
 * Summarize calendar availability for a date range with ~O(1) SQL round-trips
 * (not one full engine per day).
 */
export async function summarizeAvailableDaysRange(args: {
  dates: string[];
  branchId: number;
  serviceIds: number[];
  durationMinutes: number;
  mode: 'nearest' | 'specific';
  empId?: number | null;
}): Promise<Map<string, DaySummaryProbe>> {
  const out = new Map<string, DaySummaryProbe>();
  const dates = args.dates;
  if (!dates.length) return out;

  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const settings = await getPublicSettings(args.branchId);
  const db = await getPool();
  const timezone = settings.timezone || 'Africa/Cairo';
  const slotInterval = settings.slotIntervalMinutes || 15;
  const minNoticeMs = (settings.minNoticeMinutes || 0) * 60_000;
  const now = new Date();
  const nowMs = now.getTime();
  const today = getCairoBusinessDate(now);
  const defaultDur =
    settings.defaultServiceDurationMinutes || (await getDefaultDuration(db)) || 30;
  const duration = args.durationMinutes || defaultDur;

  let barberIds: number[];
  if (args.mode === 'specific' && args.empId) {
    const eligible = new Set(
      await listBookableEmployeeIdsForBranch(args.branchId, from, { publicOnly: true }),
    );
    barberIds = eligible.has(args.empId) ? [args.empId] : [];
  } else {
    // Union of bookable emps at range start + end (covers mid-range transfers cheaply)
    const [a, b] = await Promise.all([
      listBookableEmployeeIdsForBranch(args.branchId, from, { publicOnly: true }),
      from === to
        ? Promise.resolve([] as number[])
        : listBookableEmployeeIdsForBranch(args.branchId, to, { publicOnly: true }),
    ]);
    barberIds = [...new Set([...a, ...b])];
  }

  if (!barberIds.length) {
    for (const date of dates) {
      out.set(date, {
        date,
        available: false,
        firstAvailableTime: null,
        firstAvailableDayOffset: null,
        eligibleBarberCount: 0,
        availableBarberCount: 0,
      });
    }
    return out;
  }

  const toNext = nextDate(to);
  const [
    nameRes,
    dayOffByDate,
    rawOverridesByDate,
    expandByDate,
    { schedules, transfersIn, transfersOut },
    bookingsByDate,
    freelanceToday,
  ] = await Promise.all([
    db
      .request()
      .query(`SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID IN (${barberIds.join(',')})`)
      .catch(() => ({ recordset: [] as Array<{ EmpID: number; EmpName: string }> })),
    loadDayOffAbsentRange(db, barberIds, from, to),
    loadOverridesForDateRange(db, barberIds, from, to),
    loadAttendanceExpandOverridesRange(db, barberIds, from, to),
    loadBranchWindowsRange(db, barberIds, args.branchId, from, to),
    loadBookingsBusyRange(db, barberIds, from, toNext, defaultDur),
    dates.includes(today)
      ? loadFreelanceBookingUnlocks(barberIds, today)
      : Promise.resolve(new Map<number, { start: string; end: string }>()),
  ]);

  const nameMap: Record<number, string> = {};
  for (const r of nameRes.recordset) nameMap[r.EmpID] = r.EmpName;

  // Queue only for today (live shop floor)
  let queueToday = new Map<number, Interval[]>();
  let queueTomorrow = new Map<number, Interval[]>();
  if (dates.includes(today)) {
    const tom = nextDate(today);
    [queueToday, queueTomorrow] = await Promise.all([
      buildQueueIntervalsForEmps(db, barberIds, today, now, defaultDur, {
        filterStale: true,
        graceMinutes: 30,
        debugContext: 'days-range-today',
      }),
      buildQueueIntervalsForEmps(db, barberIds, tom, now, defaultDur, {
        filterStale: true,
        graceMinutes: 30,
        debugContext: 'days-range-tomorrow',
      }),
    ]);
  }

  for (const date of dates) {
    if (date < today) {
      out.set(date, {
        date,
        available: false,
        firstAvailableTime: null,
        firstAvailableDayOffset: null,
        eligibleBarberCount: 0,
        availableBarberCount: 0,
      });
      continue;
    }

    const dayOff = dayOffByDate.get(date) ?? new Set();
    const raw = rawOverridesByDate.get(date) ?? new Map();
    const expands = expandByDate.get(date) ?? new Map();
    const overridesMap = mergeAttendanceExpandOverrides(raw, expands);
    const isToday = date === today;

    type Ctx = {
      empId: number;
      empName: string;
      durationMinutes: number;
      busy: Interval[];
      effSched: EffectiveSchedule;
      shiftStartMs: number;
      shiftEndMs: number;
      isOvernight: boolean;
      effectiveWindows: ReturnType<typeof normalizeEffectiveWindows>;
    };
    const contexts: Ctx[] = [];

    const dayPlans = await resolveEmployeeDayPlansBatch({
      empIds: barberIds.filter((id) => !dayOff.has(id)),
      businessDate: date,
      branchId: args.branchId,
      source: 'public',
    });

    for (const empId of barberIds) {
      if (dayOff.has(empId)) continue;

      const plan = dayPlans.get(empId);
      if (plan?.isWorking && plan.effSched && plan.effectiveWindows.length) {
        const windows = normalizeEffectiveWindows(plan.effectiveWindows);
        const outer = outerDisplayBounds(windows)!;
        const isOvernight =
          plan.isOvernight || windows.some((w) => w.endDayOffset === 1);
        const bToday = bookingsByDate.get(date)?.get(empId) ?? [];
        const bNext = isOvernight
          ? bookingsByDate.get(nextDate(date))?.get(empId) ?? []
          : [];
        const qToday = isToday ? queueToday.get(empId) ?? [] : [];
        const qNext =
          isToday && isOvernight ? queueTomorrow.get(empId) ?? [] : [];
        const inShift = (iv: Interval) =>
          iv.start.getTime() < outer.endMs && iv.end.getTime() > outer.startMs;
        const nextBusy = isOvernight ? [...qNext, ...bNext].filter(inShift) : [];

        contexts.push({
          empId,
          empName: nameMap[empId] ?? '',
          durationMinutes: duration,
          busy: [...qToday, ...bToday, ...nextBusy],
          effSched: plan.effSched,
          shiftStartMs: outer.startMs,
          shiftEndMs: outer.endMs,
          isOvernight,
          effectiveWindows: windows,
        });
        continue;
      }

      // Fallback: legacy weekly + overrides when day plan has no windows
      let win = windowForEmpDate(schedules, transfersIn, transfersOut, empId, date);
      if (isToday) {
        const unlock = freelanceToday.get(empId);
        if (unlock && !win.isWorkingDay) {
          win = { isWorkingDay: true, startTime: unlock.start, endTime: unlock.end };
        }
      }
      const base =
        win.isWorkingDay && win.startTime && win.endTime
          ? { isWorking: true, start: win.startTime, end: win.endTime }
          : { isWorking: false, start: '00:00', end: '00:00' };
      const effSched = applyOverrides(
        empId,
        date,
        base,
        (overridesMap.get(empId) ?? []) as ScheduleOverride[],
      );
      if (!effSched.isWorking) continue;

      const baseOvernight =
        base.isWorking && hhmmToMinutes(base.end) <= hhmmToMinutes(base.start);
      const effOvernight = hhmmToMinutes(effSched.end) <= hhmmToMinutes(effSched.start);
      const isOvernight = baseOvernight || effOvernight;
      const shiftStartMs = salonDateTimeToMs(date, effSched.start, timezone);
      const shiftEndMs = isOvernight
        ? salonDateTimeToMs(nextDate(date), effSched.end, timezone)
        : salonDateTimeToMs(date, effSched.end, timezone);

      const bToday = bookingsByDate.get(date)?.get(empId) ?? [];
      const bNext = isOvernight
        ? bookingsByDate.get(nextDate(date))?.get(empId) ?? []
        : [];
      const qToday =
        isToday ? queueToday.get(empId) ?? [] : [];
      const qNext =
        isToday && isOvernight ? queueTomorrow.get(empId) ?? [] : [];
      const inShift = (iv: Interval) =>
        iv.start.getTime() < shiftEndMs && iv.end.getTime() > shiftStartMs;
      const nextBusy = isOvernight ? [...qNext, ...bNext].filter(inShift) : [];

      contexts.push({
        empId,
        empName: nameMap[empId] ?? '',
        durationMinutes: duration,
        busy: [...qToday, ...bToday, ...nextBusy],
        effSched,
        shiftStartMs,
        shiftEndMs,
        isOvernight,
        effectiveWindows: [
          {
            start: effSched.start,
            end: effSched.end,
            endDayOffset: isOvernight ? 1 : 0,
            startMs: shiftStartMs,
            endMs: shiftEndMs,
          },
        ],
      });
    }

    let firstTime: string | null = null;
    let firstOffset: 0 | 1 | null = null;
    const availableBarbers = new Set<number>();

    // Build unique slot times across ALL windows (Phase 3C)
    const slotMap = new Map<string, 0 | 1>();
    for (const ctx of contexts) {
      for (const slot of iterateWindowSlotStarts({
        windows: ctx.effectiveWindows,
        durationMinutes: duration,
        intervalMinutes: slotInterval,
      })) {
        const entry = absoluteMsToSlotEntry(slot.startMs, date, timezone);
        if (!slotMap.has(entry.time) || entry.dayOffset < slotMap.get(entry.time)!) {
          slotMap.set(entry.time, entry.dayOffset);
        }
      }
    }
    const sorted = [...slotMap.entries()].sort(([aT, aD], [bT, bD]) =>
      aD !== bD ? aD - bD : aT.localeCompare(bT),
    );

    outer: for (const [time, dayOffset] of sorted) {
      const slotDate = dayOffset === 1 ? nextDate(date) : date;
      const slotStartMs = salonDateTimeToMs(slotDate, time, timezone);
      for (const ctx of contexts) {
        const slotEndMs = slotStartMs + ctx.durationMinutes * 60_000;
        const overrideBlockReason = slotBlockedByOverride(slotStartMs, slotEndMs, ctx.effSched);
        const r = evaluateBookingSlotAt(slotStartMs, ctx.durationMinutes, ctx.busy, {
          shiftStartMs: ctx.shiftStartMs,
          shiftEndMs: ctx.shiftEndMs,
          effectiveWindows: ctx.effectiveWindows,
          nowMs: isToday ? nowMs : undefined,
          minNoticeMs: isToday ? minNoticeMs : 0,
          overrideBlock: !!overrideBlockReason,
          overrideBlockReason,
        });
        if (r.available) {
          availableBarbers.add(ctx.empId);
          if (firstTime == null) {
            firstTime = time;
            firstOffset = dayOffset;
            // For calendar we only need first free time — stop once found.
            break outer;
          }
        }
      }
    }

    out.set(date, {
      date,
      available: firstTime != null,
      firstAvailableTime: firstTime,
      firstAvailableDayOffset: firstOffset,
      eligibleBarberCount: contexts.length,
      availableBarberCount: availableBarbers.size || (firstTime ? 1 : 0),
    });
  }

  return out;
}


