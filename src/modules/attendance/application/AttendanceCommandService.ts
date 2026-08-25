/**
 * Attendance write commands.
 * Phase B1 — admin PUT (saveAdminAttendance).
 * Phase B2 — legacy employees POST (saveLegacyEmployeeAttendance).
 * Phase B3 — legacy employees PUT :id (updateLegacyEmployeeAttendanceById).
 * Phase B4 — admin bulk PUT (saveAdminAttendanceBulk). Do not loop saveAdminAttendance.
 * Phase B5 — workOnDayOff + restorePresent (ops punch writers). Do not share OPEN policy.
 * Phase B6 — schedule-control day_off apply + tagged Absent revert. Best-effort.
 */
import { calcLateMinutes, calcEarlyLeaveMinutes } from '@/lib/timeUtils';
import { resolveScheduleForDay } from '@/lib/hr/attendance-eligibility';
import { normalizeEmploymentType } from '@/lib/hr/employee-hr-model';
import { replaceAttendanceBreaks } from '@/lib/hr/attendance-breaks-db';
import { replaceAttendanceBreakTimes } from '@/lib/hr/attendance-break-time-db';
import { normalizeBreaksInput } from '@/lib/hr/attendance-breaks';
import {
  syncBlockRangesFromBreaks,
  syncBlockRangesFromBreakTimes,
} from '@/lib/hr/attendance-break-schedule-sync';
import {
  syncAttendanceShiftToOverrides,
  syncAttendanceAbsenceToDayOffOverride,
} from '@/lib/hr/attendance-shift-schedule-sync';
import { scheduleAttendanceCheckInOutWhatsApp } from '@/lib/services/employeeAttendanceWhatsAppNotify';
import { assertEmployeeEligibleForBranchAttendance } from '@/lib/hr/attendance/branchAttendance.service';
import {
  unlockScheduleForWorkOnDayOff,
} from '@/lib/hr/attendance/workOnDayOff.service';
import { getEffectiveBranchScheduleRow } from '@/lib/hr/empBranchWorkSchedule';
import { getCairoTimeStr } from '@/lib/businessDate';
import { cairoTimeStr, getBarberDayStatus } from '@/lib/availabilityEngine';
import { getBranchById } from '@/lib/branch/repository';
import { ensureAttendanceBreakSchema } from '@/lib/hr/attendance-breaks-db';
import { ensureAttendanceBreakTimeSchema } from '@/lib/hr/attendance-break-time-db';
import { assertEmpBranchWorkDayMutable } from '@/lib/hr/empBranchWorkDayClose.service';
import {
  ADMIN_PUT_ALREADY_OPEN_CODE,
  ADMIN_PUT_ALREADY_OPEN_MESSAGE,
  ADMIN_PUT_VALID_STATUSES,
  ADMIN_PUT_WORK_ON_DAY_OFF_REASON,
  ADMIN_PUT_WORK_ON_DAY_OFF_SOURCE_TAG,
  AttendanceCommandError,
  resolveAdminPutAttendanceStatus,
  type SaveAdminAttendanceInput,
  type SaveAdminAttendanceResult,
} from '../domain/adminPutAttendance';
import {
  LEGACY_EMPLOYEES_POST_ALREADY_OPEN_CODE,
  LEGACY_EMPLOYEES_POST_ALREADY_OPEN_MESSAGE,
  LEGACY_EMPLOYEES_POST_EMP_NOT_FOUND_MESSAGE,
  LEGACY_EMPLOYEES_POST_NOTIFIER_REASON,
  LEGACY_EMPLOYEES_PUT_BY_ID_NOT_FOUND_MESSAGE,
  LEGACY_EMPLOYEES_PUT_BY_ID_NO_PATCH_MESSAGE,
  LEGACY_EMPLOYEES_PUT_BY_ID_NOTIFIER_REASON,
  type SaveLegacyEmployeeAttendanceInput,
  type SaveLegacyEmployeeAttendanceResult,
  type UpdateLegacyEmployeeAttendanceByIdInput,
  type UpdateLegacyEmployeeAttendanceByIdResult,
} from '../domain/legacyEmployeeAttendance';
import {
  ADMIN_BULK_WORK_ON_DAY_OFF_REASON,
  ADMIN_BULK_WORK_ON_DAY_OFF_SOURCE_TAG,
  type SaveAdminAttendanceBulkInput,
  type SaveAdminAttendanceBulkItem,
  type SaveAdminAttendanceBulkSummary,
} from '../domain/adminAttendanceBulk';
import {
  WORK_ON_DAY_OFF_SOURCE_TAG,
  type WorkOnDayOffInput,
  type WorkOnDayOffResult,
} from '../domain/workOnDayOff';
import {
  RESTORE_PRESENT_DAY_OFF_SOURCE,
  RESTORE_PRESENT_INACTIVE_BRANCH_MESSAGE,
  RESTORE_PRESENT_PAST_DATE_MESSAGE,
  RESTORE_PRESENT_SOURCE,
  type RestorePresentInput,
  type RestorePresentResult,
} from '../domain/restorePresent';
import {
  SCHEDULE_CONTROL_DAY_OFF_SOURCE,
  type ApplyScheduleControlDayOffAttendanceInput,
} from '../domain/scheduleControlDayOff';
import {
  SCHEDULE_CONTROL_DAY_OFF_REVERT_SOURCE,
  type RevertScheduleControlDayOffAttendanceInput,
  type RevertScheduleControlDayOffAttendanceResult,
} from '../domain/scheduleControlRevert';
import type { MarkAutoAbsenceAttendanceInput } from '../domain/autoAbsenceAttendance';
import type { PersistNightlyDefaultFillAttendanceInput } from '../domain/nightlyFinalizeAttendance';
import type {
  RelocateClosedAttendanceFromBranchInput,
  RelocateClosedAttendanceTowardDestinationInput,
} from '../domain/relocateAttendance';
import {
  willResultInOpenSession,
} from '../domain/attendanceSessionPolicy';
import * as attendanceRepo from '../infra/AttendanceRepository';
import { ensurePresentAttendancePlaceholder } from './ensurePresentAttendancePlaceholder';
import {
  acquireActiveSessionLock,
  assertActiveOpenAllowed,
  beginActiveSessionGuard,
} from './assertActiveSessionAllowsOpen';

const TIME_RE = /^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;

export const AttendanceCommandService = {
  saveAdminPut: saveAdminAttendance,
  saveLegacyEmployeeAttendance,
  updateLegacyEmployeeAttendanceById,
  saveAdminAttendanceBulk,
  workOnDayOff,
  restorePresent,
  applyScheduleControlDayOffAttendance,
  revertScheduleControlDayOffAttendance,
  markAutoAbsenceAttendance,
  persistNightlyDefaultFillAttendance,
  relocateClosedAttendanceFromBranch,
  relocateClosedAttendanceTowardDestination,
  ensurePresentAttendancePlaceholder,
};

export async function saveAdminAttendance(
  input: SaveAdminAttendanceInput,
): Promise<SaveAdminAttendanceResult> {
  const branchId = input.branchId;
  const WorkDate = input.workDate;
  const EmpID = input.empId;
  const CheckInTime = input.checkInTime as string | undefined;
  const CheckOutTime = input.checkOutTime as string | undefined;
  const Status = input.status as string | undefined;
  const Notes = input.notes as string | undefined;
  const Breaks = input.breaks;
  const BreakTimes = input.breakTimes;

  await assertEmpBranchWorkDayMutable(branchId, WorkDate);

  if (
    Status &&
    !ADMIN_PUT_VALID_STATUSES.includes(Status as (typeof ADMIN_PUT_VALID_STATUSES)[number])
  ) {
    throw new AttendanceCommandError('حالة غير صحيحة', 400);
  }

  if (CheckInTime && !TIME_RE.test(CheckInTime)) {
    throw new AttendanceCommandError('صيغة وقت الحضور غير صحيحة', 400);
  }
  if (CheckOutTime && !TIME_RE.test(CheckOutTime)) {
    throw new AttendanceCommandError('صيغة وقت الانصراف غير صحيحة', 400);
  }

  const clearBreaks =
    Status === 'Absent' || Status === 'DayOff' || (!CheckInTime && !CheckOutTime);
  let parsedBreaks = {
    breaks: [] as ReturnType<typeof normalizeBreaksInput>['breaks'],
    breakMinutesTotal: 0,
    error: null as string | null,
  };
  if (Breaks !== undefined || clearBreaks) {
    parsedBreaks = clearBreaks
      ? { breaks: [], breakMinutesTotal: 0, error: null }
      : normalizeBreaksInput(Breaks);
    if (parsedBreaks.error) {
      throw new AttendanceCommandError(parsedBreaks.error, 400);
    }
  }

  let parsedBreakTimes = {
    breaks: [] as ReturnType<typeof normalizeBreaksInput>['breaks'],
    breakMinutesTotal: 0,
    error: null as string | null,
  };
  if (BreakTimes !== undefined || clearBreaks) {
    parsedBreakTimes = clearBreaks
      ? { breaks: [], breakMinutesTotal: 0, error: null }
      : normalizeBreaksInput(BreakTimes);
    if (parsedBreakTimes.error) {
      throw new AttendanceCommandError(
        parsedBreakTimes.error.replace(/مستقطع/g, 'بريك'),
        400,
      );
    }
  }

  const dbPool = await attendanceRepo.getAttendanceDb();
  await attendanceRepo.ensureAttendanceTable(dbPool);

  try {
    await assertEmployeeEligibleForBranchAttendance(Number(EmpID), branchId, WorkDate);
  } catch (eligErr) {
    if (eligErr instanceof Error && 'statusCode' in eligErr) {
      const e = eligErr as { message: string; statusCode: number; code?: string };
      throw new AttendanceCommandError(e.message, e.statusCode, e.code);
    }
    throw eligErr;
  }

  const existingPeek = await attendanceRepo.findBranchDayAttendance(
    dbPool,
    EmpID,
    WorkDate,
    branchId,
  );

  const creatingOpen = willResultInOpenSession(
    CheckInTime as string | undefined,
    CheckOutTime as string | undefined,
  );

  let db: attendanceRepo.AttendanceDb = dbPool;
  let activeTxn: attendanceRepo.AttendanceTransaction | null = null;
  if (creatingOpen) {
    const guard = await beginActiveSessionGuard({
      empId: Number(EmpID),
      candidateWorkDate: WorkDate,
      excludeAttendanceId: existingPeek?.ID ?? null,
      message: ADMIN_PUT_ALREADY_OPEN_MESSAGE,
      code: ADMIN_PUT_ALREADY_OPEN_CODE,
    });
    db = guard.txDb;
    activeTxn = guard.transaction;
  }

  try {
  const emp = await attendanceRepo.loadEmployeeScheduleForAdminPut(
    db,
    EmpID,
    WorkDate,
    branchId,
  );

  let schedStart: string | null = null;
  let schedEnd: string | null = null;
  let employeeName: string | undefined;
  if (emp) {
    employeeName = emp.EmpName?.trim() || undefined;
    const employmentType = normalizeEmploymentType(emp.EmploymentType as string) ?? 'full_time';
    const schedule = resolveScheduleForDay(employmentType, {
      hasScheduleRow: emp.ScheduleDayOfWeek != null,
      isWorkingDayFromSchedule:
        emp.ScheduleDayOfWeek != null ? !!emp.IsWorkingDay : null,
      scheduleStart: emp.ScheduleStartTime || null,
      scheduleEnd: emp.ScheduleEndTime || null,
      defaultStart: emp.DefaultCheckInTime || null,
      defaultEnd: emp.DefaultCheckOutTime || null,
    });
    schedStart = schedule.scheduledStart;
    schedEnd = schedule.scheduledEnd;
  }

  const lateMinutes = calcLateMinutes(CheckInTime || null, schedStart);
  const earlyLeaveMinutes = calcEarlyLeaveMinutes(CheckOutTime || null, schedEnd);

  const finalStatus = resolveAdminPutAttendanceStatus({
    clientStatus: Status,
    checkInTime: CheckInTime,
    checkOutTime: CheckOutTime,
    lateMinutes,
    earlyLeaveMinutes,
  });

  const isWorkingDayFromSchedule =
    emp?.ScheduleDayOfWeek != null ? !!emp.IsWorkingDay : null;
  if (
    CheckInTime &&
    !['Absent', 'DayOff', 'Excused'].includes(finalStatus) &&
    isWorkingDayFromSchedule === false
  ) {
    await unlockScheduleForWorkOnDayOff({
      empId: Number(EmpID),
      date: WorkDate,
      branchId,
      reason: ADMIN_PUT_WORK_ON_DAY_OFF_REASON,
      sourceTag: ADMIN_PUT_WORK_ON_DAY_OFF_SOURCE_TAG,
    }).catch((err) => {
      console.warn('[api/admin/attendance] day-off unlock failed', err);
    });
  }

  const existing = existingPeek ?? (await attendanceRepo.findBranchDayAttendance(
    db,
    EmpID,
    WorkDate,
    branchId,
  ));
  const previousCheckIn = existing?.CheckInTime ?? null;
  const previousCheckOut = existing?.CheckOutTime ?? null;

  let attendanceId: number;
  if (existing) {
    attendanceId = existing.ID;
    await attendanceRepo.updateBranchDayAttendance({
      db,
      id: attendanceId,
      branchId,
      checkInTime: CheckInTime,
      checkOutTime: CheckOutTime,
      status: finalStatus,
      lateMinutes,
      earlyLeaveMinutes,
      notes: (Notes as string) || null,
      scheduledStart: schedStart,
      scheduledEnd: schedEnd,
      updatedBy: input.userId,
    });
  } else {
    attendanceId = await attendanceRepo.insertBranchDayAttendance({
      db,
      branchId,
      empId: EmpID,
      workDate: WorkDate,
      checkInTime: CheckInTime,
      checkOutTime: CheckOutTime,
      status: finalStatus,
      lateMinutes,
      earlyLeaveMinutes,
      notes: (Notes as string) || null,
      scheduledStart: schedStart,
      scheduledEnd: schedEnd,
      createdBy: input.userId,
    });
  }

  let breakMinutesTotal: number | undefined;
  if (Breaks !== undefined || clearBreaks) {
    breakMinutesTotal = await replaceAttendanceBreaks(
      db,
      attendanceId,
      parsedBreaks.breaks,
    );
    await syncBlockRangesFromBreaks(db, EmpID, WorkDate, parsedBreaks.breaks).catch(
      (err) => {
        console.warn('[api/admin/attendance] block_range sync failed', err);
      },
    );
  }

  let breakTimeMinutesTotal: number | undefined;
  if (BreakTimes !== undefined || clearBreaks) {
    breakTimeMinutesTotal = await replaceAttendanceBreakTimes(
      db,
      attendanceId,
      parsedBreakTimes.breaks,
    );
    await syncBlockRangesFromBreakTimes(
      db,
      EmpID,
      WorkDate,
      parsedBreakTimes.breaks,
    ).catch((err) => {
      console.warn('[api/admin/attendance] break-time block_range sync failed', err);
    });
  }

  await syncAttendanceShiftToOverrides(db, EmpID, WorkDate, {
    checkInTime: CheckInTime || null,
    checkOutTime: CheckOutTime || null,
    scheduledStart: schedStart,
    scheduledEnd: schedEnd,
    status: finalStatus,
  }).catch((err) => {
    console.warn('[api/admin/attendance] shift override sync failed', err);
  });

  await syncAttendanceAbsenceToDayOffOverride(db, EmpID, WorkDate, finalStatus).catch(
    (err) => {
      console.warn('[api/admin/attendance] day_off sync failed', err);
    },
  );

  scheduleAttendanceCheckInOutWhatsApp({
    empId: EmpID,
    employeeName,
    previousCheckIn,
    previousCheckOut,
    checkInTime: CheckInTime || null,
    checkOutTime: CheckOutTime || null,
  });

  if (CheckInTime && CheckOutTime) {
    try {
      const { syncNonPostedPayrollHoursFromAttendance } = await import(
        '@/lib/payroll/syncPayrollHoursFromAttendance'
      );
      const sync = await syncNonPostedPayrollHoursFromAttendance({
        empId: Number(EmpID),
        workDate: WorkDate,
        branchId,
      });
      if (sync.updated) {
        console.log(
          `[api/admin/attendance] payroll hours synced emp=${EmpID} day=${WorkDate} hours=${sync.actualHours}`,
        );
      }
    } catch (syncErr) {
      console.warn('[api/admin/attendance] payroll hours sync failed', syncErr);
    }
  }

  if (activeTxn) {
    await activeTxn.commit();
  }

  return {
    EmpID,
    WorkDate,
    Status: finalStatus,
    LateMinutes: lateMinutes,
    EarlyLeaveMinutes: earlyLeaveMinutes,
    BreakMinutesTotal: breakMinutesTotal,
    Breaks: Breaks !== undefined || clearBreaks ? parsedBreaks.breaks : undefined,
    BreakTimeMinutesTotal: breakTimeMinutesTotal,
    BreakTimes:
      BreakTimes !== undefined || clearBreaks ? parsedBreakTimes.breaks : undefined,
  };
  } catch (err) {
    if (activeTxn) {
      try {
        await activeTxn.rollback();
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}

/**
 * Phase B2 — current POST /api/employees/attendance write path.
 * MERGE + ISNULL, trusted status, availability notify only. No admin side effects.
 */
export async function saveLegacyEmployeeAttendance(
  input: SaveLegacyEmployeeAttendanceInput,
): Promise<SaveLegacyEmployeeAttendanceResult> {
  const branchId = input.branchId;
  const empId = input.empId;
  const workDate = input.workDate;
  const checkInTime = input.checkInTime;
  const checkOutTime = input.checkOutTime;
  const status = input.status;
  const notes = input.notes;

  await assertEmpBranchWorkDayMutable(branchId, String(workDate).slice(0, 10));

  try {
    await assertEmployeeEligibleForBranchAttendance(
      Number(empId),
      branchId,
      workDate,
    );
  } catch (eligErr) {
    if (eligErr instanceof Error && 'statusCode' in eligErr) {
      const e = eligErr as { message: string; statusCode: number; code?: string };
      throw new AttendanceCommandError(e.message, e.statusCode, e.code);
    }
    throw eligErr;
  }

  const dbPool = await attendanceRepo.getAttendanceDb();

  const exists = await attendanceRepo.employeeExists(dbPool, empId);
  if (!exists) {
    throw new AttendanceCommandError(LEGACY_EMPLOYEES_POST_EMP_NOT_FOUND_MESSAGE, 404);
  }

  const existingPeek = await attendanceRepo.findBranchDayAttendance(
    dbPool,
    empId,
    workDate,
    branchId,
  );

  const creatingOpen = willResultInOpenSession(
    checkInTime as string | null | undefined,
    checkOutTime as string | null | undefined,
  );

  let db: attendanceRepo.AttendanceDb = dbPool;
  let activeTxn: attendanceRepo.AttendanceTransaction | null = null;
  if (creatingOpen) {
    const guard = await beginActiveSessionGuard({
      empId: Number(empId),
      candidateWorkDate: String(workDate).slice(0, 10),
      excludeAttendanceId: existingPeek?.ID ?? null,
      message: LEGACY_EMPLOYEES_POST_ALREADY_OPEN_MESSAGE,
      code: LEGACY_EMPLOYEES_POST_ALREADY_OPEN_CODE,
    });
    db = guard.txDb;
    activeTxn = guard.transaction;
  }

  try {
  const row = await attendanceRepo.mergeLegacyEmployeeAttendance({
    db,
    branchId,
    empId,
    workDate,
    checkInTime,
    checkOutTime,
    status: status ?? null,
    notes: notes ?? null,
  });

  const isNew = row?.UpdatedAt === null;

  try {
    const { AvailabilityMutationNotifier } = await import(
      '@/lib/booking/AvailabilityMutationNotifier'
    );
    await AvailabilityMutationNotifier.employeeDayChanged({
      employeeId: Number(empId),
      businessDate: String(workDate).slice(0, 10),
      branchId,
      reason: LEGACY_EMPLOYEES_POST_NOTIFIER_REASON,
    });
  } catch {
    /* best-effort — freelance unlock / present-on-day-off path */
  }

  if (activeTxn) {
    await activeTxn.commit();
  }

  return { row: row ?? {}, isNew };
  } catch (err) {
    if (activeTxn) {
      try {
        await activeTxn.rollback();
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}

/** Existing-row WorkDate for payroll gate — current PUT :id local-date behavior. */
function payrollWorkDateFromOwnershipRow(workDateRaw: unknown): string {
  return workDateRaw instanceof Date
    ? `${workDateRaw.getFullYear()}-${String(workDateRaw.getMonth() + 1).padStart(2, '0')}-${String(workDateRaw.getDate()).padStart(2, '0')}`
    : String(workDateRaw ?? '').slice(0, 10);
}

function notifierWorkDateFromUpdatedRow(workDateRaw: unknown): string {
  return workDateRaw instanceof Date
    ? workDateRaw.toISOString().slice(0, 10)
    : String(workDateRaw).slice(0, 10);
}

/**
 * Phase B3 — current PUT /api/employees/attendance/:id write path.
 * Partial UPDATE by ID, null clears, NVarChar punches.
 * Active-session policy when patch result would be OPEN.
 */
export async function updateLegacyEmployeeAttendanceById(
  input: UpdateLegacyEmployeeAttendanceByIdInput,
): Promise<UpdateLegacyEmployeeAttendanceByIdResult> {
  const branchId = input.branchId;
  const attendanceId = input.attendanceId;
  const checkInTime = input.checkInTime;
  const checkOutTime = input.checkOutTime;
  const status = input.status;
  const notes = input.notes;

  const dbPool = await attendanceRepo.getAttendanceDb();

  const owned = await attendanceRepo.getAttendanceOwnershipById(dbPool, attendanceId);
  if (!owned || Number(owned.BranchID) !== branchId) {
    throw new AttendanceCommandError(LEGACY_EMPLOYEES_PUT_BY_ID_NOT_FOUND_MESSAGE, 404);
  }

  const workDate = payrollWorkDateFromOwnershipRow(owned.WorkDate);
  await assertEmpBranchWorkDayMutable(branchId, workDate);

  const patch: {
    checkInTime?: unknown;
    checkOutTime?: unknown;
    status?: unknown;
    notes?: unknown;
  } = {};
  if (checkInTime !== undefined) patch.checkInTime = checkInTime;
  if (checkOutTime !== undefined) patch.checkOutTime = checkOutTime;
  if (status !== undefined) patch.status = status;
  if (notes !== undefined) patch.notes = notes;

  if (Object.keys(patch).length === 0) {
    throw new AttendanceCommandError(LEGACY_EMPLOYEES_PUT_BY_ID_NO_PATCH_MESSAGE, 400);
  }

  const resultingIn =
    checkInTime !== undefined
      ? (checkInTime as string | null)
      : owned.CheckInTime;
  const resultingOut =
    checkOutTime !== undefined
      ? (checkOutTime as string | null)
      : owned.CheckOutTime;
  const creatingOpen = willResultInOpenSession(resultingIn, resultingOut);

  let db: attendanceRepo.AttendanceDb = dbPool;
  let activeTxn: attendanceRepo.AttendanceTransaction | null = null;
  if (creatingOpen) {
    const guard = await beginActiveSessionGuard({
      empId: Number(owned.EmpID),
      candidateWorkDate: workDate,
      excludeAttendanceId: attendanceId,
      message: ADMIN_PUT_ALREADY_OPEN_MESSAGE,
      code: ADMIN_PUT_ALREADY_OPEN_CODE,
    });
    db = guard.txDb;
    activeTxn = guard.transaction;
  }

  try {
  const row = await attendanceRepo.updateLegacyAttendanceById({
    db,
    id: attendanceId,
    branchId,
    patch,
  });

  if (!row) {
    throw new AttendanceCommandError(LEGACY_EMPLOYEES_PUT_BY_ID_NOT_FOUND_MESSAGE, 404);
  }

  try {
    const { AvailabilityMutationNotifier } = await import(
      '@/lib/booking/AvailabilityMutationNotifier'
    );
    await AvailabilityMutationNotifier.employeeDayChanged({
      employeeId: Number(row.EmpID),
      businessDate: notifierWorkDateFromUpdatedRow(row.WorkDate),
      branchId: Number(row.BranchID),
      reason: LEGACY_EMPLOYEES_PUT_BY_ID_NOTIFIER_REASON,
    });
  } catch {
    /* best-effort */
  }

  if (activeTxn) {
    await activeTxn.commit();
  }

  return { row };
  } catch (err) {
    if (activeTxn) {
      try {
        await activeTxn.rollback();
      } catch {
        /* ignore */
      }
    }
    throw err;
  }
}

/**
 * Phase B4 — admin bulk PUT.
 * One SQL transaction. Emp-default schedule source.
 * Active-session locks in EmpID order when resulting row will be OPEN.
 *
 * Preserved:
 * - unlockScheduleForWorkOnDayOff uses its own pool/connection and is swallowed
 * - no syncNonPostedPayrollHoursFromAttendance
 * - no AvailabilityMutationNotifier
 * - Late/EarlyLeave from TblEmp defaults
 */
export async function saveAdminAttendanceBulk(
  input: SaveAdminAttendanceBulkInput,
): Promise<SaveAdminAttendanceBulkSummary> {
  const branchId = input.branchId;
  const WorkDate = input.workDate;
  const itemsUnknown = input.items;

  await assertEmpBranchWorkDayMutable(branchId, WorkDate);

  if (!Array.isArray(itemsUnknown) || itemsUnknown.length === 0) {
    throw new AttendanceCommandError('يجب إرسال مصفوفة items', 400);
  }

  const items = itemsUnknown as SaveAdminAttendanceBulkItem[];
  const parsedBreaks = new Map<number, ReturnType<typeof normalizeBreaksInput>['breaks']>();
  const parsedBreakTimes = new Map<number, ReturnType<typeof normalizeBreaksInput>['breaks']>();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item.EmpID) {
      throw new AttendanceCommandError('EmpID مطلوب لكل عنصر', 400);
    }
    if (
      item.Status &&
      !ADMIN_PUT_VALID_STATUSES.includes(
        item.Status as (typeof ADMIN_PUT_VALID_STATUSES)[number],
      )
    ) {
      throw new AttendanceCommandError(`حالة غير صحيحة: ${item.Status}`, 400);
    }
    if (item.CheckInTime && !TIME_RE.test(String(item.CheckInTime))) {
      throw new AttendanceCommandError(
        `صيغة وقت حضور غير صحيحة للموظف ${item.EmpID}`,
        400,
      );
    }
    if (item.CheckOutTime && !TIME_RE.test(String(item.CheckOutTime))) {
      throw new AttendanceCommandError(
        `صيغة وقت انصراف غير صحيحة للموظف ${item.EmpID}`,
        400,
      );
    }
    if (item.Breaks !== undefined) {
      const parsed = normalizeBreaksInput(item.Breaks);
      if (parsed.error) {
        throw new AttendanceCommandError(
          `${parsed.error} (موظف ${item.EmpID})`,
          400,
        );
      }
      parsedBreaks.set(i, parsed.breaks);
    }
    if (item.BreakTimes !== undefined) {
      const parsed = normalizeBreaksInput(item.BreakTimes);
      if (parsed.error) {
        throw new AttendanceCommandError(
          `${parsed.error.replace(/مستقطع/g, 'بريك')} (موظف ${item.EmpID})`,
          400,
        );
      }
      parsedBreakTimes.set(i, parsed.breaks);
    }
  }

  const db = await attendanceRepo.getAttendanceDb();
  await ensureAttendanceBreakSchema(db);
  await ensureAttendanceBreakTimeSchema(db);

  const empDefaultsRows = await attendanceRepo.loadBulkEmpDefaults(
    db,
    items.map((item) => item.EmpID),
  );
  const empDefaultMap = new Map<
    number,
    { schedStart: string | null; schedEnd: string | null; empName: string }
  >();
  for (const e of empDefaultsRows) {
    empDefaultMap.set(e.EmpID, {
      schedStart: e.DefaultCheckInTime || null,
      schedEnd: e.DefaultCheckOutTime || null,
      empName: e.EmpName?.trim() || 'موظف',
    });
  }

  const openEmpIds = [
    ...new Set(
      items
        .filter((item) =>
          willResultInOpenSession(
            (item.CheckInTime as string | null) || null,
            (item.CheckOutTime as string | null) || null,
          ),
        )
        .map((item) => Number(item.EmpID)),
    ),
  ].sort((a, b) => a - b);

  const { transaction, txDb } = await attendanceRepo.beginAttendanceTransaction();

  let insertedCount = 0;
  let updatedCount = 0;
  const whatsappJobs: Array<{
    empId: number;
    employeeName?: string;
    previousCheckIn?: unknown;
    previousCheckOut?: unknown;
    checkInTime?: string | null;
    checkOutTime?: string | null;
  }> = [];

  try {
    for (const empId of openEmpIds) {
      await acquireActiveSessionLock(txDb, empId);
    }
    for (const empId of openEmpIds) {
      const existingForPolicy = await attendanceRepo.findBranchDayAttendance(
        txDb,
        empId,
        WorkDate,
        branchId,
      );
      await assertActiveOpenAllowed({
        db: txDb,
        empId,
        candidateWorkDate: WorkDate,
        excludeAttendanceId: existingForPolicy?.ID ?? null,
        message: ADMIN_PUT_ALREADY_OPEN_MESSAGE,
        code: ADMIN_PUT_ALREADY_OPEN_CODE,
      });
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const empDef = empDefaultMap.get(Number(item.EmpID));
      try {
        await assertEmployeeEligibleForBranchAttendance(
          Number(item.EmpID),
          branchId,
          WorkDate,
        );
      } catch (eligErr) {
        if (eligErr instanceof Error && 'statusCode' in eligErr) {
          const e = eligErr as { message: string; statusCode: number };
          throw new AttendanceCommandError(
            `${e.message} (موظف ${item.EmpID}${
              empDef?.empName ? ` — ${empDef.empName}` : ''
            })`,
            e.statusCode,
          );
        }
        throw eligErr;
      }

      const schedStart = empDef?.schedStart ?? null;
      const schedEnd = empDef?.schedEnd ?? null;
      const checkIn = (item.CheckInTime || null) as string | null;
      const checkOut = (item.CheckOutTime || null) as string | null;
      const lateMinutes = calcLateMinutes(checkIn, schedStart);
      const earlyLeaveMinutes = calcEarlyLeaveMinutes(checkOut, schedEnd);
      const finalStatus = resolveAdminPutAttendanceStatus({
        clientStatus: (item.Status as string | undefined) || 'Pending',
        checkInTime: checkIn,
        checkOutTime: checkOut,
        lateMinutes,
        earlyLeaveMinutes,
      });
      const manualStatuses = ['Absent', 'DayOff', 'Excused'];

      if (checkIn && !manualStatuses.includes(finalStatus)) {
        const scheduleRow = await getEffectiveBranchScheduleRow({
          empId: Number(item.EmpID),
          branchId,
          workDate: WorkDate,
        });
        if (scheduleRow && !scheduleRow.isWorking) {
          await unlockScheduleForWorkOnDayOff({
            empId: Number(item.EmpID),
            date: WorkDate,
            branchId,
            reason: ADMIN_BULK_WORK_ON_DAY_OFF_REASON,
            sourceTag: ADMIN_BULK_WORK_ON_DAY_OFF_SOURCE_TAG,
          }).catch((err) => {
            console.warn('[api/admin/attendance/bulk] day-off unlock failed', err);
          });
        }
      }

      const clearBreaks =
        finalStatus === 'Absent' ||
        finalStatus === 'DayOff' ||
        (!checkIn && !checkOut);

      const existing = await attendanceRepo.findBranchDayAttendance(
        txDb,
        item.EmpID,
        WorkDate,
        branchId,
      );
      const previousCheckIn = existing?.CheckInTime ?? null;
      const previousCheckOut = existing?.CheckOutTime ?? null;

      let attendanceId: number;
      if (existing) {
        attendanceId = existing.ID;
        await attendanceRepo.updateBranchDayAttendance({
          db: txDb,
          id: attendanceId,
          branchId,
          checkInTime: checkIn,
          checkOutTime: checkOut,
          status: finalStatus,
          lateMinutes,
          earlyLeaveMinutes,
          notes: (item.Notes as string) || null,
          scheduledStart: schedStart,
          scheduledEnd: schedEnd,
          updatedBy: input.userId,
        });
        updatedCount++;
      } else {
        attendanceId = await attendanceRepo.insertBranchDayAttendance({
          db: txDb,
          branchId,
          empId: item.EmpID,
          workDate: WorkDate,
          checkInTime: checkIn,
          checkOutTime: checkOut,
          status: finalStatus,
          lateMinutes,
          earlyLeaveMinutes,
          notes: (item.Notes as string) || null,
          scheduledStart: schedStart,
          scheduledEnd: schedEnd,
          createdBy: input.userId,
        });
        insertedCount++;
      }

      if (clearBreaks || item.Breaks !== undefined) {
        const breaksToSave = clearBreaks ? [] : (parsedBreaks.get(i) ?? []);
        await replaceAttendanceBreaks(txDb, attendanceId, breaksToSave);
        await syncBlockRangesFromBreaks(
          txDb,
          Number(item.EmpID),
          WorkDate,
          breaksToSave,
        );
      }

      if (clearBreaks || item.BreakTimes !== undefined) {
        const breakTimesToSave = clearBreaks ? [] : (parsedBreakTimes.get(i) ?? []);
        await replaceAttendanceBreakTimes(txDb, attendanceId, breakTimesToSave);
        await syncBlockRangesFromBreakTimes(
          txDb,
          Number(item.EmpID),
          WorkDate,
          breakTimesToSave,
        );
      }

      await syncAttendanceShiftToOverrides(txDb, Number(item.EmpID), WorkDate, {
        checkInTime: checkIn,
        checkOutTime: checkOut,
        scheduledStart: schedStart,
        scheduledEnd: schedEnd,
        status: finalStatus,
      });

      await syncAttendanceAbsenceToDayOffOverride(
        txDb,
        Number(item.EmpID),
        WorkDate,
        finalStatus,
      );

      whatsappJobs.push({
        empId: Number(item.EmpID),
        employeeName: empDef?.empName,
        previousCheckIn,
        previousCheckOut,
        checkInTime: checkIn,
        checkOutTime: checkOut,
      });
    }

    await transaction.commit();

    for (const job of whatsappJobs) {
      scheduleAttendanceCheckInOutWhatsApp(job);
    }
  } catch (innerErr) {
    await transaction.rollback();
    throw innerErr;
  }

  return {
    savedCount: insertedCount + updatedCount,
    insertedCount,
    updatedCount,
  };
}

/**
 * Phase B5 — work-on-day-off.
 * Schedule unlock preserved. Active-session policy before OPEN Present punch.
 */
export async function workOnDayOff(
  input: WorkOnDayOffInput,
): Promise<WorkOnDayOffResult> {
  const sourceTag = input.sourceTag ?? WORK_ON_DAY_OFF_SOURCE_TAG;
  const unlock = await unlockScheduleForWorkOnDayOff({
    empId: input.empId,
    date: input.date,
    branchId: input.branchId,
    reason: input.reason,
    sourceTag,
  });

  const checkInTime = getCairoTimeStr() || cairoTimeStr(new Date());
  const reasonText =
    input.reason?.trim() ||
    'نزل يشتغل يوم إجازته — تسجيل حضور من متابعة الحضور';
  const notes = `${sourceTag}: ${reasonText}`.slice(0, 300);

  const dbPool = await attendanceRepo.getAttendanceDb();
  const existing = await attendanceRepo.findBranchDayAttendance(
    dbPool,
    input.empId,
    input.date,
    input.branchId,
  );

  const guard = await beginActiveSessionGuard({
    empId: input.empId,
    candidateWorkDate: input.date,
    excludeAttendanceId: existing?.ID ?? null,
    message: ADMIN_PUT_ALREADY_OPEN_MESSAGE,
    code: ADMIN_PUT_ALREADY_OPEN_CODE,
  });
  try {
    await attendanceRepo.upsertWorkOnDayOffPresent({
      db: guard.txDb,
      empId: input.empId,
      workDate: input.date,
      branchId: input.branchId,
      checkInTime,
      notes,
    });
    await guard.transaction.commit();
  } catch (err) {
    try {
      await guard.transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }

  return {
    ok: true,
    message: 'تم تسجيل حضور الموظف في يوم إجازته',
    checkInTime,
    branchId: input.branchId,
    dayOffOverridesCleared: unlock.dayOffOverridesCleared,
    dayOffRowsCleared: unlock.dayOffRowsCleared,
    customHours: unlock.customHours,
  };
}

/**
 * Phase B5 — current POST /api/operations/schedule-control/restore-present.
 * Dedicated command. No OPEN guard. Cross-branch tagged Absent patch preserved.
 * Does not call saveAdminAttendance or workOnDayOff.
 *
 * Known bugs deliberately preserved:
 * - other-branch schedule-control day_off Absent rows patched to Present
 */
export async function restorePresent(
  input: RestorePresentInput,
): Promise<RestorePresentResult> {
  const { empId, date, branchId } = input;
  const todayBusiness = input.todayBusiness;
  const todayCalendar = input.todayCalendar;
  const isToday = date === todayBusiness || date === todayCalendar;

  if (date < todayBusiness && date < todayCalendar) {
    throw new AttendanceCommandError(RESTORE_PRESENT_PAST_DATE_MESSAGE, 400);
  }

  const branch = await getBranchById(branchId);
  if (!branch || !branch.isActive) {
    throw new AttendanceCommandError(RESTORE_PRESENT_INACTIVE_BRANCH_MESSAGE, 403);
  }

  const unlock = await unlockScheduleForWorkOnDayOff({
    empId,
    date,
    branchId: branch.branchId,
    reason:
      typeof input.reason === 'string' && input.reason.trim()
        ? input.reason.trim()
        : isToday
          ? 'إلغاء الغياب وتشغيل اليوم من إدارة مواعيد اليوم'
          : 'تشغيل يوم إجازة أسبوعية لتاريخ مستقبلي من إدارة مواعيد اليوم',
    sourceTag: RESTORE_PRESENT_SOURCE,
  });

  let checkInTime: string | null = null;

  if (isToday) {
    const dbPool = await attendanceRepo.getAttendanceDb();
    checkInTime = getCairoTimeStr() || cairoTimeStr(new Date());
    const notes = `${RESTORE_PRESENT_SOURCE}${
      input.reason ? `: ${String(input.reason).trim()}` : ''
    }`;
    const existing = await attendanceRepo.findBranchDayAttendance(
      dbPool,
      empId,
      date,
      branch.branchId,
    );
    const guard = await beginActiveSessionGuard({
      empId,
      candidateWorkDate: date,
      excludeAttendanceId: existing?.ID ?? null,
      message: ADMIN_PUT_ALREADY_OPEN_MESSAGE,
      code: ADMIN_PUT_ALREADY_OPEN_CODE,
    });
    try {
      await attendanceRepo.upsertRestorePresentAttendance({
        db: guard.txDb,
        empId,
        workDate: date,
        branchId: branch.branchId,
        checkInTime,
        notes,
        dayOffTag: RESTORE_PRESENT_DAY_OFF_SOURCE,
      });
      await guard.transaction.commit();
    } catch (err) {
      try {
        await guard.transaction.rollback();
      } catch {
        /* ignore */
      }
      throw err;
    }
  }

  const updatedStatus = await getBarberDayStatus(empId, date, {
    isToday,
    branchId: branch.branchId,
  });

  void import('@/lib/booking/cache/hotCacheInvalidateBestEffort')
    .then((m) =>
      m.notifyHotEffectiveDay({
        employeeId: empId,
        businessDate: date,
        branchId: branch.branchId,
        reason: 'schedule_control_restore_present',
      }),
    )
    .catch(() => undefined);

  return {
    ok: true,
    message: isToday
      ? 'تم إلغاء الغياب وتسجيل الحضور'
      : 'تم تشغيل هذا اليوم للحجز — تسجيل الحضور يتم يوم العمل نفسه',
    checkInTime,
    attendanceRecorded: isToday,
    branchId: branch.branchId,
    dayOffOverridesCleared: unlock.dayOffOverridesCleared,
    dayOffRowsCleared: unlock.dayOffRowsCleared,
    customHours: unlock.customHours,
    barberStatus: {
      empId,
      isWorkingDay: updatedStatus.isWorkingDay,
      isDayOff: updatedStatus.isDayOff,
      isAbsent: updatedStatus.isAbsent,
      statusReasonArabic: updatedStatus.statusReasonArabic,
      currentAvailabilityStatus: updatedStatus.currentAvailabilityStatus,
      effectiveStart: updatedStatus.effectiveStart,
      effectiveEnd: updatedStatus.effectiveEnd,
      attendance: updatedStatus.attendance,
    },
  };
}

/**
 * Phase B6 — schedule-control apply day_off attendance side effect.
 * Upserts Absent + clears punches on session branch. Caller must .catch (best-effort).
 * Does not call saveAdminAttendance / restorePresent.
 */
export async function applyScheduleControlDayOffAttendance(
  input: ApplyScheduleControlDayOffAttendanceInput,
): Promise<{ attempted: true }> {
  const attendanceNote = `${SCHEDULE_CONTROL_DAY_OFF_SOURCE}${
    input.reason ? `: ${input.reason}` : ''
  }`;
  const db = await attendanceRepo.getAttendanceDb();
  await attendanceRepo.upsertScheduleControlDayOffAbsent({
    db,
    empId: input.empId,
    workDate: input.workDate,
    branchId: input.branchId,
    notes: attendanceNote,
  });
  return { attempted: true };
}

/**
 * Phase B6 — schedule-control override DELETE tagged Absent revert.
 * No BranchID filter. Best-effort: SQL errors → attendanceReverted false (no throw).
 */
export async function revertScheduleControlDayOffAttendance(
  input: RevertScheduleControlDayOffAttendanceInput,
): Promise<RevertScheduleControlDayOffAttendanceResult> {
  const sourceTag = input.sourceTag ?? SCHEDULE_CONTROL_DAY_OFF_REVERT_SOURCE;
  try {
    const db = await attendanceRepo.getAttendanceDb();
    const rows = await attendanceRepo.revertTaggedScheduleControlDayOffAbsent({
      db,
      empId: input.empId,
      workDate: input.workDate,
      sourceTag,
    });
    return { attendanceReverted: rows > 0 };
  } catch {
    return { attendanceReverted: false };
  }
}

/**
 * Auto-absence → Absent mutation.
 * Scanner owns threshold/roster/bookings; this owns TblEmpAttendance only.
 * KNOWN LEGACY BRANCH-SCOPE BUG preserved (EmpID + WorkDate, no BranchID).
 */
export async function markAutoAbsenceAttendance(
  input: MarkAutoAbsenceAttendanceInput,
): Promise<void> {
  const db = await attendanceRepo.getAttendanceDb();
  await attendanceRepo.markAutoAbsenceAttendance({
    db,
    empId: input.empId,
    branchId: input.branchId,
    workDate: input.workDate,
  });
}

/**
 * Nightly finalize — persist one default-fill attendance row (update or insert).
 * Caller owns the SQL transaction; pass tx request factory as db.
 * Orchestration/date selection remains outside Attendance.
 */
export async function persistNightlyDefaultFillAttendance(
  input: PersistNightlyDefaultFillAttendanceInput,
): Promise<void> {
  const db = input.db as attendanceRepo.AttendanceDb;
  if (input.mode === 'update') {
    if (input.attendanceId == null) {
      throw new AttendanceCommandError('attendanceId required for nightly update', 500);
    }
    await attendanceRepo.updateNightlyDefaultFillAttendance({
      db,
      attendanceId: input.attendanceId,
      branchId: input.branchId,
      checkInTime: input.checkInTime,
      checkOutTime: input.checkOutTime,
      status: input.status,
      lateMinutes: input.lateMinutes,
      earlyLeaveMinutes: input.earlyLeaveMinutes,
      notes: input.notes,
      scheduledStart: input.scheduledStart,
      scheduledEnd: input.scheduledEnd,
    });
    return;
  }
  if (input.empId == null || input.workDate == null) {
    throw new AttendanceCommandError('empId/workDate required for nightly insert', 500);
  }
  await attendanceRepo.insertNightlyDefaultFillAttendance({
    db,
    branchId: input.branchId,
    empId: input.empId,
    workDate: input.workDate,
    checkInTime: input.checkInTime,
    checkOutTime: input.checkOutTime,
    status: input.status,
    lateMinutes: input.lateMinutes,
    earlyLeaveMinutes: input.earlyLeaveMinutes,
    notes: input.notes,
    scheduledStart: input.scheduledStart,
    scheduledEnd: input.scheduledEnd,
  });
}

/**
 * CLOSED-only BranchID relocate from→to.
 * Transfer/HR own gates + payroll; Attendance owns this UPDATE only.
 */
export async function relocateClosedAttendanceFromBranch(
  input: RelocateClosedAttendanceFromBranchInput,
): Promise<number> {
  const db = await attendanceRepo.getAttendanceDb();
  return attendanceRepo.relocateClosedAttendanceFromBranch({
    db,
    empId: input.empId,
    workDate: input.workDate,
    fromBranchId: input.fromBranchId,
    toBranchId: input.toBranchId,
  });
}

/**
 * CLOSED-only sweep any other branch → destination (temporary transfer).
 */
export async function relocateClosedAttendanceTowardDestination(
  input: RelocateClosedAttendanceTowardDestinationInput,
): Promise<number> {
  const db = await attendanceRepo.getAttendanceDb();
  return attendanceRepo.relocateClosedAttendanceTowardDestination({
    db,
    empId: input.empId,
    workDate: input.workDate,
    toBranchId: input.toBranchId,
  });
}

/**
 * Present placeholder row (no punches) so a break can attach.
 * Preserves syncBreakFromBlockRange legacy behavior.
 * Re-export of isolated helper (avoids schedule-sync ↔ command cycle).
 */
export { ensurePresentAttendancePlaceholder } from './ensurePresentAttendancePlaceholder';

