/**
 * queueEstimateEngine.ts — v2 (shared queue + booking timeline engine)
 *
 * Shared estimation engine used by both:
 *   POST /api/queue/estimate  — UI preview
 *   POST /api/queue           — actual ticket creation (inside transaction)
 *
 * Core logic:
 *   1. Load active queue tickets for the barber (with their EstimatedStartTime + service duration).
 *   2. Load active bookings for the barber (with their StartTime/EndTime).
 *   3. Convert both into concrete [start, end] intervals.
 *   4. Sort all intervals.
 *   5. Walk forward from `now` finding the first gap >= newCustomerDuration
 *      that does not overlap any interval and is inside working hours.
 */

import { getPool, sql } from '@/lib/db';
import { getBarberAvailabilityReason } from '@/lib/barberAvailability';

export interface Interval {
  start:      Date;
  end:        Date;
  source:     'queue' | 'booking';
  id:         number;
  label?:     string;
  ticketCode?: string;
}

export interface BarberEstimate {
  empId:                  number;
  empName:                string;
  estimatedStartTime:     string;   // ISO
  estimatedWaitMinutes:   number;
  waitingCount:           number;
  isWorking:              boolean;
  unavailableReason?:     string;
  blockingQueueCount:     number;
  blockingBookingCount:   number;
  blockingQueueTickets:   Array<{ id: number; estimatedStart: string; durationMin: number }>;
  blockingBookings:       Array<{ id: number; start: string; end: string }>;
  blockingTickets:        Array<{ ticketCode: string; status: string; estimatedStart: string }>;
}

// ── Booking availability result ───────────────────────────────────────────────

export interface BookingAvailability {
  empId:               number;
  empName:             string;
  available:           boolean;
  reason:              string | null;
  conflictType:        'working_hours' | 'day_off' | 'queue' | 'booking' | null;
  conflictingTickets:  Array<{ ticketCode: string; status: string; start: string; end: string }>;
  conflictingBookings: Array<{ bookingId: number; start: string; end: string }>;
  suggestedStartTime:  string | null;
  startTime:           string;
  endTime:             string;
  durationMinutes:     number;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

/** Cairo local date string YYYY-MM-DD */
export function cairoDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

/**
 * Convert a SQL Time value (string "HH:MM:SS" or Date) and a date string
 * into a full Date object in local (server) time.
 */
export function sqlTimeToDate(dateStr: string, timeVal: unknown): Date {
  let hhmm = '00:00';
  if (typeof timeVal === 'string')      hhmm = timeVal.slice(0, 5);
  else if (timeVal instanceof Date)     hhmm = `${String(timeVal.getHours()).padStart(2,'0')}:${String(timeVal.getMinutes()).padStart(2,'0')}`;
  return new Date(`${dateStr}T${hhmm}:00`);
}

// ── Default durations ─────────────────────────────────────────────────────────

export async function getDefaultDuration(db: Awaited<ReturnType<typeof getPool>>): Promise<number> {
  try {
    const r = await db.request().query(`SELECT TOP 1 DefaultServiceMinutes FROM [dbo].[QueueBookingSettings]`);
    return r.recordset[0]?.DefaultServiceMinutes ?? 30;
  } catch { return 30; }
}

export async function getServicesDuration(
  db: Awaited<ReturnType<typeof getPool>>,
  serviceIds: number[],
  fallback: number,
): Promise<number> {
  if (!serviceIds.length) return fallback;
  try {
    const r = db.request();
    serviceIds.forEach((id, i) => r.input(`id${i}`, sql.Int, id));
    const res = await r.query(`
      SELECT ISNULL(SUM(ISNULL(DurationMinutes, ${fallback})), ${fallback}) AS Tot
      FROM [dbo].[TblPro]
      WHERE ProID IN (${serviceIds.map((_, i) => `@id${i}`).join(',')})
    `);
    return res.recordset[0]?.Tot ?? fallback;
  } catch { return fallback; }
}

// ── Interval builder ──────────────────────────────────────────────────────────

/**
 * Load all active queue tickets for the barber on the given date
 * and convert them to [start, end] intervals.
 *
 * Priority order for start time:
 *   1. ticket.EstimatedStartTime (already reserved)
 *   2. ticket.ServiceStartedAt   (currently in-service)
 *   3. Sequential placement after the last known slot (fallback for old tickets without EstimatedStartTime)
 */
export async function buildQueueIntervals(
  db: Awaited<ReturnType<typeof getPool>>,
  empId: number,
  dateStr: string,          // YYYY-MM-DD
  now: Date,                // actual current time — cursor starts here
  defaultDuration: number,
  excludeTicketId?: number, // skip this ticket (for re-estimate of existing)
): Promise<Interval[]> {
  // Build SELECT defensively — guard QueueTicketServices with OBJECT_ID check
  // so when the table doesn't exist the whole query doesn't crash
  const svcTableExists = await db.request()
    .query(`SELECT OBJECT_ID('dbo.QueueTicketServices') AS oid`)
    .then((r: any) => r.recordset[0]?.oid != null)
    .catch(() => false);

  console.log('[buildQueueIntervals] empId', empId, 'dateStr', dateStr, 'svcTableExists', svcTableExists);

  const durationSql = svcTableExists
    ? `ISNULL(
        (SELECT SUM(ISNULL(qts.DurationMinutes, ${defaultDuration}))
         FROM [dbo].[QueueTicketServices] qts
         WHERE qts.QueueTicketID = qt.QueueTicketID),
        ${defaultDuration}
      )`
    : `${defaultDuration}`;

  const estSelectSql = `
    CASE WHEN COL_LENGTH('dbo.QueueTickets','EstimatedStartTime') IS NOT NULL
         THEN qt.EstimatedStartTime ELSE NULL END AS EstimatedStartTime,
    ${durationSql} AS DurationMinutes
  `;

  const res = await db.request()
    .input('qdate', sql.Date, dateStr)
    .input('empId', sql.Int,  empId)
    .query(`
      SELECT
        qt.QueueTicketID,
        qt.TicketCode,
        qt.TicketNumber,
        qt.Status,
        qt.EmpID,
        qt.ServiceStartedAt,
        ${estSelectSql}
      FROM [dbo].[QueueTickets] qt
      WHERE qt.QueueDate = @qdate
        AND qt.EmpID     = @empId
        AND LOWER(qt.Status) IN ('waiting','called','arrived','in_service')
      ORDER BY
        CASE LOWER(qt.Status) WHEN 'in_service' THEN 0 WHEN 'called' THEN 1 WHEN 'arrived' THEN 2 ELSE 3 END ASC,
        ISNULL(
          CASE WHEN COL_LENGTH('dbo.QueueTickets','EstimatedStartTime') IS NOT NULL
               THEN qt.EstimatedStartTime ELSE NULL END,
          qt.CreatedTime
        ) ASC,
        qt.TicketNumber ASC
    `).catch((err: any) => {
      console.error('[buildQueueIntervals] query error', err?.message ?? err);
      return { recordset: [] as any[] };
    });

  console.log('[timeline] empId', empId, 'activeQueueTickets count', res.recordset.length);
  console.log('[timeline] activeQueueTickets', res.recordset.map((t: any) => ({
    code: t.TicketCode,
    status: t.Status,
    estimatedStartTime: t.EstimatedStartTime,
    duration: t.DurationMinutes,
  })));
  console.log('[queue estimate] activeTickets raw', res.recordset.map((t: any) => ({
    code: t.TicketCode, status: t.Status, empId: t.EmpID, estimated: t.EstimatedStartTime,
  })));
  console.log('[queue estimate] activeQueueCount', res.recordset.length);

  const intervals: Interval[] = [];

  // Step 1: handle in_service ticket first (if any) — it has a real start in the past
  const inServiceTickets = res.recordset.filter((t: any) =>
    (!excludeTicketId || t.QueueTicketID !== excludeTicketId) &&
    String(t.Status).toLowerCase() === 'in_service'
  );
  const otherTickets = res.recordset.filter((t: any) =>
    (!excludeTicketId || t.QueueTicketID !== excludeTicketId) &&
    String(t.Status).toLowerCase() !== 'in_service'
  );

  // cursor: the end of the last placed interval — new tickets start here
  let cursor = new Date(now);

  for (const t of inServiceTickets) {
    const dur   = Math.max(1, Number(t.DurationMinutes) || defaultDuration);
    const start = t.ServiceStartedAt ? new Date(t.ServiceStartedAt) : new Date(now);
    const end   = new Date(start.getTime() + dur * 60000);
    intervals.push({ start, end, source: 'queue', id: t.QueueTicketID, label: t.Status, ticketCode: t.TicketCode });
    // cursor must be at least the end of in_service (even if that's in the future)
    if (end > cursor) cursor = end;
  }

  // Step 2: place all other active tickets strictly sequentially from cursor
  // Each ticket occupies exactly one duration slot, one after another.
  // We do NOT use stored EstimatedStartTime here because they may be stale/past.
  for (const t of otherTickets) {
    const dur   = Math.max(1, Number(t.DurationMinutes) || defaultDuration);
    const start = new Date(cursor);
    const end   = new Date(start.getTime() + dur * 60000);
    intervals.push({ start, end, source: 'queue', id: t.QueueTicketID, label: t.Status, ticketCode: t.TicketCode });
    cursor = end; // next ticket starts right after this one
  }

  const totalQueueBlockMinutes = intervals.length > 0
    ? Math.round((cursor.getTime() - now.getTime()) / 60000)
    : 0;
  console.log('[timeline] totalQueueBlockMinutes', totalQueueBlockMinutes);
  console.log('[timeline] nextAvailableTime (queue end)', cursor.toISOString());

  return intervals;
}

/**
 * Load active bookings for the barber on the given date and convert to intervals.
 */
export async function buildBookingIntervals(
  db: Awaited<ReturnType<typeof getPool>>,
  empId: number,
  dateStr: string,
  defaultDuration: number,
): Promise<Interval[]> {
  const res = await db.request()
    .input('bdate', sql.Date, dateStr)
    .input('empId', sql.Int,  empId)
    .query(`
      SELECT BookingID, StartTime, EndTime
      FROM [dbo].[Bookings]
      WHERE BookingDate     = @bdate
        AND AssignedEmpID   = @empId
        AND Status IN ('confirmed','arrived','queued','in_service')
      ORDER BY StartTime ASC
    `).catch(() => ({ recordset: [] as any[] }));

  return res.recordset.map((b: any) => {
    const start = sqlTimeToDate(dateStr, b.StartTime);
    const end   = b.EndTime
      ? sqlTimeToDate(dateStr, b.EndTime)
      : new Date(start.getTime() + defaultDuration * 60000);
    return { start, end, source: 'booking' as const, id: b.BookingID };
  });
}

// ── Core slot finder ──────────────────────────────────────────────────────────

/**
 * Given a sorted list of blocking intervals, find the earliest slot >= `from`
 * with `durationMin` minutes of free time that does not overlap any interval.
 *
 * Max search: 12 hours (prevents infinite loops on pathological data).
 */
export function findFirstFreeSlot(
  from: Date,
  durationMin: number,
  intervals: Interval[],
): Date {
  const durMs    = durationMin * 60000;
  const maxLimit = new Date(from.getTime() + 12 * 3600 * 1000);
  let   candidate = new Date(from);

  let iterations = 0;
  while (candidate < maxLimit && iterations < 500) {
    iterations++;
    const candidateEnd = new Date(candidate.getTime() + durMs);
    let bumped = false;
    for (const iv of intervals) {
      // Overlap: candidate starts before iv ends AND candidate ends after iv starts
      if (candidate < iv.end && candidateEnd > iv.start) {
        candidate = new Date(iv.end); // push past this interval
        bumped = true;
        break; // restart loop to re-check from new position
      }
    }
    if (!bumped) return candidate; // no overlap found
  }
  return candidate;
}

// ── Main per-barber estimate ──────────────────────────────────────────────────

export async function computeBarberEstimate(
  empId: number,
  empName: string,
  serviceIds: number[],
  requestedAt: string | undefined,
  excludeTicketId?: number,
): Promise<BarberEstimate> {
  const db      = await getPool();
  // Always compute business date in Cairo timezone
  const now     = requestedAt ? new Date(requestedAt) : new Date();
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });

  console.log('[queue estimate] empId', empId, 'empName', empName);
  console.log('[queue estimate] requestedAt', now.toISOString(), 'cairoDate', dateStr);

  // Check working hours at requestedAt (not at slot) — this is "is the barber working now?"
  const availResult = await getBarberAvailabilityReason(empId, now);
  const isWorking   = availResult.available;

  if (!isWorking) {
    const result: BarberEstimate = {
      empId,
      empName,
      estimatedStartTime:   now.toISOString(),
      estimatedWaitMinutes: 0,
      waitingCount:         0,
      isWorking:            false,
      unavailableReason:    availResult.reason,
      blockingQueueCount:   0,
      blockingBookingCount: 0,
      blockingQueueTickets: [],
      blockingBookings:     [],
      blockingTickets:      [],
    };
    console.log('[queue estimate] result (unavailable)', { empId, reason: availResult.reason });
    return result;
  }

  const defaultDur  = await getDefaultDuration(db);
  const customerDur = await getServicesDuration(db, serviceIds, defaultDur);

  const qIntervals = await buildQueueIntervals(db, empId, dateStr, now, defaultDur, excludeTicketId);
  const bIntervals = await buildBookingIntervals(db, empId, dateStr, defaultDur);

  console.log('[queue estimate] queue intervals', qIntervals.map(iv => ({
    id: iv.id, code: iv.ticketCode, start: iv.start.toISOString(), end: iv.end.toISOString(), label: iv.label,
  })));
  console.log('[queue estimate] booking intervals', bIntervals.map(iv => ({
    id: iv.id, start: iv.start.toISOString(), end: iv.end.toISOString(),
  })));

  // Merge and sort all blocking intervals
  const allIntervals = [...qIntervals, ...bIntervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime()
  );

  // Find first free slot
  const slot = findFirstFreeSlot(now, customerDur, allIntervals);
  const estimatedWaitMinutes = Math.max(0, Math.round((slot.getTime() - now.getTime()) / 60000));

  console.log('[queue estimate] chosen slot', slot.toISOString(), 'waitMinutes', estimatedWaitMinutes);

  const result: BarberEstimate = {
    empId,
    empName,
    estimatedStartTime:   slot.toISOString(),
    estimatedWaitMinutes,
    waitingCount:         qIntervals.length,
    isWorking:            true,
    unavailableReason:    undefined,
    blockingQueueCount:   qIntervals.length,
    blockingBookingCount: bIntervals.length,
    blockingQueueTickets: qIntervals.map(iv => ({
      id:             iv.id,
      estimatedStart: iv.start.toISOString(),
      durationMin:    Math.round((iv.end.getTime() - iv.start.getTime()) / 60000),
    })),
    blockingBookings: bIntervals.map(iv => ({
      id:    iv.id,
      start: iv.start.toISOString(),
      end:   iv.end.toISOString(),
    })),
    blockingTickets: qIntervals.map(iv => ({
      ticketCode:     iv.ticketCode ?? String(iv.id),
      status:         iv.label ?? 'unknown',
      estimatedStart: iv.start.toISOString(),
    })),
  };

  console.log('[queue estimate] result', {
    empId, empName,
    blockingQueueCount: result.blockingQueueCount,
    blockingBookingCount: result.blockingBookingCount,
    estimatedStartTime: result.estimatedStartTime,
    waitMinutes: result.estimatedWaitMinutes,
  });

  return result;
}

// ── Booking availability check (shared with bookings module) ─────────────────

/**
 * Check whether a barber is available for a booking at a specific datetime.
 *
 * Uses the same interval engine as queue estimation so both modules share
 * one source of truth.
 *
 * @param empId        - barber employee ID
 * @param empName      - barber name (pass '' to let the function resolve it)
 * @param bookingStart - requested booking start as ISO string or Date
 * @param serviceIds   - selected service IDs (for duration)
 * @param durationOverride - optional fixed duration (skip service lookup)
 */
export async function checkBarberAvailableForBooking(
  empId:             number,
  empName:           string,
  bookingStart:      string | Date,
  serviceIds:        number[],
  durationOverride?: number,
): Promise<BookingAvailability> {
  const db      = await getPool();
  const start   = typeof bookingStart === 'string' ? new Date(bookingStart) : bookingStart;
  const dateStr = cairoDateStr(start);

  console.log('[timeline] empId', empId, 'empName', empName);
  console.log('[timeline] requestedAt (bookingStart)', start.toISOString());
  console.log('[timeline] mode booking');

  // Resolve empName if not provided
  if (!empName) {
    try {
      const r = await db.request().input('eid', sql.Int, empId)
        .query(`SELECT TOP 1 EmpName FROM [dbo].[TblEmp] WHERE EmpID = @eid`);
      empName = r.recordset[0]?.EmpName ?? '';
    } catch { /* non-fatal */ }
  }

  // 1. Check working hours / day off
  const avail = await getBarberAvailabilityReason(empId, start);
  if (!avail.available) {
    const conflictType = avail.reason?.includes('إجازة') ? 'day_off' : 'working_hours';
    return {
      empId, empName,
      available:           false,
      reason:              avail.reason ?? 'خارج ساعات العمل',
      conflictType,
      conflictingTickets:  [],
      conflictingBookings: [],
      suggestedStartTime:  null,
      startTime:           start.toISOString(),
      endTime:             '',
      durationMinutes:     durationOverride ?? 0,
    };
  }

  // 2. Resolve service duration
  const defaultDur  = await getDefaultDuration(db);
  const customerDur = durationOverride ?? await getServicesDuration(db, serviceIds, defaultDur);
  const end         = new Date(start.getTime() + customerDur * 60000);

  // 3. Build all blocking intervals (queue + booking) using the shared builders
  // IMPORTANT: pass realNow (not bookingStart) so sequential cursor starts from NOW,
  // not from the requested booking time. Otherwise tickets are placed after bookingStart
  // and never overlap it.
  const realNow    = new Date();
  const qIntervals = await buildQueueIntervals(db, empId, dateStr, realNow, defaultDur);
  const bIntervals = await buildBookingIntervals(db, empId, dateStr, defaultDur);

  console.log('[timeline check] empId', empId);
  console.log('[timeline check] requested slot', start.toISOString(), '->', end.toISOString());
  console.log('[timeline check] queue intervals', qIntervals.map(iv => ({
    code: iv.ticketCode, start: iv.start.toISOString(), end: iv.end.toISOString(), label: iv.label,
  })));
  console.log('[timeline check] booking intervals', bIntervals.map(iv => ({
    id: iv.id, start: iv.start.toISOString(), end: iv.end.toISOString(),
  })));

  // 4. Find queue ticket conflicts — any interval that overlaps [start, end)
  const qConflicts = qIntervals.filter(
    iv => start < iv.end && end > iv.start,
  );
  const bConflicts = bIntervals.filter(
    iv => start < iv.end && end > iv.start,
  );

  console.log('[timeline] blockingIntervals (queue conflicts)', qConflicts.length);
  console.log('[timeline] blockingIntervals (booking conflicts)', bConflicts.length);

  if (qConflicts.length > 0 || bConflicts.length > 0) {
    // suggestedStart = end of the last interval in the FULL queue timeline
    // (not just conflicting ones) — so we suggest after ALL active tickets finish
    const allIntervalsSorted = [...qIntervals, ...bIntervals].sort(
      (a, b) => a.end.getTime() - b.end.getTime(),
    );
    const suggestedStart = new Date(allIntervalsSorted[allIntervalsSorted.length - 1].end);

    const conflictType = qConflicts.length > 0 ? 'queue' : 'booking';

    // Show total active queue count (all intervals), not just conflicting ones
    const totalQueueCount = qIntervals.length;
    const queueEndTime    = qIntervals.length > 0
      ? new Date(Math.max(...qIntervals.map(iv => iv.end.getTime())))
      : null;
    const queueEndStr = queueEndTime
      ? queueEndTime.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Africa/Cairo' })
      : null;

    const reason = qConflicts.length > 0
      ? `لديه ${totalQueueCount} ${totalQueueCount === 1 ? 'دور متوقع' : 'أدوار متوقعة'}${queueEndStr ? ` حتى ${queueEndStr}` : ''}`
      : 'يوجد حجز آخر في هذا الموعد';

    const result: BookingAvailability = {
      empId, empName,
      available:           false,
      reason,
      conflictType,
      conflictingTickets:  qConflicts.map(iv => ({
        ticketCode: iv.ticketCode ?? String(iv.id),
        status:     iv.label ?? 'unknown',
        start:      iv.start.toISOString(),
        end:        iv.end.toISOString(),
      })),
      conflictingBookings: bConflicts.map(iv => ({
        bookingId: iv.id,
        start:     iv.start.toISOString(),
        end:       iv.end.toISOString(),
      })),
      suggestedStartTime:  suggestedStart.toISOString(),
      startTime:           start.toISOString(),
      endTime:             end.toISOString(),
      durationMinutes:     customerDur,
    };

    console.log('[timeline check] result', { empId, empName, available: false, reason, conflictType,
      totalQueueCount: qIntervals.length, suggestedStartTime: suggestedStart.toISOString() });
    return result;
  }

  // 5. Available
  const result: BookingAvailability = {
    empId, empName,
    available:           true,
    reason:              null,
    conflictType:        null,
    conflictingTickets:  [],
    conflictingBookings: [],
    suggestedStartTime:  null,
    startTime:           start.toISOString(),
    endTime:             end.toISOString(),
    durationMinutes:     customerDur,
  };

  console.log('[timeline check] result', { empId, empName, available: true, startTime: start.toISOString() });
  return result;
}
