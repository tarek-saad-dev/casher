/**
 * Phase 1R — atomic global weekly branch distribution save + preview.
 * Writes only TblEmpBranchWorkSchedule (never TblEmpWorkSchedule).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from '@/lib/branch/repository';
import {
  SchedulePolicyError,
  assertAssignmentAndPayrollForWorkingSchedule,
  saveEmployeeBranchWeeklySchedule,
  type WeeklyScheduleCellInput,
} from '@/lib/hr/employeeBranchScheduleSave';
import { resolveEmployeeGlobalSchedule } from '@/lib/hr/employeeBranchScheduleResolver';
import { invalidateEmployeeScheduleCaches } from '@/lib/hr/scheduleAvailabilityInvalidation';
import { ensureEmpBranchWorkScheduleTable } from '@/lib/hr/empBranchWorkSchedule';

export type GlobalWeeklyDayInput = {
  dayOfWeek: number;
  status: 'working' | 'off';
  branchId?: number | null;
  useBranchHours?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  canReceiveBookings?: boolean;
};

function isOvernight(start: string | null | undefined, end: string | null | undefined): boolean {
  if (!start || !end) return false;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return eh * 60 + em <= sh * 60 + sm;
}

async function resolveDayHours(
  day: GlobalWeeklyDayInput,
): Promise<{ startTime: string | null; endTime: string | null; overnight: boolean }> {
  if (day.status !== 'working' || !day.branchId) {
    return { startTime: null, endTime: null, overnight: false };
  }
  if (day.useBranchHours !== false && (!day.startTime || !day.endTime)) {
    const branch = await getBranchById(day.branchId);
    const start = branch?.defaultOpenTime?.slice(0, 5) ?? null;
    const end = branch?.defaultCloseTime?.slice(0, 5) ?? null;
    return { startTime: start, endTime: end, overnight: isOvernight(start, end) };
  }
  const start = day.startTime?.slice(0, 5) ?? null;
  const end = day.endTime?.slice(0, 5) ?? null;
  if (start && end && isOvernight(start, end) === false && start === end) {
    throw new SchedulePolicyError('INVALID_OVERNIGHT_SCHEDULE', 'ساعات العمل غير صالحة', 400);
  }
  return { startTime: start, endTime: end, overnight: isOvernight(start, end) };
}

function nextDateFrom(dateStr: string, addDays: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + addDays);
  return d.toISOString().slice(0, 10);
}

function dateForDowInWeek(weekStartSunday: string, dayOfWeek: number): string {
  return nextDateFrom(weekStartSunday, dayOfWeek);
}

export async function previewEmployeeGlobalWeeklySchedule(args: {
  empId: number;
  effectiveFrom: string;
  days: GlobalWeeklyDayInput[];
}): Promise<{
  canSave: boolean;
  blockers: Array<{ code: string; message: string; dayOfWeek?: number }>;
  warnings: string[];
  summary: Array<{
    dayOfWeek: number;
    dayNameAr: string;
    status: 'working' | 'off';
    branchId: number | null;
    branchCode: string | null;
    branchName: string | null;
    startTime: string | null;
    endTime: string | null;
    overnight: boolean;
    canReceiveBookings: boolean;
  }>;
  affectedBookings: Array<{
    bookingId: number;
    bookingCode: string | null;
    bookingDate: string;
    startTime: string;
    branchId: number;
    clientName: string | null;
  }>;
  overlappingTransfers: Array<{ transferId: number; workDate: string; toBranchId: number }>;
}> {
  const DAY_NAMES = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const blockers: Array<{ code: string; message: string; dayOfWeek?: number }> = [];
  const warnings: string[] = [];

  if (!Array.isArray(args.days) || args.days.length !== 7) {
    blockers.push({ code: 'INVALID_DAYS', message: 'يجب إرسال 7 أيام' });
  }

  const byDow = new Map<number, GlobalWeeklyDayInput>();
  for (const d of args.days ?? []) {
    if (byDow.has(d.dayOfWeek)) {
      blockers.push({
        code: 'EMPLOYEE_MULTI_BRANCH_SAME_WORKDAY_NOT_ALLOWED',
        message: 'يوم مكرر في الطلب',
        dayOfWeek: d.dayOfWeek,
      });
    }
    byDow.set(d.dayOfWeek, d);
  }

  const summary = [];
  const workingBranchIds = new Set<number>();

  for (let dow = 0; dow < 7; dow++) {
    const day = byDow.get(dow) ?? { dayOfWeek: dow, status: 'off' as const };
    if (day.status === 'working') {
      if (!day.branchId) {
        blockers.push({
          code: 'BRANCH_REQUIRED',
          message: 'الفرع مطلوب لأيام العمل',
          dayOfWeek: dow,
        });
        summary.push({
          dayOfWeek: dow,
          dayNameAr: DAY_NAMES[dow],
          status: 'working' as const,
          branchId: null,
          branchCode: null,
          branchName: null,
          startTime: null,
          endTime: null,
          overnight: false,
          canReceiveBookings: false,
        });
        continue;
      }
      workingBranchIds.add(day.branchId);
      try {
        await assertAssignmentAndPayrollForWorkingSchedule({
          empId: args.empId,
          branchId: day.branchId,
          effectiveFrom: args.effectiveFrom,
          canReceiveBookings: day.canReceiveBookings !== false,
          // HR weekly planner sets hours first; booking service eligibility is a separate setup step.
          requireServicesIfBooking: false,
        });
      } catch (err) {
        if (err instanceof SchedulePolicyError) {
          blockers.push({ code: err.code, message: err.message, dayOfWeek: dow });
        } else throw err;
      }
      const hours = await resolveDayHours(day);
      if (day.status === 'working' && (!hours.startTime || !hours.endTime)) {
        blockers.push({
          code: 'INVALID_OVERNIGHT_SCHEDULE',
          message: 'ساعات الفرع غير متوفرة — حدد وقتاً مخصصاً',
          dayOfWeek: dow,
        });
      }
      const branch = await getBranchById(day.branchId);
      summary.push({
        dayOfWeek: dow,
        dayNameAr: DAY_NAMES[dow],
        status: 'working' as const,
        branchId: day.branchId,
        branchCode: branch?.branchCode ?? null,
        branchName: branch?.branchName ?? null,
        startTime: hours.startTime,
        endTime: hours.endTime,
        overnight: hours.overnight,
        canReceiveBookings: day.canReceiveBookings !== false,
      });
    } else {
      summary.push({
        dayOfWeek: dow,
        dayNameAr: DAY_NAMES[dow],
        status: 'off' as const,
        branchId: null,
        branchCode: null,
        branchName: null,
        startTime: null,
        endTime: null,
        overnight: false,
        canReceiveBookings: false,
      });
    }
  }

  // Same weekday cannot map to two branches in the payload (already one entry per dow)
  const weekStart = (() => {
    const d = new Date(`${args.effectiveFrom}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - d.getUTCDay());
    return d.toISOString().slice(0, 10);
  })();

  const db = await getPool();
  const futureFrom = args.effectiveFrom;
  const bookings = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('from', sql.Date, futureFrom)
    .query(`
      SELECT TOP 50
        b.BookingID, b.BookingCode, b.BookingDate, b.StartTime, b.BranchID, c.Name AS ClientName
      FROM dbo.Bookings b
      LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
      WHERE b.AssignedEmpID = @empId
        AND b.BookingDate >= @from
        AND b.Status IN (N'confirmed', N'arrived', N'queued', N'in_service', N'in_progress')
      ORDER BY b.BookingDate, b.StartTime
    `)
    .catch(() => ({ recordset: [] as Record<string, unknown>[] }));

  const affectedBookings = [];
  for (const row of bookings.recordset) {
    const bookingDate = String(row.BookingDate).slice(0, 10);
    const dow = new Date(`${bookingDate}T12:00:00Z`).getDay();
    const planned = summary.find((s) => s.dayOfWeek === dow);
    const bookingBranchId = Number(row.BranchID);
    if (
      planned &&
      (planned.status === 'off' ||
        (planned.branchId != null && planned.branchId !== bookingBranchId))
    ) {
      affectedBookings.push({
        bookingId: Number(row.BookingID),
        bookingCode: row.BookingCode == null ? null : String(row.BookingCode),
        bookingDate,
        startTime: String(row.StartTime).slice(0, 5),
        branchId: bookingBranchId,
        clientName: row.ClientName == null ? null : String(row.ClientName),
      });
    }
  }

  if (affectedBookings.length) {
    blockers.push({
      code: 'SCHEDULE_AFFECTS_EXISTING_BOOKINGS',
      message: `الجدول يؤثر على ${affectedBookings.length} حجز(ات) مستقبلية — لا يتم نقل الحجوزات تلقائياً`,
    });
  }

  const transfers = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('from', sql.Date, futureFrom)
    .query(`
      SELECT TransferID, WorkDate, ToBranchID
      FROM dbo.TblEmpTemporaryBranchTransfer
      WHERE EmpID = @empId AND IsActive = 1 AND WorkDate >= @from
    `)
    .catch(() => ({ recordset: [] as Record<string, unknown>[] }));

  const overlappingTransfers = transfers.recordset.map((t) => ({
    transferId: Number(t.TransferID),
    workDate: String(t.WorkDate).slice(0, 10),
    toBranchId: Number(t.ToBranchID),
  }));
  if (overlappingTransfers.length) {
    warnings.push(`يوجد ${overlappingTransfers.length} نقل طارئ نشط بعد تاريخ السريان`);
  }

  // Soft warnings via resolver for the week of effectiveFrom
  for (let i = 0; i < 7; i++) {
    const date = dateForDowInWeek(weekStart, i);
    if (date < args.effectiveFrom) continue;
    const global = await resolveEmployeeGlobalSchedule({
      empId: args.empId,
      workDate: date,
      publicOnly: false,
    });
    if (global.conflict) {
      warnings.push(`${DAY_NAMES[i]}: تعارض حالي في الجدول (${global.conflict.code})`);
    }
  }

  void workingBranchIds;

  return {
    canSave: blockers.length === 0,
    blockers,
    warnings,
    summary,
    affectedBookings,
    overlappingTransfers,
  };
}

/**
 * Atomically save one operational branch (or off) per weekday.
 * Does not mutate TblEmpWorkSchedule.
 */
export async function saveEmployeeGlobalWeeklySchedule(args: {
  empId: number;
  effectiveFrom: string;
  days: GlobalWeeklyDayInput[];
  reason?: string;
  actorUserId?: number | null;
  allowAffectingBookings?: boolean;
}): Promise<{ savedBranches: number; preview: Awaited<ReturnType<typeof previewEmployeeGlobalWeeklySchedule>> }> {
  await ensureEmpBranchWorkScheduleTable();
  const preview = await previewEmployeeGlobalWeeklySchedule({
    empId: args.empId,
    effectiveFrom: args.effectiveFrom,
    days: args.days,
  });

  const blockers = preview.blockers.filter((b) => {
    if (args.allowAffectingBookings && b.code === 'SCHEDULE_AFFECTS_EXISTING_BOOKINGS') {
      return false;
    }
    return true;
  });
  if (blockers.length) {
    throw new SchedulePolicyError(
      blockers[0].code,
      blockers[0].message,
      409,
      { blockers, affectedBookings: preview.affectedBookings },
    );
  }

  const branchIds = new Set<number>();
  for (const s of preview.summary) {
    if (s.branchId) branchIds.add(s.branchId);
  }

  // Also close working rows on any previously scheduled branch for these weekdays
  const db = await getPool();
  const prior = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('from', sql.Date, args.effectiveFrom)
    .query(`
      SELECT DISTINCT BranchID FROM dbo.TblEmpBranchWorkSchedule
      WHERE EmpID = @empId AND IsActive = 1 AND IsWorking = 1
        AND EffectiveFrom <= @from
        AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
    `);
  for (const row of prior.recordset) branchIds.add(Number(row.BranchID));

  for (const branchId of branchIds) {
    const cells: WeeklyScheduleCellInput[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const planned = preview.summary.find((s) => s.dayOfWeek === dow)!;
      const workingHere = planned.status === 'working' && planned.branchId === branchId;
      cells.push({
        dayOfWeek: dow,
        isWorking: workingHere,
        startTime: workingHere ? planned.startTime : null,
        endTime: workingHere ? planned.endTime : null,
        canReceiveBookings: workingHere ? planned.canReceiveBookings : false,
      });
    }
    await saveEmployeeBranchWeeklySchedule({
      empId: args.empId,
      branchId,
      effectiveFrom: args.effectiveFrom,
      cells,
      actorUserId: args.actorUserId ?? null,
      skipPayrollCheck: false,
      skipCrossBranchConflictCheck: true,
    });
  }

  // Audit note
  await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('actor', sql.Int, args.actorUserId ?? null)
    .input('reason', sql.NVarChar(250), args.reason?.trim() || 'Phase 1R global weekly schedule save')
    .query(`
      IF OBJECT_ID(N'dbo.TblBranchLifecycleAudit', N'U') IS NOT NULL
      BEGIN
        INSERT INTO dbo.TblBranchLifecycleAudit (
          BranchID, FromStatus, ToStatus, ActorUserID, Reason, CreatedAt
        )
        SELECT TOP 1 BranchID, LifecycleStatus, LifecycleStatus, @actor,
          CONCAT(N'emp-schedule:', @empId, N' ', @reason), SYSUTCDATETIME()
        FROM dbo.TblBranch ORDER BY BranchID
      END
    `)
    .catch(() => null);

  invalidateEmployeeScheduleCaches({
    empId: args.empId,
    workDate: args.effectiveFrom,
    branchIds: [...branchIds],
  });

  return { savedBranches: branchIds.size, preview };
}
