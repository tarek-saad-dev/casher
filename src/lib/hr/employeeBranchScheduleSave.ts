/**
 * Phase 1Q — schedule conflict detection + save helpers.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { BranchDomainError } from '@/lib/branch/types';
import {
  BRANCH_SCHEDULE_POLICY,
  ensureEmpBranchWorkScheduleTable,
} from '@/lib/hr/empBranchWorkSchedule';
import { resolveBranchPayrollPlanForDate } from '@/lib/payroll/branchPayrollPlan';

export class SchedulePolicyError extends Error {
  code: string;
  status: number;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, status = 409, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type WeeklyScheduleCellInput = {
  dayOfWeek: number;
  isWorking: boolean;
  startTime?: string | null;
  endTime?: string | null;
  canReceiveBookings?: boolean;
};

/**
 * Reject same weekday working in two branches for overlapping effective periods.
 */
export async function assertNoCrossBranchSameWeekdayConflict(args: {
  empId: number;
  branchId: number;
  dayOfWeek: number;
  isWorking: boolean;
  effectiveFrom: string;
  effectiveTo?: string | null;
  excludeScheduleId?: number | null;
}): Promise<void> {
  if (!args.isWorking) return;
  await ensureEmpBranchWorkScheduleTable();
  const db = await getPool();
  const req = db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .input('dow', sql.TinyInt, args.dayOfWeek)
    .input('from', sql.Date, args.effectiveFrom)
    .input('to', sql.Date, args.effectiveTo ?? null);

  let excludeSql = '';
  if (args.excludeScheduleId) {
    req.input('excludeId', sql.BigInt, args.excludeScheduleId);
    excludeSql = 'AND ScheduleID <> @excludeId';
  }

  const conflict = await req.query(`
    SELECT TOP 1 ScheduleID, BranchID
    FROM dbo.TblEmpBranchWorkSchedule
    WHERE EmpID = @empId
      AND BranchID <> @branchId
      AND DayOfWeek = @dow
      AND IsActive = 1
      AND IsWorking = 1
      ${excludeSql}
      AND EffectiveFrom <= ISNULL(@to, CAST('9999-12-31' AS date))
      AND ISNULL(EffectiveTo, CAST('9999-12-31' AS date)) >= @from
  `);

  if (conflict.recordset[0]) {
    throw new SchedulePolicyError(
      'EMPLOYEE_MULTI_BRANCH_SAME_WORKDAY_NOT_ALLOWED',
      `لا يمكن جدولة الموظف في فرعين لنفس يوم الأسبوع (${BRANCH_SCHEDULE_POLICY})`,
      409,
      {
        otherBranchId: Number(conflict.recordset[0].BranchID),
        dayOfWeek: args.dayOfWeek,
        policy: BRANCH_SCHEDULE_POLICY,
      },
    );
  }
}

export async function assertAssignmentAndPayrollForWorkingSchedule(args: {
  empId: number;
  branchId: number;
  effectiveFrom: string;
  requireServicesIfBooking?: boolean;
  canReceiveBookings?: boolean;
  serviceProIds?: number[];
}): Promise<void> {
  const db = await getPool();
  const assign = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .input('day', sql.Date, args.effectiveFrom)
    .query(`
      SELECT TOP 1 ID
      FROM dbo.TblEmpBranchAssignment
      WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
        AND EffectiveFrom <= @day
        AND (EffectiveTo IS NULL OR EffectiveTo >= @day)
    `);
  if (!assign.recordset[0]) {
    throw new SchedulePolicyError(
      'EMPLOYEE_NOT_ASSIGNED_TO_BRANCH',
      'لا يوجد تعيين فعال للموظف في هذا الفرع',
      400,
    );
  }

  const plan = await resolveBranchPayrollPlanForDate({
    empId: args.empId,
    branchId: args.branchId,
    workDate: args.effectiveFrom,
  });
  if (!plan) {
    throw new SchedulePolicyError(
      'EMPLOYEE_BRANCH_PAYROLL_PLAN_REQUIRED',
      'خطة راتب الفرع مطلوبة قبل حفظ جدول عمل تشغيلي',
      400,
    );
  }

  if (args.canReceiveBookings && args.requireServicesIfBooking !== false) {
    const services = args.serviceProIds ?? [];
    if (services.length === 0) {
      // Check Notes on assignment for services:… stamp from Phase 1O
      const notes = await db
        .request()
        .input('empId', sql.Int, args.empId)
        .input('branchId', sql.Int, args.branchId)
        .query(`
          SELECT TOP 1 Notes FROM dbo.TblEmpBranchAssignment
          WHERE EmpID = @empId AND BranchID = @branchId AND IsActive = 1
          ORDER BY ID DESC
        `);
      const n = String(notes.recordset[0]?.Notes ?? '');
      if (!/services:\d/.test(n)) {
        throw new SchedulePolicyError(
          'EMPLOYEE_BRANCH_SERVICE_ELIGIBILITY_REQUIRED',
          'جدولة الحجز تتطلب أهلية خدمة واحدة على الأقل في الفرع',
          400,
        );
      }
    }
  }
}

/**
 * Replace weekly schedule cells for Emp+Branch in one transaction (effectiveFrom version).
 */
export async function saveEmployeeBranchWeeklySchedule(args: {
  empId: number;
  branchId: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  cells: WeeklyScheduleCellInput[];
  actorUserId?: number | null;
  skipPayrollCheck?: boolean;
  /** Phase 1R global multi-branch atomic save validates the full matrix first. */
  skipCrossBranchConflictCheck?: boolean;
}): Promise<{ saved: number }> {
  await ensureEmpBranchWorkScheduleTable();

  const working = args.cells.filter((c) => c.isWorking);
  if (!args.skipCrossBranchConflictCheck) {
    for (const cell of working) {
      await assertNoCrossBranchSameWeekdayConflict({
        empId: args.empId,
        branchId: args.branchId,
        dayOfWeek: cell.dayOfWeek,
        isWorking: true,
        effectiveFrom: args.effectiveFrom,
        effectiveTo: args.effectiveTo ?? null,
      });
    }
  }

  if (working.length && !args.skipPayrollCheck) {
    await assertAssignmentAndPayrollForWorkingSchedule({
      empId: args.empId,
      branchId: args.branchId,
      effectiveFrom: args.effectiveFrom,
      canReceiveBookings: working.some((c) => c.canReceiveBookings !== false),
    });
  }

  const db = await getPool();
  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    // Close prior open versions overlapping this from-date for same emp+branch+days
    for (const cell of args.cells) {
      await new sql.Request(tx)
        .input('empId', sql.Int, args.empId)
        .input('branchId', sql.Int, args.branchId)
        .input('dow', sql.TinyInt, cell.dayOfWeek)
        .input('from', sql.Date, args.effectiveFrom)
        .query(`
          UPDATE dbo.TblEmpBranchWorkSchedule
          SET EffectiveTo = DATEADD(day, -1, @from),
              UpdatedAt = SYSUTCDATETIME()
          WHERE EmpID = @empId AND BranchID = @branchId AND DayOfWeek = @dow
            AND IsActive = 1
            AND EffectiveFrom < @from
            AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
        `);

      await new sql.Request(tx)
        .input('empId', sql.Int, args.empId)
        .input('branchId', sql.Int, args.branchId)
        .input('dow', sql.TinyInt, cell.dayOfWeek)
        .input('work', sql.Bit, cell.isWorking ? 1 : 0)
        .input('start', sql.VarChar(8), cell.startTime ?? null)
        .input('end', sql.VarChar(8), cell.endTime ?? null)
        .input('from', sql.Date, args.effectiveFrom)
        .input('to', sql.Date, args.effectiveTo ?? null)
        .input('canBook', sql.Bit, cell.canReceiveBookings === false ? 0 : 1)
        .input('actor', sql.Int, args.actorUserId ?? null)
        .query(`
          INSERT INTO dbo.TblEmpBranchWorkSchedule (
            EmpID, BranchID, DayOfWeek, IsWorking, StartTime, EndTime,
            EffectiveFrom, EffectiveTo, IsActive, CanReceiveBookings, Notes, CreatedByUserID
          )
          VALUES (
            @empId, @branchId, @dow, @work,
            CASE WHEN @start IS NULL THEN NULL ELSE CAST(@start AS time) END,
            CASE WHEN @end IS NULL THEN NULL ELSE CAST(@end AS time) END,
            @from, @to, 1, @canBook, N'phase1q-admin-save', @actor
          )
        `);
    }
    await tx.commit();
    return { saved: args.cells.length };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    if (err instanceof SchedulePolicyError || err instanceof BranchDomainError) throw err;
    throw err;
  }
}
