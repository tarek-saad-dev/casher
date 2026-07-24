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
  applyOverrides,
  slotBlockedByOverride,
} from '@/lib/scheduleOverrides';
import { loadBookingOverridesForDate } from '@/lib/hr/attendance-shift-schedule-sync';
import { salonDateTimeToMs, getGlobalTimingDefaults } from '@/lib/publicBookingHelpers';
import { getDefaultDuration } from '@/lib/queueEstimateEngine';
import {
  validateEmployeeSupportsServices,
  buildUnsupportedServicesMessage,
  type UnsupportedService,
} from '@/lib/employeeServiceEligibility';

/** dbo.Bookings.Notes column limit (see db/migrations/queue-booking-system.sql) */
export const BOOKING_NOTES_MAX_LENGTH = 500;

/** Dev-only diagnostics for the booking-move flow. Enable with DEBUG_BOOKING_MOVE=1. */
const DEBUG_BOOKING_MOVE = process.env.DEBUG_BOOKING_MOVE === '1';

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
  details?: {
    employeeId?: number;
    employeeName?: string;
    unsupportedServices?: UnsupportedService[];
  };
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

  const overridesMap = await loadBookingOverridesForDate(db, [empId], operationalDate);
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

type EligibilityResult =
  | { ok: true; empName: string }
  | {
      ok: false;
      code: string;
      message: string;
      employeeName?: string;
      unsupportedServices?: UnsupportedService[];
    };

/**
 * Dev-only structured diagnostics for the booking-move flow.
 * Never logs customer private data (no client name / mobile / notes).
 */
function logMoveDiagnostics(info: {
  bookingId: number;
  targetEmployeeId: number;
  targetEmployeeName: string | null;
  requiredServiceIds: number[];
  assignedServiceIds: number[] | null;
  unsupportedServiceIds: number[];
  scheduleStatus: string;
  overrideStatus: string;
  conflictStatus: string;
}): void {
  console.log('[booking-move diagnostics]', JSON.stringify(info));
}

/** Does this employee have ANY weekly schedule rows configured at all? */
async function hasWeeklySchedule(empId: number): Promise<boolean> {
  const db = await getPool();
  try {
    const res = await db.request()
      .input('id', sql.Int, empId)
      .query(`
        SELECT TOP 1 1 AS ok
        FROM [dbo].[TblEmpWorkSchedule]
        WHERE EmpID = @id
      `);
    return res.recordset.length > 0;
  } catch {
    return false;
  }
}

/**
 * Verify the target barber exists, is active, is a barber, and can perform every
 * booking service. Schedule / shift eligibility is validated separately by the
 * caller so failures surface in the correct priority order.
 */
export async function validateTargetBarberEligibility(args: {
  targetEmpId: number;
  serviceIds: number[];
}): Promise<EligibilityResult> {
  const { targetEmpId, serviceIds } = args;
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
      employeeName: emp.EmpName ?? undefined,
    };
  }

  const job = (emp.Job ?? '').toString();
  const isBarber = ['حلاق', 'مساعد', 'Barber', 'barber'].includes(job);
  if (!isBarber) {
    return {
      ok: false,
      code: 'NOT_BARBER',
      message: `${emp.EmpName ?? 'الموظف'} ليس صنايعي`,
      employeeName: emp.EmpName ?? undefined,
    };
  }

  // Service compatibility — single shared rule used by every booking flow.
  const support = await validateEmployeeSupportsServices({
    employeeId: targetEmpId,
    serviceIds,
  });
  if (!support.valid) {
    return {
      ok: false,
      code: 'EMPLOYEE_SERVICE_UNSUPPORTED',
      message: buildUnsupportedServicesMessage(emp.EmpName, support.unsupportedServices),
      employeeName: emp.EmpName ?? undefined,
      unsupportedServices: support.unsupportedServices,
    };
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

  const settings = await getGlobalTimingDefaults();
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
  });
  if (!eligibility.ok) {
    if (DEBUG_BOOKING_MOVE) {
      logMoveDiagnostics({
        bookingId,
        targetEmployeeId: effectiveEmpId,
        targetEmployeeName: eligibility.employeeName ?? null,
        requiredServiceIds: booking.serviceIds,
        assignedServiceIds: null,
        unsupportedServiceIds:
          eligibility.unsupportedServices?.map((s) => s.serviceId) ?? [],
        scheduleStatus: 'not_checked',
        overrideStatus: 'not_checked',
        conflictStatus: 'not_checked',
      });
    }
    return {
      valid: false,
      code: eligibility.code,
      message: eligibility.message,
      details: {
        employeeId: effectiveEmpId,
        employeeName: eligibility.employeeName,
        unsupportedServices: eligibility.unsupportedServices,
      },
    };
  }

  const shift = await getBarberShiftBounds(
    effectiveEmpId,
    operationalDate,
    timezone,
  );
  if (!shift) {
    // Distinguish "no weekly schedule configured at all" from "off this shift"
    // so admins get a precise, actionable reason.
    const scheduled = await hasWeeklySchedule(effectiveEmpId);
    if (!scheduled) {
      return {
        valid: false,
        code: 'NO_SCHEDULE',
        message: 'لا يوجد جدول عمل أسبوعي لهذا الموظف',
        details: { employeeId: effectiveEmpId, employeeName: eligibility.empName },
      };
    }
    return {
      valid: false,
      code: 'OUTSIDE_SHIFT',
      message: `لا يمكن نقل الموعد خارج وقت عمل ${eligibility.empName ?? 'الحلاق'}`,
      details: { employeeId: effectiveEmpId, employeeName: eligibility.empName },
    };
  }

  const db = await getPool();
  const overridesMap = await loadBookingOverridesForDate(db, [effectiveEmpId], operationalDate);
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

  if (DEBUG_BOOKING_MOVE) {
    logMoveDiagnostics({
      bookingId,
      targetEmployeeId: effectiveEmpId,
      targetEmployeeName: eligibility.empName ?? null,
      requiredServiceIds: booking.serviceIds,
      assignedServiceIds: booking.serviceIds,
      unsupportedServiceIds: [],
      scheduleStatus: 'ok',
      overrideStatus: overrideBlock ? 'blocked' : 'ok',
      conflictStatus: evaluation.available ? 'none' : (evaluation.reasonCode ?? 'conflict'),
    });
  }

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
    // Preserve the precise failure code so the client can render the exact reason.
    if (preCheck.code) err.code = preCheck.code;
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

    // Authoritative service-compatibility re-check inside the transaction — the
    // pre-validation may be stale if services or the target barber changed. Uses
    // the same shared rule as every other flow.
    const support = await validateEmployeeSupportsServices({
      employeeId: effectiveEmpId,
      serviceIds: booking.serviceIds,
      transaction,
    });
    if (!support.valid) {
      await transaction.rollback();
      const empNameRes = await db.request()
        .input('id', sql.Int, effectiveEmpId)
        .query(`SELECT EmpName FROM [dbo].[TblEmp] WHERE EmpID = @id`);
      const empName = empNameRes.recordset[0]?.EmpName ?? null;
      const err = new ScheduleConflictError(
        buildUnsupportedServicesMessage(empName, support.unsupportedServices),
        { type: 'booking', id: bookingId, startAt: '', endAt: '' },
      );
      err.code = 'EMPLOYEE_SERVICE_UNSUPPORTED';
      throw err;
    }

    await assertEmployeeIntervalAvailable({
      empId: effectiveEmpId,
      startAt: proposedStart,
      endAt: proposedEnd,
      operationalDate,
      excludeBookingId: bookingId,
      transaction,
    });

    const settings = await getGlobalTimingDefaults();
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
