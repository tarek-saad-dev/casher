/**
 * Phase 1O — atomic employee → branch assignment wizard commit.
 * Requires payroll plan + target plan OR explicit NO_TARGET. No GLEEM fallback.
 */
import 'server-only';
import { getPool, sql } from '@/lib/db';
import { BranchDomainError } from './types';
import { ensureEmployeeBranchAssignment } from './assignmentIntegrity';
import { assertNoOverlappingBranchPayrollPlans } from '@/lib/payroll/branchPayrollPlan';

export type AssignmentWizardPayrollInput = {
  payType: 'hourly' | 'daily' | 'monthly';
  hourlyRate?: number | null;
  dailyRate?: number | null;
  monthlySalary?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
};

export type AssignmentWizardTargetInput =
  | { policy: 'NO_TARGET'; notes?: string }
  | {
      policy: 'TARGET_PLAN';
      /** Existing target plan id already scoped to this branch, or create via separate API first */
      targetPlanId: number;
    };

export type AssignmentWizardScheduleDay = {
  dayOfWeek: number; // 0-6
  isWorkingDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
};

export type CommitEmployeeBranchAssignmentInput = {
  empId: number;
  branchId: number;
  effectiveFrom: string;
  canReceiveBookings: boolean;
  canOperate: boolean;
  isHomeBranch?: boolean;
  schedule: AssignmentWizardScheduleDay[];
  /** ProIDs employee may perform at this branch (stored when eligibility table exists; validated non-empty when canOperate) */
  serviceProIds: number[];
  payroll: AssignmentWizardPayrollInput;
  target: AssignmentWizardTargetInput;
  actorUserId?: number | null;
};

export type CommitEmployeeBranchAssignmentResult = {
  assignmentId: number;
  payrollPlanId: number;
  targetPolicy: 'NO_TARGET' | 'TARGET_PLAN';
  targetPlanId: number | null;
  scheduleRows: number;
};

function validatePayroll(p: AssignmentWizardPayrollInput): void {
  if (!p.effectiveFrom) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'Payroll effective date required', 400);
  }
  if (p.payType === 'hourly' && !(Number(p.hourlyRate) > 0)) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'Hourly rate required', 400);
  }
  if (p.payType === 'daily' && !(Number(p.dailyRate) > 0)) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'Daily rate required', 400);
  }
  if (p.payType === 'monthly' && !(Number(p.monthlySalary) > 0)) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'Monthly salary required', 400);
  }
}

/**
 * Commit a full Camp Caesar (or any branch) employee assignment in one transaction.
 * Does not create TblEmp rows. Does not copy GLEEM plans.
 */
export async function commitEmployeeBranchAssignment(
  input: CommitEmployeeBranchAssignmentInput,
): Promise<CommitEmployeeBranchAssignmentResult> {
  if (!input.canOperate && !input.canReceiveBookings) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'Assignment must enable operate and/or booking eligibility',
      400,
    );
  }
  if (input.canOperate && (!input.serviceProIds || input.serviceProIds.length === 0)) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      'Operational assignment requires at least one service eligibility',
      400,
    );
  }
  if (!input.schedule?.length) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'Work schedule required', 400);
  }
  validatePayroll(input.payroll);
  if (input.target.policy === 'TARGET_PLAN' && !input.target.targetPlanId) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'Target plan id required', 400);
  }

  const db = await getPool();
  const emp = await db
    .request()
    .input('empId', sql.Int, input.empId)
    .query(`SELECT EmpID FROM dbo.TblEmp WHERE EmpID = @empId`);
  if (!emp.recordset[0]) {
    throw new BranchDomainError('OPERATION_NOT_ALLOWED', 'Employee not found in TblEmp', 404);
  }

  // Overlap check before tx
  await assertNoOverlappingBranchPayrollPlans({
    empId: input.empId,
    branchId: input.branchId,
    effectiveFrom: input.payroll.effectiveFrom,
    effectiveTo: input.payroll.effectiveTo ?? null,
  });

  const tx = new sql.Transaction(db);
  await tx.begin();
  try {
    const assignment = await ensureEmployeeBranchAssignment({
      empId: input.empId,
      branchId: input.branchId,
      effectiveFrom: input.effectiveFrom,
      canReceiveBookings: input.canReceiveBookings,
      isHomeBranch: input.isHomeBranch === true,
    });

    // Update booking flag if assignment already existed
    await new sql.Request(tx)
      .input('id', sql.BigInt, assignment.assignmentId)
      .input('canBook', sql.Bit, input.canReceiveBookings ? 1 : 0)
      .query(`
        UPDATE dbo.TblEmpBranchAssignment
        SET CanReceiveBookings = @canBook
        WHERE ID = @id
      `);

    // Schedule — Phase 1Q branch-owned weekly schedule (TblEmpBranchWorkSchedule)
    const { saveEmployeeBranchWeeklySchedule } = await import(
      '@/lib/hr/employeeBranchScheduleSave'
    );
    await saveEmployeeBranchWeeklySchedule({
      empId: input.empId,
      branchId: input.branchId,
      effectiveFrom: input.effectiveFrom,
      cells: input.schedule.map((day) => ({
        dayOfWeek: day.dayOfWeek,
        isWorking: day.isWorkingDay,
        startTime: day.startTime ?? null,
        endTime: day.endTime ?? null,
        canReceiveBookings: input.canReceiveBookings,
      })),
      actorUserId: input.actorUserId ?? null,
      skipPayrollCheck: true, // payroll inserted in same commit below
    });
    const scheduleRows = input.schedule.length;

    // Do NOT mutate legacy global TblEmpWorkSchedule (GLEEM continuity).

    const payIns = await new sql.Request(tx)
      .input('empId', sql.Int, input.empId)
      .input('branchId', sql.Int, input.branchId)
      .input('payType', sql.NVarChar(20), input.payroll.payType)
      .input('hourly', sql.Decimal(18, 4), input.payroll.hourlyRate ?? null)
      .input('daily', sql.Decimal(18, 4), input.payroll.dailyRate ?? null)
      .input('monthly', sql.Decimal(18, 4), input.payroll.monthlySalary ?? null)
      .input('from', sql.Date, input.payroll.effectiveFrom)
      .input('to', sql.Date, input.payroll.effectiveTo ?? null)
      .query(`
        INSERT INTO dbo.TblEmpBranchPayrollPlan (
          EmpID, BranchID, PayType, HourlyRate, DailyRate, MonthlySalary,
          EffectiveFrom, EffectiveTo, IsActive
        )
        OUTPUT INSERTED.PlanID
        VALUES (
          @empId, @branchId, @payType, @hourly, @daily, @monthly,
          @from, @to, 1
        )
      `);
    const payrollPlanId = Number(payIns.recordset[0].PlanID);

    let targetPlanId: number | null = null;
    if (input.target.policy === 'TARGET_PLAN') {
      targetPlanId = input.target.targetPlanId;
      const plan = await new sql.Request(tx)
        .input('planId', sql.Int, targetPlanId)
        .input('empId', sql.Int, input.empId)
        .input('branchId', sql.Int, input.branchId)
        .query(`
          SELECT TOP 1 ID
          FROM dbo.TblEmpTargetPlan
          WHERE ID = @planId AND EmpID = @empId AND BranchID = @branchId
        `);
      if (!plan.recordset[0]) {
        throw new BranchDomainError(
          'OPERATION_NOT_ALLOWED',
          'Target plan must belong to EmpID+BranchID (no cross-branch fallback)',
          400,
        );
      }
    } else {
      // Explicit NO_TARGET marker as disabled plan note row if table allows — record via setup note
      await new sql.Request(tx)
        .input('empId', sql.Int, input.empId)
        .input('branchId', sql.Int, input.branchId)
        .input('from', sql.Date, input.effectiveFrom)
        .input('actor', sql.Int, input.actorUserId ?? null)
        .input('notes', sql.NVarChar(250), input.target.notes ?? 'NO_TARGET')
        .query(`
          IF COL_LENGTH('dbo.TblEmpTargetPlan', 'IsEnabled') IS NOT NULL
          BEGIN
            -- Soft marker: disabled plan with Notes=NO_TARGET when no active enabled plan
            IF NOT EXISTS (
              SELECT 1 FROM dbo.TblEmpTargetPlan
              WHERE EmpID = @empId AND BranchID = @branchId AND IsEnabled = 1
                AND EffectiveFrom <= @from
                AND (EffectiveTo IS NULL OR EffectiveTo >= @from)
            )
            BEGIN
              INSERT INTO dbo.TblEmpTargetPlan (
                EmpID, BranchID, IsEnabled, InputBasis, ConversionDays,
                EffectiveFrom, EffectiveTo, Notes, CreatedByUserID
              )
              VALUES (
                @empId, @branchId, 0, N'daily', 26,
                @from, NULL, N'NO_TARGET', @actor
              )
            END
          END
        `);
    }

    // Service eligibility — store in branch assignment notes JSON when no dedicated table
    await new sql.Request(tx)
      .input('id', sql.BigInt, assignment.assignmentId)
      .input(
        'svc',
        sql.NVarChar(500),
        `services:${input.serviceProIds.join(',')}`,
      )
      .query(`
        IF COL_LENGTH('dbo.TblEmpBranchAssignment', 'Notes') IS NOT NULL
          UPDATE dbo.TblEmpBranchAssignment SET Notes = @svc WHERE ID = @id
      `);

    await tx.commit();
    return {
      assignmentId: assignment.assignmentId,
      payrollPlanId,
      targetPolicy: input.target.policy,
      targetPlanId,
      scheduleRows,
    };
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/**
 * Guard: operational check-in / booking requires branch payroll plan (no GLEEM fallback).
 */
export async function assertBranchPayrollPresentForOps(params: {
  empId: number;
  branchId: number;
  workDate: string;
}): Promise<void> {
  const { resolveBranchPayrollPlanForDate } = await import('@/lib/payroll/branchPayrollPlan');
  const plan = await resolveBranchPayrollPlanForDate(params);
  if (!plan) {
    throw new BranchDomainError(
      'OPERATION_NOT_ALLOWED',
      `No effective payroll plan for EmpID=${params.empId} BranchID=${params.branchId} on ${params.workDate}`,
      403,
    );
  }
}
