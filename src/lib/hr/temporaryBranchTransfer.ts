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

export type TransferPreviewResult = {
  canTransfer: boolean;
  blockers: Array<{ code: string; message: string }>;
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
}): Promise<TransferPreviewResult> {
  await ensureEmpBranchWorkScheduleTable();
  const blockers: Array<{ code: string; message: string }> = [];
  const warnings: string[] = [];

  const global = await resolveEmployeeGlobalSchedule({
    empId: args.empId,
    workDate: args.workDate,
    publicOnly: false,
  });

  if (global.isGlobalDayOff) {
    blockers.push({
      code: 'TRANSFER_GLOBAL_LEAVE_BLOCKS',
      message: 'لا يمكن النقل مع إجازة / غياب يومي عام — ألغِ الغياب أولاً',
    });
  }

  const source = global.branches.find((b) => b.isWorking) ?? null;
  if (!source && !global.isGlobalDayOff) {
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

  const window = await resolveDestinationHours(
    args.toBranchId,
    args.startTime,
    args.endTime,
  );
  if (!window.startTime || !window.endTime) {
    blockers.push({
      code: 'INVALID_OVERNIGHT_SCHEDULE',
      message: 'نافذة عمل الوجهة غير صالحة',
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
    blockers.push({
      code: 'EMPLOYEE_NOT_ASSIGNED_TO_BRANCH',
      message: 'التعيين مطلوب في فرع الوجهة',
    });
  }

  const plan = await resolveBranchPayrollPlanForDate({
    empId: args.empId,
    branchId: args.toBranchId,
    workDate: args.workDate,
  });
  if (!plan) {
    blockers.push({
      code: 'EMPLOYEE_BRANCH_PAYROLL_PLAN_REQUIRED',
      message: 'خطة راتب فرع الوجهة مطلوبة',
    });
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
    warnings.push('لا توجد خدمات مفعّلة موثّقة في تعيين الوجهة');
    if (!args.allowSetupDestination) {
      blockers.push({
        code: 'EMPLOYEE_BOOKING_SERVICES_REQUIRED',
        message: 'أهلية الخدمات مطلوبة في فرع الوجهة قبل النقل التشغيلي',
      });
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
      ORDER BY AttendanceID DESC
    `);
  const attRow = openAtt.recordset[0];
  const hasOpen = Boolean(attRow && attRow.CheckOutTime == null);
  const hasCompleted = Boolean(attRow && attRow.CheckOutTime != null);
  if (hasOpen) {
    blockers.push({
      code: 'TRANSFER_ATTENDANCE_CONFLICT',
      message: 'لا يمكن التحويل مع حضور مفتوح',
    });
  }
  if (hasCompleted) {
    blockers.push({
      code: 'TRANSFER_ATTENDANCE_CONFLICT',
      message: 'تم تسجيل حضور/انصراف لهذا اليوم — لا يمكن النقل',
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

  let hasPayroll = false;
  let hasLedger = false;
  try {
    const pr = await db
      .request()
      .input('empId', sql.Int, args.empId)
      .input('day', sql.Date, args.workDate)
      .query(`
        SELECT TOP 1 1 AS X FROM dbo.TblEmpDailyPayroll
        WHERE EmpID=@empId AND WorkDate=@day
      `);
    hasPayroll = Boolean(pr.recordset[0]);
  } catch {
    /* table may differ */
  }
  try {
    const ld = await db
      .request()
      .input('empId', sql.Int, args.empId)
      .input('day', sql.Date, args.workDate)
      .query(`
        SELECT TOP 1 1 AS X FROM dbo.TblEmpHourlyLedger
        WHERE EmpID=@empId AND WorkDate=@day
      `);
    hasLedger = Boolean(ld.recordset[0]);
  } catch {
    /* optional */
  }
  if (hasPayroll) {
    blockers.push({
      code: 'TRANSFER_PAYROLL_ALREADY_GENERATED',
      message: 'تم توليد يومية راتب لهذا اليوم',
    });
  }
  if (hasLedger) {
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

  return {
    canTransfer: blockers.length === 0,
    blockers,
    warnings,
    affectedBookings,
    affectedQueueTickets,
    attendance: {
      hasOpen,
      hasCompleted,
      branchId: attRow ? Number(attRow.BranchID) : null,
    },
    payrollState: { hasPayroll, hasLedger },
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
}): Promise<{ transferId: number; fromBranchId: number }> {
  if (!args.reason?.trim()) {
    throw new SchedulePolicyError('TRANSFER_REASON_REQUIRED', 'السبب مطلوب', 400);
  }

  const preview = await previewTemporaryBranchTransfer({
    empId: args.empId,
    workDate: args.workDate,
    toBranchId: args.toBranchId,
    startTime: args.startTime,
    endTime: args.endTime,
    allowSetupDestination: args.allowSetupDestination,
    callerHasSourceAccess: args.callerHasSourceAccess,
    callerHasDestinationAccess: args.callerHasDestinationAccess,
  });

  if (!preview.canTransfer || !preview.sourceBranch) {
    const first = preview.blockers[0];
    throw new SchedulePolicyError(
      first?.code ?? 'TRANSFER_BLOCKED',
      first?.message ?? 'النقل غير مسموح',
      409,
      { preview },
    );
  }

  // Never trust browser FromBranchID — resolver is authoritative
  const fromBranchId = preview.sourceBranch.branchId;
  if (args.fromBranchId != null && args.fromBranchId !== fromBranchId) {
    throw new SchedulePolicyError(
      'TRANSFER_FROM_BRANCH_MISMATCH',
      'فرع المصدر يجب أن يُستنتج من الجدول وليس من العميل',
      400,
    );
  }

  const window = preview.resolvedDestinationWindow;
  const db = await getPool();

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
    .input('reason', sql.NVarChar(250), args.reason.trim())
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

  return { transferId, fromBranchId };
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
