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
import { slotBlockedByOverride } from '@/lib/scheduleOverrides';
import { salonDateTimeToMs, getGlobalTimingDefaults } from '@/lib/publicBookingHelpers';
import { getDefaultDuration } from '@/lib/queueEstimateEngine';
import { resolveEmployeeDayPlan } from '@/lib/availability/resolveEmployeeDayPlan';
import type { DayPlanWindow } from '@/lib/availability/resolveEmployeeDayPlan';
import {
  findWindowContainingInterval,
  normalizeEffectiveWindows,
  outerDisplayBounds,
} from '@/lib/availability/effectiveWindows';
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
  /** Booking's branch when present — used for day-plan resolution. */
  branchId: number | null;
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
        b.BranchID,
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
    branchId:
      booking.BranchID != null && Number.isFinite(Number(booking.BranchID))
        ? Number(booking.BranchID)
        : null,
  };
}

/**
 * Canonical day-plan shift bounds (Phase 2).
 * Uses resolveEmployeeDayPlan — no local override apply / TblEmpWorkSchedule probe.
 */
async function getBarberShiftBounds(
  empId: number,
  operationalDate: string,
  branchId: number | null,
  timezone: string,
): Promise<{
  shiftStartMs: number;
  shiftEndMs: number;
  effSched: NonNullable<Awaited<ReturnType<typeof resolveEmployeeDayPlan>>['effSched']>;
  denyReasonCode: string | null;
  baseScheduleSource: string;
  isWorking: boolean;
  effectiveWindows: DayPlanWindow[];
}> {
  const plan = await resolveEmployeeDayPlan({
    empId,
    businessDate: operationalDate,
    branchId,
    source: 'operations',
  });

  if (!plan.isWorking || !plan.effSched) {
    return {
      shiftStartMs: 0,
      shiftEndMs: 0,
      effSched: plan.effSched ?? {
        isWorking: false,
        start: '00:00',
        end: '00:00',
        blockedIntervals: [],
        appliedOverride: null,
      },
      denyReasonCode: plan.denyReasonCode,
      baseScheduleSource: plan.baseScheduleSource,
      isWorking: false,
      effectiveWindows: [],
    };
  }

  const windows = normalizeEffectiveWindows(plan.effectiveWindows);
  const outer = outerDisplayBounds(windows);
  const shiftStartMs =
    outer?.startMs ?? salonDateTimeToMs(operationalDate, plan.effSched.start, timezone);
  const shiftEndMs =
    outer?.endMs
    ?? (plan.isOvernight
      ? salonDateTimeToMs(nextDate(operationalDate), plan.effSched.end, timezone)
      : salonDateTimeToMs(operationalDate, plan.effSched.end, timezone));

  return {
    shiftStartMs,
    shiftEndMs,
    effSched: plan.effSched,
    denyReasonCode: null,
    baseScheduleSource: plan.baseScheduleSource,
    isWorking: true,
    effectiveWindows: windows,
  };
}

function dayPlanDenyToMoveCode(
  deny: string | null,
  baseScheduleSource: string,
  empName: string,
): {
  code: string;
  message: string;
} {
  if (
    deny === 'SCHEDULE_NOT_CONFIGURED'
    || deny === 'FREELANCER_NOT_PLANNED'
    || baseScheduleSource === 'NONE'
  ) {
    return {
      code: 'NO_SCHEDULE',
      message: 'لا يوجد جدول عمل أسبوعي لهذا الموظف',
    };
  }
  if (deny === 'EMPLOYEE_ABSENT') {
    return {
      code: 'OUTSIDE_SHIFT',
      message: 'الحلاق غائب في هذا اليوم',
    };
  }
  if (deny === 'EMPLOYEE_OFF_DAY') {
    return {
      code: 'OUTSIDE_SHIFT',
      message: 'الحلاق في إجازة في هذا اليوم',
    };
  }
  return {
    code: 'OUTSIDE_SHIFT',
    message: `لا يمكن نقل الموعد خارج وقت عمل ${empName || 'الحلاق'}`,
  };
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
/** Dev-only structured diagnostics for the booking-move flow. */
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

  const branchId = booking.branchId;
  const shift = await getBarberShiftBounds(
    effectiveEmpId,
    operationalDate,
    branchId,
    timezone,
  );
  if (!shift.isWorking || !shift.effSched.isWorking || !shift.effectiveWindows.length) {
    const mapped = dayPlanDenyToMoveCode(
      shift.denyReasonCode,
      shift.baseScheduleSource,
      eligibility.empName,
    );
    return {
      valid: false,
      code: mapped.code,
      message: mapped.message,
      details: { employeeId: effectiveEmpId, employeeName: eligibility.empName },
    };
  }

  // Gap / cross-window rejection before conflict checks.
  if (
    !findWindowContainingInterval({
      windows: shift.effectiveWindows,
      startMs: proposedStart.getTime(),
      endMs: proposedEnd.getTime(),
    })
  ) {
    return {
      valid: false,
      code: 'OUTSIDE_SHIFT',
      message: 'خارج وقت العمل',
      details: { employeeId: effectiveEmpId, employeeName: eligibility.empName },
    };
  }

  const effSched = shift.effSched;
  const overrideBlockReason = slotBlockedByOverride(
    proposedStart.getTime(),
    proposedEnd.getTime(),
    effSched,
  );
  const overrideBlock = !!overrideBlockReason;

  const busy = await getEmployeeBusyIntervals({
    empId: effectiveEmpId,
    operationalDate,
    now,
    excludeBookingId: bookingId,
    branchId,
    schedule: {
      shiftStartMs: shift.shiftStartMs,
      shiftEndMs: shift.shiftEndMs,
      effSched,
      isWorking: true,
      effectiveWindows: shift.effectiveWindows,
    },
  });

  const evaluation = evaluateBookingSlotAt(
    proposedStart.getTime(),
    durationMinutes,
    busy,
    {
      shiftStartMs: shift.shiftStartMs,
      shiftEndMs: shift.shiftEndMs,
      effectiveWindows: shift.effectiveWindows,
      nowMs,
      minNoticeMs: 0,
      overrideBlock,
      overrideBlockReason,
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
      branchId: booking.branchId,
      transaction,
    });

    // B6 dual-guard: secure NEW claims then release OLD-only (same TX) before row update.
    {
      const {
        claimTxFromBookingTransaction,
        enforceAtomicRescheduleInTx,
        isSlotClaimConflictError,
      } = await import('@/lib/booking/claims/slotClaimIntegration');
      try {
        await enforceAtomicRescheduleInTx(
          claimTxFromBookingTransaction(transaction),
          {
            bookingId,
            empId: effectiveEmpId,
            branchId: booking.branchId ?? 0,
            newStartAt: proposedStart,
            newEndAt: proposedEnd,
          },
        );
      } catch (claimErr) {
        if (isSlotClaimConflictError(claimErr)) {
          await transaction.rollback();
          throw new ScheduleConflictError('الفترة غير متاحة', {
            type: 'booking',
            id: bookingId,
            startAt: proposedStart.toISOString(),
            endAt: proposedEnd.toISOString(),
          });
        }
        throw claimErr;
      }
    }

    const settings = await getGlobalTimingDefaults();
    const timezone = settings.timezone || SALON_TZ;
    const startTimeStr = `${msToHhmm(proposedStart.getTime(), timezone)}:00`;
    const endTimeStr = `${msToHhmm(proposedEnd.getTime(), timezone)}:00`;

    const bookingDateForRow = sqlDateToYyyyMmDd(
      createCairoDateTime(operationalDate, msToHhmm(proposedStart.getTime(), timezone)),
    );

    // Absolute SoT from BusinessDate model (not display-only fields).
    let publicDayOffset: 0 | 1 = bookingDateForRow === operationalDate ? 0 : 1;
    try {
      const { createBookingInterval } = await import(
        '@/lib/booking/domain/BookingInterval'
      );
      const absInterval = createBookingInterval({
        businessDate: operationalDate,
        startAtMs: proposedStart.getTime(),
        endAtMs: proposedEnd.getTime(),
        timeZone: timezone,
      });
      publicDayOffset = absInterval.legacyDayOffset;
    } catch {
      /* fallback above */
    }

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
      .input('absStart', sql.DateTime2, proposedStart)
      .input('absEnd', sql.DateTime2, proposedEnd)
      .input('workDate', sql.Date, operationalDate)
      .input('dayOffset', sql.TinyInt, publicDayOffset)
      .query(`
        UPDATE [dbo].[Bookings]
        SET AssignedEmpID = @empId,
            BookingDate = @bDate,
            StartTime = @sTime,
            EndTime = @eTime,
            Notes = @notes,
            AbsoluteStartUtc = @absStart,
            AbsoluteEndUtc = @absEnd,
            PublicWorkDate = @workDate,
            PublicDayOffset = @dayOffset,
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

    try {
      const { shadowAtomicReschedule } = await import(
        '@/lib/booking/claims/slotClaimIntegration'
      );
      await shadowAtomicReschedule({
        bookingId,
        empId: effectiveEmpId,
        branchId: booking.branchId ?? 0,
        oldStartAt: booking.startAt,
        oldEndAt: booking.endAt,
        newStartAt: proposedStart,
        newEndAt: proposedEnd,
        businessDate: operationalDate,
      });
    } catch {
      /* shadow-safe */
    }

    try {
      const { invalidateOnBookingRescheduled } = await import(
        '@/lib/booking/cache/HotAvailabilityInvalidation'
      );
      await invalidateOnBookingRescheduled({
        employeeId: effectiveEmpId,
        oldEmployeeId: booking.assignedEmpId,
        oldBusinessDate: booking.bookingDate,
        newBusinessDate: operationalDate,
        oldBranchId: booking.branchId,
        newBranchId: booking.branchId,
      });
    } catch {
      /* hot cache optional */
    }

    try {
      const { scheduleBookingEventWhatsApp } = await import(
        '@/lib/booking/bookingEventWhatsApp'
      );
      const { loadBookingCustomerContact } = await import(
        '@/lib/booking/bookingCustomerContact'
      );
      const contact = await loadBookingCustomerContact(bookingId);
      const dateStr = bookingDateForRow;
      const timeStr = msToHhmm(proposedStart.getTime(), timezone);
      await scheduleBookingEventWhatsApp({
        bookingId,
        bookingCode: contact?.bookingCode ?? booking.bookingCode ?? `BK-${bookingId}`,
        eventType: 'move',
        eventVersion: `${proposedStart.toISOString()}:${effectiveEmpId}`,
        phone: contact?.phone ?? null,
        customerName: contact?.customerName ?? booking.clientName,
        bookingDate: dateStr,
        bookingTime: timeStr,
        barberName: newEmpName,
        branchName: contact?.branchName ?? null,
        servicesSummary: contact?.servicesSummary ?? null,
      });
    } catch {
      /* notify best-effort; move already committed */
    }

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
