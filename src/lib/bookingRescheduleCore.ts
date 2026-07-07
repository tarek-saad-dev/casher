/**
 * Operations drag-and-drop booking reschedule — server-side validation and commit.
 * Reuses evaluateBookingSlotAt + scheduleIntegrity transactional guard.
 */

import { sql, getPool } from '@/lib/db';
import {
  evaluateBookingSlotAt,
  BOOKING_SLOT_REASON_AR,
  type BookingSlotReasonCode,
} from '@/lib/bookingAvailabilityEngine';
import {
  createCairoDateTime,
  calculateEndTime,
  formatTimeArabic,
  normalizeBookingTimes,
  sqlTimeToHhmm,
  sqlDateToYyyyMmDd,
  SALON_TZ,
} from '@/lib/bookingDateTime';
import {
  assertEmployeeIntervalAvailable,
  acquireScheduleLocksSorted,
  getEmployeeBusyIntervals,
  ScheduleConflictError,
} from '@/lib/scheduleIntegrity';
import { findEarliestAvailableInterval } from '@/lib/scheduleIntervals';
import { getBarberWorkingWindow } from '@/lib/barberAvailability';
import {
  loadOverridesForDate,
  applyOverrides,
  slotBlockedByOverride,
} from '@/lib/scheduleOverrides';
import { salonDateTimeToMs, getPublicSettings } from '@/lib/publicBookingHelpers';
import { getDefaultDuration } from '@/lib/queueEstimateEngine';

/** dbo.Bookings.Notes column limit (see db/migrations/queue-booking-system.sql) */
export const BOOKING_NOTES_MAX_LENGTH = 500;

export const RESCHEDULABLE_BOOKING_STATUSES = new Set([
  'confirmed',
  'arrived',
  'queued',
]);

export interface LoadedBookingForReschedule {
  bookingId: number;
  bookingCode: string | null;
  clientId: number | null;
  clientName: string | null;
  assignedEmpId: number;
  empName: string | null;
  bookingDate: string;
  startTime: string;
  endTime: string | null;
  status: string;
  notes: string | null;
  durationMinutes: number;
  startAt: Date;
  endAt: Date;
  serviceIds: number[];
}

export interface BookingMoveValidationResult {
  valid: boolean;
  targetEmpId?: number;
  targetEmpName?: string;
  newStartAt?: string;
  newEndAt?: string;
  durationMinutes?: number;
  code?: string;
  message?: string;
  conflict?: {
    type: 'booking' | 'queue' | 'break' | 'shift' | 'block';
    startAt?: string;
    endAt?: string;
    reference?: string;
  };
  nextAvailable?: {
    startAt: string;
    endAt: string;
  };
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function msToHhmm(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ms));
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h}:${m}`;
}

function nextDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

export function isBookingReschedulable(status: string): boolean {
  return RESCHEDULABLE_BOOKING_STATUSES.has(status.toLowerCase());
}

export async function loadBookingForReschedule(
  bookingId: number,
): Promise<LoadedBookingForReschedule | null> {
  const db = await getPool();

  const bkRes = await db.request()
    .input('id', sql.Int, bookingId)
    .query(`
      SELECT
        b.BookingID, b.BookingCode, b.ClientID, b.AssignedEmpID,
        b.BookingDate, b.StartTime, b.EndTime, b.Status, b.Notes,
        c.[Name] AS ClientName, e.EmpName
      FROM [dbo].[Bookings] b
      LEFT JOIN [dbo].[TblClient] c ON c.ClientID = b.ClientID
      LEFT JOIN [dbo].[TblEmp] e ON e.EmpID = b.AssignedEmpID
      WHERE b.BookingID = @id
    `);

  if (!bkRes.recordset.length) return null;

  const booking = bkRes.recordset[0];
  const svcRes = await db.request()
    .input('id', sql.Int, bookingId)
    .query(`
      SELECT ProID, DurationMinutes
      FROM [dbo].[BookingServices]
      WHERE BookingID = @id
      ORDER BY BookingServiceID
    `);

  const services = svcRes.recordset;
  const defaultDur = await getDefaultDuration(db);
  const totalDuration = services.reduce(
    (sum: number, s: { DurationMinutes: number | null }) =>
      sum + (s.DurationMinutes || defaultDur),
    0,
  ) || defaultDur;

  const bookingDate = sqlDateToYyyyMmDd(booking.BookingDate);
  const normalized = normalizeBookingTimes(
    bookingDate,
    booking.StartTime,
    booking.EndTime,
    totalDuration,
    bookingId,
  );

  return {
    bookingId,
    bookingCode: booking.BookingCode ?? null,
    clientId: booking.ClientID ?? null,
    clientName: booking.ClientName ?? null,
    assignedEmpId: booking.AssignedEmpID,
    empName: booking.EmpName ?? null,
    bookingDate,
    startTime: sqlTimeToHhmm(booking.StartTime),
    endTime: booking.EndTime ? sqlTimeToHhmm(booking.EndTime) : normalized.endTimeDisplay,
    status: booking.Status,
    notes: booking.Notes ?? null,
    durationMinutes: normalized.durationMinutes,
    startAt: new Date(normalized.startDateTimeCairo),
    endAt: new Date(normalized.endDateTimeCairo),
    serviceIds: services.map((s: { ProID: number }) => s.ProID).filter(Boolean),
  };
}

async function getBarberShiftBounds(
  empId: number,
  operationalDate: string,
  timezone: string,
): Promise<{ shiftStartMs: number; shiftEndMs: number } | null> {
  const db = await getPool();
  const dateObj = new Date(`${operationalDate}T12:00:00`);
  const baseWindow = await getBarberWorkingWindow(empId, dateObj);
  if (!baseWindow.isWorkingDay || !baseWindow.startTime || !baseWindow.endTime) {
    return null;
  }

  const overridesMap = await loadOverridesForDate(db, [empId], operationalDate);
  const base = {
    isWorking: true,
    start: baseWindow.startTime,
    end: baseWindow.endTime,
  };
  const effSched = applyOverrides(empId, operationalDate, base, overridesMap.get(empId) ?? []);
  if (!effSched.isWorking) return null;

  const shiftStartMs = salonDateTimeToMs(operationalDate, effSched.start, timezone);
  const isOvernight = hhmmToMinutes(effSched.end) <= hhmmToMinutes(effSched.start);
  const shiftEndMs = isOvernight
    ? salonDateTimeToMs(nextDate(operationalDate), effSched.end, timezone)
    : salonDateTimeToMs(operationalDate, effSched.end, timezone);

  return { shiftStartMs, shiftEndMs };
}

/** Append audit line without exceeding dbo.Bookings.Notes NVARCHAR(500). */
export function mergeBookingNotes(
  existing: string | null,
  auditLine: string,
  maxLen = BOOKING_NOTES_MAX_LENGTH,
): string {
  if (!existing?.trim()) {
    return auditLine.length <= maxLen ? auditLine : auditLine.slice(0, maxLen);
  }

  const merged = `${existing.trim()}\n${auditLine}`;
  if (merged.length <= maxLen) return merged;

  // Keep the latest audit line; trim older content from the start.
  if (auditLine.length >= maxLen) {
    return auditLine.slice(0, maxLen);
  }

  const separator = '\n';
  const budget = maxLen - auditLine.length - separator.length;
  const trimmedExisting = existing.trim().slice(-Math.max(0, budget));
  return trimmedExisting
    ? `${trimmedExisting}${separator}${auditLine}`
    : auditLine;
}

function reasonToMessage(
  code: BookingSlotReasonCode | undefined,
  conflict?: BookingMoveValidationResult['conflict'],
): string {
  if (code === 'booking_conflict') {
    return conflict?.reference
      ? `الفترة تتداخل مع حجز ${conflict.reference}`
      : BOOKING_SLOT_REASON_AR.booking_conflict;
  }
  if (code === 'queue_conflict') {
    return conflict?.reference
      ? `الفترة تتداخل مع دور ${conflict.reference}`
      : BOOKING_SLOT_REASON_AR.queue_conflict;
  }
  if (code === 'break') return BOOKING_SLOT_REASON_AR.break;
  if (code === 'outside_working_hours' || code === 'insufficient_continuous_time') {
    return 'خارج وقت العمل';
  }
  return code ? BOOKING_SLOT_REASON_AR[code] : 'الفترة غير متاحة';
}

/** Verify target barber is active, working, and can perform all booking services. */
export async function validateTargetBarberEligibility(args: {
  targetEmpId: number;
  serviceIds: number[];
  operationalDate: string;
  timezone: string;
}): Promise<{ ok: true; empName: string } | { ok: false; code: string; message: string }> {
  const { targetEmpId, serviceIds, operationalDate, timezone } = args;
  const db = await getPool();

  const empRes = await db.request()
    .input('id', sql.Int, targetEmpId)
    .query(`
      SELECT EmpID, EmpName, ISNULL(isActive, 1) AS isActive, Job
      FROM [dbo].[TblEmp]
      WHERE EmpID = @id
    `);

  const emp = empRes.recordset[0];
  if (!emp) {
    return { ok: false, code: 'BARBER_NOT_FOUND', message: 'الصنايعي غير موجود' };
  }
  if (!emp.isActive) {
    return {
      ok: false,
      code: 'BARBER_INACTIVE',
      message: `${emp.EmpName ?? 'الصنايعي'} غير نشط`,
    };
  }

  const job = (emp.Job ?? '').toString();
  const isBarber = ['حلاق', 'مساعد', 'Barber', 'barber'].includes(job);
  if (!isBarber) {
    return {
      ok: false,
      code: 'NOT_BARBER',
      message: `${emp.EmpName ?? 'الموظف'} ليس صنايعي`,
    };
  }

  const shift = await getBarberShiftBounds(targetEmpId, operationalDate, timezone);
  if (!shift) {
    return {
      ok: false,
      code: 'OUTSIDE_SHIFT',
      message: `${emp.EmpName ?? 'الصنايعي'} غير متاح في هذه الفترة`,
    };
  }

  if (serviceIds.length > 0) {
    const svcRes = await db.request()
      .query(`
        SELECT ProID FROM [dbo].[TblPro] p
        WHERE ProID IN (${serviceIds.join(',')})
          AND (p.isDeleted = 0 OR p.isDeleted IS NULL)
      `);
    const activeIds = new Set(svcRes.recordset.map((r: { ProID: number }) => r.ProID));
    for (const sid of serviceIds) {
      if (!activeIds.has(sid)) {
        return {
          ok: false,
          code: 'SERVICE_UNAVAILABLE',
          message: `${emp.EmpName ?? 'الصنايعي'} لا يقدم إحدى خدمات هذا الموعد`,
        };
      }
    }

    for (const sid of serviceIds) {
      const whitelistRes = await db.request()
        .input('proId', sql.Int, sid)
        .query(`
          SELECT COUNT(*) AS cnt
          FROM [dbo].[TblEmpServiceSettings]
          WHERE ProID = @proId AND IsActive = 1
        `);
      const hasWhitelist = (whitelistRes.recordset[0]?.cnt ?? 0) > 0;
      if (!hasWhitelist) continue;

      const allowedRes = await db.request()
        .input('empId', sql.Int, targetEmpId)
        .input('proId', sql.Int, sid)
        .query(`
          SELECT 1 AS ok
          FROM [dbo].[TblEmpServiceSettings]
          WHERE EmpID = @empId AND ProID = @proId AND IsActive = 1
        `);
      if (!allowedRes.recordset.length) {
        return {
          ok: false,
          code: 'SERVICE_NOT_ELIGIBLE',
          message: `${emp.EmpName ?? 'الصنايعي'} لا يقدم إحدى خدمات هذا الموعد`,
        };
      }
    }
  }

  return { ok: true, empName: emp.EmpName ?? '' };
}

export async function validateBookingMove(args: {
  bookingId: number;
  newStartAt: string;
  operationalDate: string;
  targetEmpId?: number;
}): Promise<BookingMoveValidationResult> {
  const { bookingId, newStartAt, operationalDate, targetEmpId } = args;
  const booking = await loadBookingForReschedule(bookingId);

  if (!booking) {
    return { valid: false, code: 'NOT_FOUND', message: 'حجز غير موجود' };
  }

  if (!isBookingReschedulable(booking.status)) {
    return {
      valid: false,
      code: 'NOT_EDITABLE',
      message: 'لا يمكن نقل هذا الموعد في حالته الحالية',
    };
  }

  const settings = await getPublicSettings();
  const timezone = settings.timezone || SALON_TZ;
  const now = new Date();
  const nowMs = now.getTime();

  const proposedStart = new Date(newStartAt);
  if (Number.isNaN(proposedStart.getTime())) {
    return { valid: false, code: 'INVALID_TIME', message: 'وقت غير صالح' };
  }

  const durationMinutes = booking.durationMinutes;
  const proposedEnd = calculateEndTime(proposedStart, durationMinutes);
  const effectiveEmpId = targetEmpId ?? booking.assignedEmpId;

  const eligibility = await validateTargetBarberEligibility({
    targetEmpId: effectiveEmpId,
    serviceIds: booking.serviceIds,
    operationalDate,
    timezone,
  });
  if (!eligibility.ok) {
    return {
      valid: false,
      code: eligibility.code,
      message: eligibility.message,
    };
  }

  const shift = await getBarberShiftBounds(
    effectiveEmpId,
    operationalDate,
    timezone,
  );
  if (!shift) {
    return {
      valid: false,
      code: 'OUTSIDE_SHIFT',
      message: `لا يمكن نقل الموعد خارج وقت عمل ${eligibility.empName ?? 'الحلاق'}`,
    };
  }

  const db = await getPool();
  const overridesMap = await loadOverridesForDate(db, [effectiveEmpId], operationalDate);
  const baseWindow = await getBarberWorkingWindow(effectiveEmpId, new Date(`${operationalDate}T12:00:00`));
  const base = baseWindow.isWorkingDay && baseWindow.startTime && baseWindow.endTime
    ? { isWorking: true, start: baseWindow.startTime, end: baseWindow.endTime }
    : { isWorking: false, start: '00:00', end: '00:00' };
  const effSched = applyOverrides(
    effectiveEmpId,
    operationalDate,
    base,
    overridesMap.get(effectiveEmpId) ?? [],
  );

  const overrideBlock = effSched
    ? !!slotBlockedByOverride(
        proposedStart.getTime(),
        proposedEnd.getTime(),
        effSched,
      )
    : false;

  const busy = await getEmployeeBusyIntervals({
    empId: effectiveEmpId,
    operationalDate,
    now,
    excludeBookingId: bookingId,
  });

  const evaluation = evaluateBookingSlotAt(
    proposedStart.getTime(),
    durationMinutes,
    busy,
    {
      shiftStartMs: shift.shiftStartMs,
      shiftEndMs: shift.shiftEndMs,
      nowMs,
      minNoticeMs: 0,
      overrideBlock,
    },
  );

  if (evaluation.available) {
    return {
      valid: true,
      targetEmpId: effectiveEmpId,
      targetEmpName: eligibility.empName,
      newStartAt: proposedStart.toISOString(),
      newEndAt: proposedEnd.toISOString(),
      durationMinutes,
    };
  }

  let conflict: BookingMoveValidationResult['conflict'];
  if (evaluation.reasonCode === 'booking_conflict' || evaluation.reasonCode === 'queue_conflict') {
    const overlapping = busy.find((iv) =>
      proposedStart < iv.end && proposedEnd > iv.start,
    );
    if (overlapping) {
      conflict = {
        type: overlapping.source,
        startAt: overlapping.start.toISOString(),
        endAt: overlapping.end.toISOString(),
        reference: overlapping.ticketCode ?? overlapping.label ?? String(overlapping.id),
      };
    }
  } else if (evaluation.reasonCode === 'break') {
    conflict = { type: 'break' };
  } else if (
    evaluation.reasonCode === 'outside_working_hours'
    || evaluation.reasonCode === 'insufficient_continuous_time'
  ) {
    conflict = { type: 'shift' };
  }

  const nextStart = findEarliestAvailableInterval({
    busyIntervals: busy,
    candidateStart: proposedStart,
    durationMinutes,
  });
  const nextAvailable = nextStart
    ? {
        startAt: nextStart.toISOString(),
        endAt: calculateEndTime(nextStart, durationMinutes).toISOString(),
      }
    : undefined;

  return {
    valid: false,
    code: 'SCHEDULE_CONFLICT',
    message: reasonToMessage(evaluation.reasonCode, conflict),
    conflict,
    nextAvailable,
    durationMinutes,
  };
}

export async function rescheduleBookingMove(args: {
  bookingId: number;
  newStartAt: string;
  operationalDate: string;
  source: string;
  userId: number;
  targetEmpId?: number;
}): Promise<{
  bookingId: number;
  oldStartAt: string;
  oldEndAt: string;
  oldEmpId: number;
  oldEmpName: string | null;
  newStartAt: string;
  newEndAt: string;
  newEmpId: number;
  newEmpName: string | null;
  durationMinutes: number;
  customerName: string | null;
}> {
  const { bookingId, newStartAt, operationalDate, source, userId, targetEmpId } = args;

  const preCheck = await validateBookingMove({
    bookingId,
    newStartAt,
    operationalDate,
    targetEmpId,
  });
  if (!preCheck.valid || !preCheck.newStartAt || !preCheck.newEndAt) {
    const err = new ScheduleConflictError(
      preCheck.message ?? 'الفترة غير متاحة',
      {
        type: preCheck.conflict?.type === 'queue' ? 'queue' : 'booking',
        id: 0,
        startAt: preCheck.conflict?.startAt ?? '',
        endAt: preCheck.conflict?.endAt ?? '',
        reference: preCheck.conflict?.reference,
      },
    );
    throw err;
  }

  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const booking = await loadBookingForReschedule(bookingId);
    if (!booking) {
      await transaction.rollback();
      throw new Error('حجز غير موجود');
    }

    if (!isBookingReschedulable(booking.status)) {
      await transaction.rollback();
      throw new ScheduleConflictError('لا يمكن نقل هذا الموعد في حالته الحالية', {
        type: 'booking',
        id: bookingId,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
      });
    }

    const proposedStart = new Date(newStartAt);
    const durationMinutes = booking.durationMinutes;
    const proposedEnd = calculateEndTime(proposedStart, durationMinutes);
    const effectiveEmpId = targetEmpId ?? booking.assignedEmpId;
    const isCrossBarber = effectiveEmpId !== booking.assignedEmpId;

    await acquireScheduleLocksSorted(
      transaction,
      [booking.assignedEmpId, effectiveEmpId],
      operationalDate,
    );

    await assertEmployeeIntervalAvailable({
      empId: effectiveEmpId,
      startAt: proposedStart,
      endAt: proposedEnd,
      operationalDate,
      excludeBookingId: bookingId,
      transaction,
    });

    const settings = await getPublicSettings();
    const timezone = settings.timezone || SALON_TZ;
    const startTimeStr = `${msToHhmm(proposedStart.getTime(), timezone)}:00`;
    const endTimeStr = `${msToHhmm(proposedEnd.getTime(), timezone)}:00`;

    const bookingDateForRow = sqlDateToYyyyMmDd(
      createCairoDateTime(operationalDate, msToHhmm(proposedStart.getTime(), timezone)),
    );

    const oldStartDisplay = formatTimeArabic(booking.startAt);
    const newStartDisplay = formatTimeArabic(proposedStart);
    let newEmpName = booking.empName;
    if (isCrossBarber) {
      const nameRes = await transaction.request()
        .input('id', sql.Int, effectiveEmpId)
        .query(`SELECT EmpName FROM [dbo].[TblEmp] WHERE EmpID = @id`);
      newEmpName = nameRes.recordset[0]?.EmpName ?? null;
    }

    const auditNote = source === 'operations_cut_paste'
      ? `قص/لصق: ${oldStartDisplay}→${newStartDisplay}${isCrossBarber ? ` (${booking.empName ?? booking.assignedEmpId}→${newEmpName ?? effectiveEmpId})` : ''} (م${userId})`
      : `تعديل وقت بالسحب: ${oldStartDisplay}→${newStartDisplay} (م${userId})`;
    const mergedNotes = mergeBookingNotes(booking.notes, auditNote);

    await transaction.request()
      .input('id', sql.Int, bookingId)
      .input('empId', sql.Int, effectiveEmpId)
      .input('bDate', sql.Date, bookingDateForRow)
      .input('sTime', sql.VarChar, startTimeStr)
      .input('eTime', sql.VarChar, endTimeStr)
      .input('notes', sql.NVarChar, mergedNotes)
      .query(`
        UPDATE [dbo].[Bookings]
        SET AssignedEmpID = @empId,
            BookingDate = @bDate,
            StartTime = @sTime,
            EndTime = @eTime,
            Notes = @notes,
            UpdatedAt = GETDATE()
        WHERE BookingID = @id
      `);

    if (isCrossBarber) {
      await transaction.request()
        .input('id', sql.Int, bookingId)
        .input('empId', sql.Int, effectiveEmpId)
        .query(`
          UPDATE [dbo].[BookingServices]
          SET EmpID = @empId
          WHERE BookingID = @id
        `);
    }

    await transaction.commit();

    return {
      bookingId,
      oldStartAt: booking.startAt.toISOString(),
      oldEndAt: booking.endAt.toISOString(),
      oldEmpId: booking.assignedEmpId,
      oldEmpName: booking.empName,
      newStartAt: proposedStart.toISOString(),
      newEndAt: proposedEnd.toISOString(),
      newEmpId: effectiveEmpId,
      newEmpName,
      durationMinutes,
      customerName: booking.clientName,
    };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}
