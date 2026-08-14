/**
 * Phase 1Q/1R — temporary branch transfer (date-specific; does not mutate weekly schedule).
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { getBranchById } from '@/lib/branch/repository';
import { ensureEmpBranchWorkScheduleTable } from '@/lib/hr/empBranchWorkSchedule';
import { SchedulePolicyError } from '@/lib/hr/employeeBranchScheduleSave';
import {
  resolveEmployeeBranchSchedule,
  resolveEmployeeGlobalSchedule,
} from '@/lib/hr/employeeBranchScheduleResolver';
import { invalidateTemporaryTransferCaches } from '@/lib/hr/scheduleAvailabilityInvalidation';
import { resolveBranchPayrollPlanForDate } from '@/lib/payroll/branchPayrollPlan';
import { normalizeEmploymentType } from '@/lib/hr/employee-hr-model';
import { ensureEmployeeBranchAssignment } from '@/lib/branch/assignmentIntegrity';
import {
  RELOCATABLE_TRANSFER_BLOCKER_CODES,
  splitTransferBlockers,
} from '@/lib/hr/temporaryTransferBlockers';

export {
  FORCEABLE_TRANSFER_BLOCKER_CODES,
  RELOCATABLE_TRANSFER_BLOCKER_CODES,
  splitTransferBlockers,
} from '@/lib/hr/temporaryTransferBlockers';

type OperationalSourceBranch = {
  branchId: number;
  branchCode: string;
  branchName: string;
  startTime: string | null;
  endTime: string | null;
};

export type TransferPreviewResult = {
  canTransfer: boolean;
  /**
   * True when only soft/ops blockers remain (assignment, payroll, services, source bookings)
   * and an operator may force the emergency transfer.
   */
  canForceTransfer: boolean;
  /**
   * True when remaining blockers are soft and/or relocatable (completed attendance /
   * non-posted payroll) — requires relocateAttendance on apply for past-date fixups.
   */
  canForceWithRelocate: boolean;
  /** Completed attendance / generated payroll that move with relocateAttendance. */
  requiresRelocate: boolean;
  blockers: Array<{ code: string; message: string }>;
  /** Soft blockers that `forceDespiteBlockers` may override. */
  forceableBlockers: Array<{ code: string; message: string }>;
  relocatableBlockers: Array<{ code: string; message: string }>;
  warnings: string[];
  affectedBookings: Array<{
    bookingId: number;
    bookingCode: string | null;
    startTime: string;
    clientName: string | null;
    branchId: number;
    branchCode: string | null;
  }>;
  affectedQueueTickets: Array<{
    ticketId: number;
    ticketCode: string | null;
    status: string;
    branchId: number | null;
  }>;
  attendance: {
    hasOpen: boolean;
    hasCompleted: boolean;
    branchId: number | null;
  };
  payrollState: {
    hasPayroll: boolean;
    hasGeneratedPayroll: boolean;
    hasPostedPayroll: boolean;
    hasLedger: boolean;
  };
  sourceBranch: {
    branchId: number;
    branchCode: string;
    branchName: string;
    startTime: string | null;
    endTime: string | null;
  } | null;
  destinationBranch: {
    branchId: number;
    branchCode: string;
    branchName: string;
    lifecycleStatus: string;
    isActive: boolean;
    publicBookingEnabled: boolean;
  } | null;
  resolvedDestinationWindow: {
    startTime: string | null;
    endTime: string | null;
    overnight: boolean;
  };
  activeTransfer: {
    transferId: number;
    toBranchId: number;
    reason: string | null;
  } | null;
};

function isOvernight(start: string | null, end: string | null): boolean {
  if (!start || !end) return false;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return eh * 60 + em <= sh * 60 + sm;
}

async function resolveDestinationHours(
  toBranchId: number,
  startTime?: string | null,
  endTime?: string | null,
): Promise<{ startTime: string | null; endTime: string | null; overnight: boolean }> {
  if (startTime && endTime) {
    return {
      startTime: startTime.slice(0, 5),
      endTime: endTime.slice(0, 5),
      overnight: isOvernight(startTime, endTime),
    };
  }
  const branch = await getBranchById(toBranchId);
  const start = branch?.defaultOpenTime?.slice(0, 5) ?? null;
  const end = branch?.defaultCloseTime?.slice(0, 5) ?? null;
  return { startTime: start, endTime: end, overnight: isOvernight(start, end) };
}

async function loadEmployeeEmploymentType(empId: number): Promise<string | null> {
  const db = await getPool();
  const r = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`SELECT EmploymentType FROM dbo.TblEmp WHERE EmpID = @empId`);
  const raw = r.recordset[0]?.EmploymentType;
  return raw == null ? null : String(raw);
}

/**
 * Freelancers often lack a weekly working day (or are day-off in branch schedule)
 * while still operational via attendance / home assignment — use that as transfer source.
 */
async function resolveFreelanceOperationalSource(args: {
  empId: number;
  workDate: string;
  toBranchId: number;
}): Promise<OperationalSourceBranch | null> {
  const db = await getPool();
  const emp = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .query(`
      SELECT
        CONVERT(varchar(5), DefaultCheckInTime, 108) AS DefIn,
        CONVERT(varchar(5), DefaultCheckOutTime, 108) AS DefOut
      FROM dbo.TblEmp WHERE EmpID = @empId
    `);
  const defIn = emp.recordset[0]?.DefIn ? String(emp.recordset[0].DefIn).slice(0, 5) : null;
  const defOut = emp.recordset[0]?.DefOut ? String(emp.recordset[0].DefOut).slice(0, 5) : null;

  const att = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('toBranchId', sql.Int, args.toBranchId)
    .query(`
      SELECT TOP 1 BranchID
      FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID <> @toBranchId
      ORDER BY
        CASE WHEN CheckInTime IS NOT NULL THEN 0 ELSE 1 END,
        ID DESC
    `);

  let branchId = att.recordset[0] ? Number(att.recordset[0].BranchID) : null;

  if (branchId == null) {
    const asg = await db
      .request()
      .input('empId', sql.Int, args.empId)
      .input('day', sql.Date, args.workDate)
      .input('toBranchId', sql.Int, args.toBranchId)
      .query(`
        SELECT TOP 1 BranchID
        FROM dbo.TblEmpBranchAssignment
        WHERE EmpID = @empId AND IsActive = 1 AND BranchID <> @toBranchId
          AND EffectiveFrom <= @day AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
        ORDER BY CASE WHEN IsHomeBranch = 1 THEN 0 ELSE 1 END, ID DESC
      `);
    branchId = asg.recordset[0] ? Number(asg.recordset[0].BranchID) : null;
  }

  if (branchId == null) return null;

  const branch = await getBranchById(branchId);
  if (!branch) return null;

  const startTime = defIn ?? branch.defaultOpenTime?.slice(0, 5) ?? null;
  const endTime = defOut ?? branch.defaultCloseTime?.slice(0, 5) ?? null;

  return {
    branchId: branch.branchId,
    branchCode: branch.branchCode,
    branchName: branch.branchName,
    startTime,
    endTime,
  };
}

/** Ensure destination assignment + booking services stamp for freelance day transfer. */
async function provisionFreelanceDestinationForTransfer(args: {
  empId: number;
  workDate: string;
  fromBranchId: number;
  toBranchId: number;
}): Promise<void> {
  await ensureEmployeeBranchAssignment({
    empId: args.empId,
    branchId: args.toBranchId,
    effectiveFrom: args.workDate,
    canReceiveBookings: true,
    isHomeBranch: false,
  });

  const db = await getPool();
  const dest = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.toBranchId)
    .input('day', sql.Date, args.workDate)
    .query(`
      SELECT TOP 1 ID, Notes
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
        AND EffectiveFrom <= @day AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
      ORDER BY ID DESC
    `);
  const destRow = dest.recordset[0];
  if (!destRow) return;

  const destNotes = String(destRow.Notes ?? '');
  if (/services:\d/.test(destNotes)) return;

  const src = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.fromBranchId)
    .input('day', sql.Date, args.workDate)
    .query(`
      SELECT TOP 1 Notes
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
        AND EffectiveFrom <= @day AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
      ORDER BY ID DESC
    `);
  const srcNotes = String(src.recordset[0]?.Notes ?? '');
  if (!/services:\d/.test(srcNotes)) return;

  await db
    .request()
    .input('id', sql.Int, Number(destRow.ID))
    .input('notes', sql.NVarChar(sql.MAX), srcNotes)
    .query(`
      UPDATE dbo.TblEmpBranchAssignment
      SET Notes = @notes, UpdatedAt = SYSUTCDATETIME()
      WHERE ID = @id
    `);
}

/**
 * Preview transfer. FromBranch is resolved from global schedule — never trusted from client.
 */
export async function previewTemporaryBranchTransfer(args: {
  empId: number;
  workDate: string;
  toBranchId: number;
  startTime?: string | null;
  endTime?: string | null;
  /** When true, SETUP destinations may appear for authorized smoke/admin preview. */
  allowSetupDestination?: boolean;
  callerHasSourceAccess?: boolean;
  callerHasDestinationAccess?: boolean;
  /**
   * When true, completed attendance + non-posted payroll blockers become forceable
   * (HR past-date correction). Open attendance / posted payroll stay hard.
   */
  relocateAttendance?: boolean;
}): Promise<TransferPreviewResult> {
  await ensureEmpBranchWorkScheduleTable();
  const blockers: Array<{ code: string; message: string }> = [];
  const warnings: string[] = [];

  const global = await resolveEmployeeGlobalSchedule({
    empId: args.empId,
    workDate: args.workDate,
    publicOnly: false,
  });

  const employmentType = normalizeEmploymentType(await loadEmployeeEmploymentType(args.empId));
  const isFreelance = employmentType === 'freelance';

  let source: OperationalSourceBranch | null =
    global.branches.find((b) => b.isWorking) ?? null;

  // Explicit day_off / EmpDayOff only — empty schedule is a different blocker.
  if (global.hasExplicitDayOff) {
    blockers.push({
      code: 'TRANSFER_GLOBAL_LEAVE_BLOCKS',
      message: 'لا يمكن النقل مع إجازة / غياب يومي عام — ألغِ الغياب أولاً',
    });
  } else if (!source && isFreelance) {
    source = await resolveFreelanceOperationalSource({
      empId: args.empId,
      workDate: args.workDate,
      toBranchId: args.toBranchId,
    });
    if (source) {
      warnings.push(
        'فري لانس: المصدر من الحضور/التعيين التشغيلي (لا يعتمد على جدول أسبوعي لهذا اليوم)',
      );
    } else {
      blockers.push({
        code: 'TRANSFER_NO_SOURCE_SCHEDULE',
        message: 'لا يوجد فرع تشغيلي للفري لانس اليوم — سجّله في حضور الفرع المصدر أولاً',
      });
    }
  } else if (!source) {
    blockers.push({
      code: 'TRANSFER_NO_SOURCE_SCHEDULE',
      message: 'لا يوجد فرع تشغيلي مجدول لهذا اليوم',
    });
  }

  if (source && source.branchId === args.toBranchId) {
    blockers.push({
      code: 'TRANSFER_SAME_BRANCH',
      message: 'فرع المصدر والوجهة متطابقان',
    });
  }

  if (args.callerHasSourceAccess === false) {
    blockers.push({
      code: 'TRANSFER_SOURCE_ACCESS_DENIED',
      message: 'لا تملك صلاحية فرع المصدر',
    });
  }
  if (args.callerHasDestinationAccess === false) {
    blockers.push({
      code: 'TRANSFER_DESTINATION_ACCESS_DENIED',
      message: 'لا تملك صلاحية فرع الوجهة',
    });
  }

  const dest = await getBranchById(args.toBranchId);
  if (!dest) {
    blockers.push({ code: 'BRANCH_NOT_FOUND', message: 'فرع الوجهة غير موجود' });
  } else if (
    !args.allowSetupDestination &&
    (dest.lifecycleStatus === 'SETUP' || !dest.isActive)
  ) {
    blockers.push({
      code: 'TRANSFER_DESTINATION_NOT_OPERATIONAL',
      message: 'فرع الوجهة غير تشغيلي (SETUP / غير نشط) — غير متاح للنقل الاعتيادي',
    });
  }

  // Prefer explicit times → destination branch defaults → source schedule hours.
  // GLEEM historically may lack DefaultOpen/Close; source hours keep emergency transfers usable.
  const window = await resolveDestinationHours(
    args.toBranchId,
    args.startTime || source?.startTime,
    args.endTime || source?.endTime,
  );
  if (!window.startTime || !window.endTime) {
    blockers.push({
      code: 'INVALID_OVERNIGHT_SCHEDULE',
      message: 'نافذة عمل الوجهة غير صالحة — حدّد من/إلى يدوياً',
    });
  }

  const db = await getPool();

  const assign = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.toBranchId)
    .input('day', sql.Date, args.workDate)
    .query(`
      SELECT TOP 1 1 AS X FROM dbo.TblEmpBranchAssignment
      WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
        AND EffectiveFrom <= @day AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
    `);
  if (!assign.recordset[0]) {
    if (isFreelance) {
      warnings.push(
        'فري لانس: تعيين الوجهة غير موجود حالياً — سيُفعَّل تلقائياً عند تطبيق النقل',
      );
    } else {
      blockers.push({
        code: 'EMPLOYEE_NOT_ASSIGNED_TO_BRANCH',
        message: 'التعيين مطلوب في فرع الوجهة',
      });
    }
  }

  const plan = await resolveBranchPayrollPlanForDate({
    empId: args.empId,
    branchId: args.toBranchId,
    workDate: args.workDate,
  });
  if (!plan) {
    if (isFreelance) {
      // Freelancers may already have a plan on another branch; warn — ops can add plan later.
      warnings.push('لا توجد خطة راتب لفرع الوجهة — راجع الرواتب بعد النقل إن لزم');
    } else {
      blockers.push({
        code: 'EMPLOYEE_BRANCH_PAYROLL_PLAN_REQUIRED',
        message: 'اتفاقية راتب الموظف مطلوبة (اضبطها مرة واحدة من بيانات الموظف)',
      });
    }
  }

  // Services stamp (booking eligibility)
  const notes = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.toBranchId)
    .query(`
      SELECT TOP 1 Notes FROM dbo.TblEmpBranchAssignment
      WHERE EmpID=@empId AND BranchID=@branchId AND IsActive=1
      ORDER BY ID DESC
    `);
  const n = String(notes.recordset[0]?.Notes ?? '');
  if (!/services:\d/.test(n)) {
    if (isFreelance) {
      warnings.push(
        'فري لانس: أهلية الخدمات ستُنسخ من فرع المصدر عند تطبيق النقل',
      );
    } else {
      warnings.push('لا توجد خدمات مفعّلة موثّقة في تعيين الوجهة');
      if (!args.allowSetupDestination) {
        blockers.push({
          code: 'EMPLOYEE_BOOKING_SERVICES_REQUIRED',
          message: 'أهلية الخدمات مطلوبة في فرع الوجهة قبل النقل التشغيلي',
        });
      }
    }
  }

  const openAtt = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .query(`
      SELECT TOP 1 BranchID, CheckOutTime
      FROM dbo.TblEmpAttendance
      WHERE EmpID=@empId AND WorkDate=@day AND CheckInTime IS NOT NULL
      ORDER BY ID DESC
    `);
  const attRow = openAtt.recordset[0];
  const attBranchId = attRow ? Number(attRow.BranchID) : null;
  const hasOpen = Boolean(attRow && attRow.CheckOutTime == null);
  const hasCompleted = Boolean(attRow && attRow.CheckOutTime != null);
  if (hasOpen) {
    blockers.push({
      code: 'TRANSFER_ATTENDANCE_CONFLICT',
      message: 'لا يمكن التحويل مع حضور مفتوح',
    });
  } else if (hasCompleted && attBranchId === args.toBranchId) {
    warnings.push('الحضور مسجّل بالفعل في فرع الوجهة');
  } else if (hasCompleted) {
    blockers.push({
      code: 'TRANSFER_ATTENDANCE_COMPLETED',
      message:
        'تم تسجيل حضور/انصراف لهذا اليوم — فعّل «نقل الحضور مع النقل» لتصحيح تاريخ قديم',
    });
  }

  const sourceBranchId = source?.branchId ?? null;
  const bookings =
    sourceBranchId == null
      ? { recordset: [] as Record<string, unknown>[] }
      : await db
          .request()
          .input('empId', sql.Int, args.empId)
          .input('day', sql.Date, args.workDate)
          .input('branchId', sql.Int, sourceBranchId)
          .query(`
            SELECT b.BookingID, b.BookingCode, b.StartTime, b.BranchID, c.Name AS ClientName,
                   br.BranchCode
            FROM dbo.Bookings b
            LEFT JOIN dbo.TblClient c ON c.ClientID = b.ClientID
            LEFT JOIN dbo.TblBranch br ON br.BranchID = b.BranchID
            WHERE b.AssignedEmpID = @empId AND b.BookingDate = @day AND b.BranchID = @branchId
              AND b.Status IN (N'confirmed', N'arrived', N'queued', N'in_service', N'in_progress')
          `)
          .catch(() => ({ recordset: [] as Record<string, unknown>[] }));

  const affectedBookings = bookings.recordset.map((r) => ({
    bookingId: Number(r.BookingID),
    bookingCode: r.BookingCode == null ? null : String(r.BookingCode),
    startTime: String(r.StartTime).slice(0, 5),
    clientName: r.ClientName == null ? null : String(r.ClientName),
    branchId: Number(r.BranchID),
    branchCode: r.BranchCode == null ? null : String(r.BranchCode),
  }));
  if (affectedBookings.length) {
    blockers.push({
      code: 'TEMPORARY_TRANSFER_HAS_SOURCE_BOOKINGS',
      message: 'يوجد حجوزات في فرع المصدر — لا يتم نقل الحجوزات تلقائياً',
    });
  }

  const queue = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .query(`
      SELECT TicketID, TicketCode, Status, BranchID
      FROM dbo.QueueTickets
      WHERE EmpID = @empId AND QueueDate = @day
        AND LOWER(Status) IN ('waiting', 'called', 'in_service')
    `)
    .catch(() => ({ recordset: [] as Record<string, unknown>[] }));

  const affectedQueueTickets = queue.recordset.map((r) => ({
    ticketId: Number(r.TicketID),
    ticketCode: r.TicketCode == null ? null : String(r.TicketCode),
    status: String(r.Status),
    branchId: r.BranchID == null ? null : Number(r.BranchID),
  }));
  if (affectedQueueTickets.length) {
    blockers.push({
      code: 'TRANSFER_ACTIVE_SERVICE_CONFLICT',
      message: 'يوجد طابور/خدمة نشطة — لا يمكن النقل',
    });
  }

  let hasGeneratedPayroll = false;
  let hasPostedPayroll = false;
  let hasLedger = false;
  try {
    const pr = await db
      .request()
      .input('empId', sql.Int, args.empId)
      .input('day', sql.Date, args.workDate)
      .query(`
        SELECT
          SUM(CASE WHEN Status = N'PostedToCashMove' THEN 1 ELSE 0 END) AS PostedCnt,
          SUM(CASE WHEN Status IN (N'Generated', N'Earned', N'PendingCheckout') THEN 1 ELSE 0 END) AS GenCnt
        FROM dbo.TblEmpDailyPayroll
        WHERE EmpID=@empId AND WorkDate=@day
      `);
    hasPostedPayroll = Number(pr.recordset[0]?.PostedCnt ?? 0) > 0;
    hasGeneratedPayroll = Number(pr.recordset[0]?.GenCnt ?? 0) > 0;
  } catch {
    /* table may differ */
  }
  try {
    const ld = await db
      .request()
      .input('empId', sql.Int, args.empId)
      .input('day', sql.Date, args.workDate)
      .query(`
        SELECT TOP 1 1 AS X FROM dbo.TblEmpLedgerEntry
        WHERE EmpID=@empId AND EntryDate=@day AND IsVoided=0
          AND EntryReason=N'hourly_wage'
      `);
    hasLedger = Boolean(ld.recordset[0]);
  } catch {
    try {
      const ld2 = await db
        .request()
        .input('empId', sql.Int, args.empId)
        .input('day', sql.Date, args.workDate)
        .query(`
          SELECT TOP 1 1 AS X FROM dbo.TblEmpHourlyLedger
          WHERE EmpID=@empId AND WorkDate=@day
        `);
      hasLedger = Boolean(ld2.recordset[0]);
    } catch {
      /* optional */
    }
  }
  if (hasPostedPayroll) {
    blockers.push({
      code: 'TRANSFER_PAYROLL_ALREADY_POSTED',
      message: 'اليومية مرحلة للخزنة — ألغِ الترحيل أولاً قبل النقل بتاريخ قديم',
    });
  } else if (hasGeneratedPayroll) {
    blockers.push({
      code: 'TRANSFER_PAYROLL_ALREADY_GENERATED',
      message:
        'تم توليد يومية راتب — مع «نقل الحضور» سيتم نقل اليومية غير المرحلة لفرع الوجهة',
    });
  }
  if (hasLedger && hasPostedPayroll) {
    blockers.push({
      code: 'TRANSFER_LEDGER_ALREADY_POSTED',
      message: 'تم ترحيل دفتر الساعات لهذا اليوم',
    });
  }

  const existing = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .query(`
      SELECT TOP 1 TransferID, ToBranchID, Reason
      FROM dbo.TblEmpTemporaryBranchTransfer
      WHERE EmpID=@empId AND WorkDate=@day AND IsActive=1
      ORDER BY TransferID DESC
    `);
  const activeTransfer = existing.recordset[0]
    ? {
        transferId: Number(existing.recordset[0].TransferID),
        toBranchId: Number(existing.recordset[0].ToBranchID),
        reason: existing.recordset[0].Reason == null ? null : String(existing.recordset[0].Reason),
      }
    : null;
  if (activeTransfer) {
    warnings.push('يوجد نقل نشط لنفس اليوم — سيتم استبداله عبر الخدمة عند التطبيق');
  }

  const { hard: hardNoRelocate, soft: softForceableOnly, relocatable } = splitTransferBlockers(
    blockers,
    { relocateAttendance: false },
  );
  // True hard excludes relocatable (those become soft only with relocateAttendance)
  const trueHard = hardNoRelocate.filter(
    (b) => !RELOCATABLE_TRANSFER_BLOCKER_CODES.has(b.code),
  );
  const canTransfer = blockers.length === 0;
  const canForceTransfer =
    !canTransfer &&
    trueHard.length === 0 &&
    relocatable.length === 0 &&
    softForceableOnly.length > 0 &&
    source != null;
  const canForceWithRelocate =
    !canTransfer &&
    trueHard.length === 0 &&
    relocatable.length > 0 &&
    source != null;

  return {
    canTransfer,
    canForceTransfer,
    canForceWithRelocate,
    requiresRelocate: relocatable.length > 0,
    blockers,
    forceableBlockers: softForceableOnly,
    relocatableBlockers: relocatable,
    warnings,
    affectedBookings,
    affectedQueueTickets,
    attendance: {
      hasOpen,
      hasCompleted,
      branchId: attBranchId,
    },
    payrollState: {
      hasPayroll: hasGeneratedPayroll || hasPostedPayroll,
      hasGeneratedPayroll,
      hasPostedPayroll,
      hasLedger,
    },
    sourceBranch: source
      ? {
          branchId: source.branchId,
          branchCode: source.branchCode,
          branchName: source.branchName,
          startTime: source.startTime,
          endTime: source.endTime,
        }
      : null,
    destinationBranch: dest
      ? {
          branchId: dest.branchId,
          branchCode: dest.branchCode,
          branchName: dest.branchName,
          lifecycleStatus: dest.lifecycleStatus,
          isActive: dest.isActive,
          publicBookingEnabled: dest.publicBookingEnabled,
        }
      : null,
    resolvedDestinationWindow: window,
    activeTransfer,
  };
}

export async function createTemporaryBranchTransfer(args: {
  empId: number;
  /** Ignored when workDate provided — resolved from schedule. Kept for 1Q smoke callers. */
  fromBranchId?: number;
  toBranchId: number;
  workDate: string;
  startTime?: string | null;
  endTime?: string | null;
  reason: string;
  createdByUserId?: number | null;
  allowSetupDestination?: boolean;
  callerHasSourceAccess?: boolean;
  callerHasDestinationAccess?: boolean;
  /**
   * Emergency override for soft blockers (missing dest assignment/payroll/services,
   * or remaining source bookings that are not auto-moved).
   */
  forceDespiteBlockers?: boolean;
  /**
   * Past-date correction: move completed attendance + non-posted payroll/ledger
   * BranchID to destination. Required when canForceWithRelocate.
   */
  relocateAttendance?: boolean;
}): Promise<{
  transferId: number;
  fromBranchId: number;
  forced: boolean;
  relocatedAttendance: boolean;
}> {
  if (!args.reason?.trim()) {
    throw new SchedulePolicyError('TRANSFER_REASON_REQUIRED', 'السبب مطلوب', 400);
  }

  const relocate = args.relocateAttendance === true;
  const preview = await previewTemporaryBranchTransfer({
    empId: args.empId,
    workDate: args.workDate,
    toBranchId: args.toBranchId,
    startTime: args.startTime,
    endTime: args.endTime,
    allowSetupDestination: args.allowSetupDestination,
    callerHasSourceAccess: args.callerHasSourceAccess,
    callerHasDestinationAccess: args.callerHasDestinationAccess,
    relocateAttendance: relocate,
  });

  const force = args.forceDespiteBlockers === true;
  const allowed =
    preview.sourceBranch != null &&
    (preview.canTransfer ||
      (force && preview.canForceTransfer) ||
      (force && relocate && preview.canForceWithRelocate));

  if (!allowed) {
    const { hard } = splitTransferBlockers(preview.blockers, {
      relocateAttendance: relocate,
    });
    const first = (force ? hard[0] : preview.blockers[0]) ?? null;
    throw new SchedulePolicyError(
      first?.code ?? 'TRANSFER_BLOCKED',
      first?.message ?? 'النقل غير مسموح',
      409,
      { preview, forceRequested: force, relocateRequested: relocate },
    );
  }

  // Never trust browser FromBranchID — resolver / operational source is authoritative
  const fromBranchId = preview.sourceBranch!.branchId;
  if (args.fromBranchId != null && args.fromBranchId !== fromBranchId) {
    throw new SchedulePolicyError(
      'TRANSFER_FROM_BRANCH_MISMATCH',
      'فرع المصدر يجب أن يُستنتج من الجدول وليس من العميل',
      400,
    );
  }

  const employmentType = normalizeEmploymentType(await loadEmployeeEmploymentType(args.empId));
  if (employmentType === 'freelance') {
    await provisionFreelanceDestinationForTransfer({
      empId: args.empId,
      workDate: args.workDate,
      fromBranchId,
      toBranchId: args.toBranchId,
    });
  }

  const forced = force && !preview.canTransfer;
  const overrideCodes = [
    ...preview.forceableBlockers.map((b) => b.code),
    ...(relocate ? preview.relocatableBlockers.map((b) => b.code) : []),
  ];
  const reasonText = forced
    ? `${args.reason.trim()} [نقل إجباري رغم: ${overrideCodes.join(', ')}${
        relocate ? ' | relocateAttendance' : ''
      }]`
    : args.reason.trim();

  const window = preview.resolvedDestinationWindow;
  const db = await getPool();

  if (relocate && preview.requiresRelocate) {
    await relocateAttendanceAndPayrollForTransfer({
      empId: args.empId,
      workDate: args.workDate,
      fromBranchId,
      toBranchId: args.toBranchId,
    });
  }

  await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .query(`
      UPDATE dbo.TblEmpTemporaryBranchTransfer
      SET IsActive = 0, UpdatedAt = SYSUTCDATETIME()
      WHERE EmpID = @empId AND WorkDate = @day AND IsActive = 1
    `);

  const ins = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('from', sql.Int, fromBranchId)
    .input('to', sql.Int, args.toBranchId)
    .input('day', sql.Date, args.workDate)
    .input('start', sql.VarChar(8), window.startTime ?? null)
    .input('end', sql.VarChar(8), window.endTime ?? null)
    .input('reason', sql.NVarChar(250), reasonText.slice(0, 250))
    .input('actor', sql.Int, args.createdByUserId ?? null)
    .query(`
      INSERT INTO dbo.TblEmpTemporaryBranchTransfer (
        EmpID, FromBranchID, ToBranchID, WorkDate, StartTime, EndTime,
        Reason, CreatedByUserID, IsActive
      )
      OUTPUT INSERTED.TransferID
      VALUES (
        @empId, @from, @to, @day,
        CASE WHEN @start IS NULL THEN NULL ELSE CAST(@start AS time) END,
        CASE WHEN @end IS NULL THEN NULL ELSE CAST(@end AS time) END,
        @reason, @actor, 1
      )
    `);

  const transferId = Number(ins.recordset[0].TransferID);
  invalidateTemporaryTransferCaches({
    empId: args.empId,
    workDate: args.workDate,
    fromBranchId,
    toBranchId: args.toBranchId,
  });

  return {
    transferId,
    fromBranchId,
    forced,
    relocatedAttendance: Boolean(relocate && preview.requiresRelocate),
  };
}

async function relocateAttendanceAndPayrollForTransfer(args: {
  empId: number;
  workDate: string;
  fromBranchId: number;
  toBranchId: number;
}): Promise<void> {
  const db = await getPool();

  await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('from', sql.Int, args.fromBranchId)
    .input('to', sql.Int, args.toBranchId)
    .query(`
      UPDATE dbo.TblEmpAttendance
      SET BranchID = @to
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID = @from
        AND CheckInTime IS NOT NULL AND CheckOutTime IS NOT NULL
    `);

  // Also move attendance that landed on a third branch (ops mistake) toward destination
  await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('to', sql.Int, args.toBranchId)
    .query(`
      UPDATE dbo.TblEmpAttendance
      SET BranchID = @to
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID <> @to
        AND CheckInTime IS NOT NULL AND CheckOutTime IS NOT NULL
    `);

  const payroll = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('to', sql.Int, args.toBranchId)
    .query(`
      UPDATE dbo.TblEmpDailyPayroll
      SET BranchID = @to, UpdatedAt = GETDATE()
      OUTPUT INSERTED.ID
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID <> @to
        AND Status IN (N'Generated', N'Earned', N'PendingCheckout')
    `);

  const payrollIds = payroll.recordset.map((r) => Number(r.ID)).filter((id) => id > 0);
  if (payrollIds.length === 0) return;

  try {
    for (const payrollId of payrollIds) {
      await db
        .request()
        .input('payrollId', sql.Int, payrollId)
        .input('to', sql.Int, args.toBranchId)
        .query(`
          UPDATE dbo.TblEmpLedgerEntry
          SET BranchID = @to
          WHERE RefType = N'TblEmpDailyPayroll' AND RefID = @payrollId AND IsVoided = 0
        `);
    }
  } catch {
    /* ledger table optional / schema differs */
  }
}

export type TemporaryTransferListRow = {
  transferId: number;
  empId: number;
  empName: string;
  fromBranchId: number;
  fromBranchCode: string;
  fromBranchName: string;
  toBranchId: number;
  toBranchCode: string;
  toBranchName: string;
  workDate: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
  isActive: boolean;
  createdAt: string | null;
};

export async function listTemporaryBranchTransfers(args: {
  fromDate: string;
  toDate: string;
  empId?: number | null;
  activeOnly?: boolean;
}): Promise<TemporaryTransferListRow[]> {
  await ensureEmpBranchWorkScheduleTable();
  const db = await getPool();
  const req = db
    .request()
    .input('from', sql.Date, args.fromDate)
    .input('to', sql.Date, args.toDate);
  if (args.empId != null) req.input('empId', sql.Int, args.empId);

  const result = await req.query(`
    SELECT
      t.TransferID,
      t.EmpID,
      e.EmpName,
      t.FromBranchID,
      fb.BranchCode AS FromBranchCode,
      fb.BranchName AS FromBranchName,
      t.ToBranchID,
      tb.BranchCode AS ToBranchCode,
      tb.BranchName AS ToBranchName,
      CONVERT(varchar(10), t.WorkDate, 23) AS WorkDate,
      CONVERT(varchar(5), t.StartTime, 108) AS StartTime,
      CONVERT(varchar(5), t.EndTime, 108) AS EndTime,
      t.Reason,
      t.IsActive,
      CONVERT(varchar(33), t.CreatedAt, 126) AS CreatedAt
    FROM dbo.TblEmpTemporaryBranchTransfer t
    INNER JOIN dbo.TblEmp e ON e.EmpID = t.EmpID
    LEFT JOIN dbo.TblBranch fb ON fb.BranchID = t.FromBranchID
    LEFT JOIN dbo.TblBranch tb ON tb.BranchID = t.ToBranchID
    WHERE t.WorkDate >= @from AND t.WorkDate <= @to
      ${args.empId != null ? 'AND t.EmpID = @empId' : ''}
      ${args.activeOnly === true ? 'AND t.IsActive = 1' : ''}
    ORDER BY t.WorkDate DESC, t.TransferID DESC
  `);

  return result.recordset.map((r) => ({
    transferId: Number(r.TransferID),
    empId: Number(r.EmpID),
    empName: String(r.EmpName ?? ''),
    fromBranchId: Number(r.FromBranchID),
    fromBranchCode: String(r.FromBranchCode ?? ''),
    fromBranchName: String(r.FromBranchName ?? ''),
    toBranchId: Number(r.ToBranchID),
    toBranchCode: String(r.ToBranchCode ?? ''),
    toBranchName: String(r.ToBranchName ?? ''),
    workDate: String(r.WorkDate).slice(0, 10),
    startTime: r.StartTime == null ? null : String(r.StartTime).slice(0, 5),
    endTime: r.EndTime == null ? null : String(r.EndTime).slice(0, 5),
    reason: r.Reason == null ? null : String(r.Reason),
    isActive: Boolean(r.IsActive),
    createdAt: r.CreatedAt == null ? null : String(r.CreatedAt),
  }));
}

export async function cancelTemporaryBranchTransfer(args: {
  empId: number;
  workDate: string;
  reason: string;
  actorUserId?: number | null;
}): Promise<{ cancelledTransferId: number }> {
  if (!args.reason?.trim()) {
    throw new SchedulePolicyError('TRANSFER_REASON_REQUIRED', 'سبب الإلغاء مطلوب', 400);
  }
  await ensureEmpBranchWorkScheduleTable();
  const db = await getPool();

  const existing = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .query(`
      SELECT TOP 1 TransferID, FromBranchID, ToBranchID
      FROM dbo.TblEmpTemporaryBranchTransfer
      WHERE EmpID=@empId AND WorkDate=@day AND IsActive=1
      ORDER BY TransferID DESC
    `);
  if (!existing.recordset[0]) {
    throw new SchedulePolicyError('TRANSFER_NOT_FOUND', 'لا يوجد نقل نشط', 404);
  }
  const transferId = Number(existing.recordset[0].TransferID);
  const fromBranchId = Number(existing.recordset[0].FromBranchID);
  const toBranchId = Number(existing.recordset[0].ToBranchID);

  // Dependent activity at destination blocks cancel
  const openAtt = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('branchId', sql.Int, toBranchId)
    .query(`
      SELECT TOP 1 1 AS X FROM dbo.TblEmpAttendance
      WHERE EmpID=@empId AND WorkDate=@day AND BranchID=@branchId AND CheckInTime IS NOT NULL
    `);
  if (openAtt.recordset[0]) {
    throw new SchedulePolicyError(
      'TRANSFER_ATTENDANCE_CONFLICT',
      'لا يمكن إلغاء النقل بعد تسجيل حضور في الوجهة',
      409,
    );
  }

  const queue = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('branchId', sql.Int, toBranchId)
    .query(`
      SELECT TOP 1 1 AS X FROM dbo.QueueTickets
      WHERE EmpID=@empId AND QueueDate=@day AND BranchID=@branchId
        AND LOWER(Status) IN ('waiting', 'called', 'in_service')
    `)
    .catch(() => ({ recordset: [] as Record<string, unknown>[] }));
  if (queue.recordset[0]) {
    throw new SchedulePolicyError(
      'TRANSFER_ACTIVE_SERVICE_CONFLICT',
      'لا يمكن إلغاء النقل مع نشاط طابور في الوجهة',
      409,
    );
  }

  // Soft-deactivate only — never hard delete
  await db
    .request()
    .input('id', sql.BigInt, transferId)
    .input('reason', sql.NVarChar(250), `cancel: ${args.reason.trim()}`)
    .query(`
      UPDATE dbo.TblEmpTemporaryBranchTransfer
      SET IsActive = 0,
          Reason = CASE
            WHEN Reason IS NULL OR Reason = N'' THEN @reason
            ELSE CONCAT(Reason, N' | ', @reason)
          END,
          UpdatedAt = SYSUTCDATETIME()
      WHERE TransferID = @id
    `);

  invalidateTemporaryTransferCaches({
    empId: args.empId,
    workDate: args.workDate,
    fromBranchId,
    toBranchId,
  });

  // Confirm resolver restores recurring schedule
  void resolveEmployeeBranchSchedule({
    empId: args.empId,
    branchId: fromBranchId,
    workDate: args.workDate,
  });

  return { cancelledTransferId: transferId };
}
