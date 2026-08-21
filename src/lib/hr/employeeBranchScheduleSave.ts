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
  const { ensureEmployeeBranchAssignment } = await import('@/lib/branch/assignmentIntegrity');
  await ensureEmployeeBranchAssignment({
    empId: args.empId,
    branchId: args.branchId,
    effectiveFrom: args.effectiveFrom,
    canReceiveBookings: args.canReceiveBookings !== false,
    isHomeBranch: false,
  });

  let plan = await resolveBranchPayrollPlanForDate({
    empId: args.empId,
    branchId: args.branchId,
    workDate: args.effectiveFrom,
  });

  if (!plan) {
    await bootstrapBranchPayrollPlanFromEmpProfile({
      empId: args.empId,
      branchId: args.branchId,
      effectiveFrom: args.effectiveFrom,
    });
    plan = await resolveBranchPayrollPlanForDate({
      empId: args.empId,
      branchId: args.branchId,
      workDate: args.effectiveFrom,
    });
  }

  if (!plan) {
    throw new SchedulePolicyError(
      'EMPLOYEE_BRANCH_PAYROLL_PLAN_REQUIRED',
      'اتفاقية الراتب مطلوبة قبل حفظ جدول عمل تشغيلي — اضبط الراتب مرة واحدة من بيانات الموظف (تُطبَّق على كل الفروع)',
      400,
    );
  }

  const db = await getPool();

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
 * Create a branch payroll plan from TblEmp rates when the employee was never
 * included in Phase 1L backfill (common for staff added later).
 */
async function bootstrapBranchPayrollPlanFromEmpProfile(args: {
  empId: number;
  branchId: number;
  effectiveFrom: string;
}): Promise<void> {
  const db = await getPool();
  const emp = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .query(`
      SELECT
        PayrollMethod,
        HourlyRate,
        ManualHourlyRate,
        DailyRate,
        BaseSalary,
        Salary,
        SalaryType
      FROM dbo.TblEmp
      WHERE EmpID = @empId
    `);
  const row = emp.recordset[0] as Record<string, unknown> | undefined;
  if (!row) return;

  const hourly =
    row.HourlyRate != null && Number(row.HourlyRate) > 0
      ? Number(row.HourlyRate)
      : row.ManualHourlyRate != null && Number(row.ManualHourlyRate) > 0
        ? Number(row.ManualHourlyRate)
        : null;
  const daily =
    row.DailyRate != null && Number(row.DailyRate) > 0
      ? Number(row.DailyRate)
      : String(row.SalaryType ?? '') === 'Daily' && row.Salary != null && Number(row.Salary) > 0
        ? Number(row.Salary)
        : null;
  const monthly =
    row.BaseSalary != null && Number(row.BaseSalary) > 0
      ? Number(row.BaseSalary)
      : String(row.SalaryType ?? '') !== 'Daily' && row.Salary != null && Number(row.Salary) > 0
        ? Number(row.Salary)
        : null;

  const method = String(row.PayrollMethod ?? '').toLowerCase();
  let payType: 'hourly' | 'daily' | 'monthly' = 'hourly';
  if (method === 'daily' || (!hourly && daily)) payType = 'daily';
  else if (method === 'monthly' || (!hourly && !daily && monthly)) payType = 'monthly';

  if (payType === 'hourly' && !(hourly && hourly > 0)) {
    if (daily && daily > 0) payType = 'daily';
    else if (monthly && monthly > 0) payType = 'monthly';
    else return;
  } else if (payType === 'daily' && !(daily && daily > 0)) {
    if (hourly && hourly > 0) payType = 'hourly';
    else if (monthly && monthly > 0) payType = 'monthly';
    else return;
  } else if (payType === 'monthly' && !(monthly && monthly > 0)) {
    if (hourly && hourly > 0) payType = 'hourly';
    else if (daily && daily > 0) payType = 'daily';
    else return;
  }

  await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('branchId', sql.Int, args.branchId)
    .input('payType', sql.NVarChar(20), payType)
    .input('hourly', sql.Decimal(18, 4), payType === 'hourly' ? hourly : hourly)
    .input('daily', sql.Decimal(18, 4), daily)
    .input('monthly', sql.Decimal(18, 4), monthly)
    .input('from', sql.Date, args.effectiveFrom)
    .query(`
      INSERT INTO dbo.TblEmpBranchPayrollPlan (
        EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
        EffectiveFrom, EffectiveTo, IsActive, SourceNotes
      )
      VALUES (
        @empId, @branchId, @payType, @hourly, @daily, @monthly,
        @from, NULL, 1, N'auto-bootstrap from TblEmp on branch-schedule save'
      )
    `);
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
      requireServicesIfBooking: false,
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

      // Same EffectiveFrom re-save used to leave duplicate active rows; supersede them.
      await new sql.Request(tx)
        .input('empId', sql.Int, args.empId)
        .input('branchId', sql.Int, args.branchId)
        .input('dow', sql.TinyInt, cell.dayOfWeek)
        .input('from', sql.Date, args.effectiveFrom)
        .query(`
          UPDATE dbo.TblEmpBranchWorkSchedule
          SET IsActive = 0,
              UpdatedAt = SYSUTCDATETIME()
          WHERE EmpID = @empId AND BranchID = @branchId AND DayOfWeek = @dow
            AND IsActive = 1
            AND EffectiveFrom = @from
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
    void import('@/lib/booking/cache/hotCacheInvalidateBestEffort')
      .then((m) =>
        m.notifyHotWeeklyBaseline({
          employeeId: args.empId,
          branchId: args.branchId,
          reason: 'employee_branch_weekly_schedule',
        }),
      )
      .catch(() => undefined);
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
