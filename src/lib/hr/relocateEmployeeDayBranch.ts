/**
 * Correct wrong-branch day ownership: move attendance + non-posted payroll +
 * daily target (+ linked ledger BranchIDs) from one branch to another for a
 * single EmpID + WorkDate — without creating a temporary schedule transfer.
 */
import 'server-only';
import sql from 'mssql';
import { getPool } from '@/lib/db';
import { getBranchById, listActiveBranches } from '@/lib/branch/repository';

export type RelocateDayBranchPreview = {
  ok: boolean;
  empId: number;
  empName: string;
  workDate: string;
  fromBranch: { branchId: number; branchCode: string; branchName: string } | null;
  toBranch: { branchId: number; branchCode: string; branchName: string } | null;
  willMove: {
    attendance: boolean;
    payrollIds: number[];
    targetIds: number[];
  };
  blockers: Array<{ code: string; message: string }>;
  warnings: string[];
};

function ymd(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}

export async function previewRelocateEmployeeDayBranch(args: {
  empId: number;
  workDate: string;
  fromBranchId: number;
  toBranchId: number;
}): Promise<RelocateDayBranchPreview> {
  const blockers: Array<{ code: string; message: string }> = [];
  const warnings: string[] = [];

  const db = await getPool();
  const emp = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .query(`SELECT EmpID, EmpName FROM dbo.TblEmp WHERE EmpID = @empId`);
  const empRow = emp.recordset[0];
  if (!empRow) {
    blockers.push({ code: 'EMPLOYEE_NOT_FOUND', message: 'الموظف غير موجود' });
  }

  if (args.fromBranchId === args.toBranchId) {
    blockers.push({
      code: 'RELOCATE_SAME_BRANCH',
      message: 'فرع المصدر والوجهة متطابقان',
    });
  }

  const from = await getBranchById(args.fromBranchId);
  const to = await getBranchById(args.toBranchId);
  if (!from) blockers.push({ code: 'FROM_BRANCH_NOT_FOUND', message: 'فرع المصدر غير موجود' });
  if (!to) blockers.push({ code: 'TO_BRANCH_NOT_FOUND', message: 'فرع الوجهة غير موجود' });

  const attFrom = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('from', sql.Int, args.fromBranchId)
    .query(`
      SELECT ID, CheckInTime, CheckOutTime
      FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID = @from
    `);
  const attRow = attFrom.recordset[0] as
    | { ID: number; CheckInTime: unknown; CheckOutTime: unknown }
    | undefined;
  const hasOpen = Boolean(attRow?.CheckInTime && !attRow?.CheckOutTime);
  const hasCompleted = Boolean(attRow?.CheckInTime && attRow?.CheckOutTime);

  if (hasOpen) {
    blockers.push({
      code: 'RELOCATE_ATTENDANCE_OPEN',
      message: 'الحضور مفتوح في فرع المصدر — أكمل الانصراف أولاً',
    });
  }

  const attTo = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('to', sql.Int, args.toBranchId)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblEmpAttendance
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID = @to
    `);
  if (attTo.recordset[0] && hasCompleted) {
    blockers.push({
      code: 'RELOCATE_DEST_ATTENDANCE_EXISTS',
      message: 'يوجد حضور بالفعل في فرع الوجهة — احذفه أو راجع يدوياً قبل النقل',
    });
  }

  const payrollFrom = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('from', sql.Int, args.fromBranchId)
    .query(`
      SELECT ID, Status
      FROM dbo.TblEmpDailyPayroll
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID = @from
    `);
  const payrollRows = payrollFrom.recordset as Array<{ ID: number; Status: string }>;
  const posted = payrollRows.filter((r) => r.Status === 'PostedToCashMove');
  if (posted.length > 0) {
    blockers.push({
      code: 'RELOCATE_PAYROLL_POSTED',
      message: 'اليومية مرحلة للخزنة — ألغِ الترحيل أولاً قبل نقل الفرع',
    });
  }
  const movablePayroll = payrollRows.filter((r) =>
    ['Generated', 'Earned', 'PendingCheckout'].includes(String(r.Status)),
  );

  const payrollTo = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('to', sql.Int, args.toBranchId)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblEmpDailyPayroll
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID = @to
    `);
  if (payrollTo.recordset[0] && movablePayroll.length > 0) {
    blockers.push({
      code: 'RELOCATE_DEST_PAYROLL_EXISTS',
      message: 'يوجد يومية بالفعل في فرع الوجهة',
    });
  }

  const targetFrom = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('from', sql.Int, args.fromBranchId)
    .query(`
      SELECT ID FROM dbo.TblEmpDailyTarget
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID = @from
    `)
    .catch(() => ({ recordset: [] as Array<{ ID: number }> }));
  const targetIds = (targetFrom.recordset as Array<{ ID: number }>).map((r) => Number(r.ID));

  const targetTo = await db
    .request()
    .input('empId', sql.Int, args.empId)
    .input('day', sql.Date, args.workDate)
    .input('to', sql.Int, args.toBranchId)
    .query(`
      SELECT TOP 1 ID FROM dbo.TblEmpDailyTarget
      WHERE EmpID = @empId AND WorkDate = @day AND BranchID = @to
    `)
    .catch(() => ({ recordset: [] as Array<{ ID: number }> }));
  if (targetTo.recordset[0] && targetIds.length > 0) {
    blockers.push({
      code: 'RELOCATE_DEST_TARGET_EXISTS',
      message: 'يوجد تارجت بالفعل في فرع الوجهة',
    });
  }

  if (!hasCompleted && movablePayroll.length === 0 && targetIds.length === 0) {
    blockers.push({
      code: 'RELOCATE_NOTHING_TO_MOVE',
      message: 'لا يوجد حضور مكتمل أو يومية/تارجت قابل للنقل في فرع المصدر',
    });
  }

  if (!hasCompleted && (movablePayroll.length > 0 || targetIds.length > 0)) {
    warnings.push('لا يوجد حضور مكتمل في المصدر — سيتم نقل اليومية/التارجت فقط');
  }

  return {
    ok: blockers.length === 0,
    empId: args.empId,
    empName: empRow ? String(empRow.EmpName ?? '') : `#${args.empId}`,
    workDate: ymd(args.workDate),
    fromBranch: from
      ? { branchId: from.branchId, branchCode: from.branchCode, branchName: from.branchName }
      : null,
    toBranch: to
      ? { branchId: to.branchId, branchCode: to.branchCode, branchName: to.branchName }
      : null,
    willMove: {
      attendance: hasCompleted,
      payrollIds: movablePayroll.map((r) => Number(r.ID)),
      targetIds,
    },
    blockers,
    warnings,
  };
}

export async function relocateEmployeeDayBranch(args: {
  empId: number;
  workDate: string;
  fromBranchId: number;
  toBranchId: number;
  reason: string;
  actorUserId: number;
}): Promise<{
  ok: true;
  preview: RelocateDayBranchPreview;
  moved: { attendance: number; payroll: number; targets: number };
}> {
  if (!args.reason?.trim()) {
    throw Object.assign(new Error('سبب النقل مطلوب'), { code: 'REASON_REQUIRED', status: 400 });
  }

  const preview = await previewRelocateEmployeeDayBranch(args);
  if (!preview.ok) {
    const first = preview.blockers[0];
    throw Object.assign(new Error(first?.message ?? 'النقل غير مسموح'), {
      code: first?.code ?? 'RELOCATE_BLOCKED',
      status: 409,
      preview,
    });
  }

  const db = await getPool();
  const moved = { attendance: 0, payroll: 0, targets: 0 };

  if (preview.willMove.attendance) {
    const att = await db
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
    moved.attendance = att.rowsAffected?.[0] ?? 0;
  }

  if (preview.willMove.payrollIds.length > 0) {
    const pay = await db
      .request()
      .input('empId', sql.Int, args.empId)
      .input('day', sql.Date, args.workDate)
      .input('from', sql.Int, args.fromBranchId)
      .input('to', sql.Int, args.toBranchId)
      .query(`
        UPDATE dbo.TblEmpDailyPayroll
        SET BranchID = @to, UpdatedAt = GETDATE()
        OUTPUT INSERTED.ID
        WHERE EmpID = @empId AND WorkDate = @day AND BranchID = @from
          AND Status IN (N'Generated', N'Earned', N'PendingCheckout')
      `);
    const payrollIds = pay.recordset.map((r: { ID: number }) => Number(r.ID)).filter((id) => id > 0);
    moved.payroll = payrollIds.length;

    for (const payrollId of payrollIds) {
      try {
        await db
          .request()
          .input('payrollId', sql.Int, payrollId)
          .input('to', sql.Int, args.toBranchId)
          .query(`
            UPDATE dbo.TblEmpLedgerEntry
            SET BranchID = @to
            WHERE RefType = N'TblEmpDailyPayroll' AND RefID = @payrollId AND IsVoided = 0
          `);
      } catch {
        /* ledger optional */
      }
    }
  }

  if (preview.willMove.targetIds.length > 0) {
    const tgt = await db
      .request()
      .input('empId', sql.Int, args.empId)
      .input('day', sql.Date, args.workDate)
      .input('from', sql.Int, args.fromBranchId)
      .input('to', sql.Int, args.toBranchId)
      .query(`
        UPDATE dbo.TblEmpDailyTarget
        SET BranchID = @to, UpdatedAt = GETDATE()
        OUTPUT INSERTED.ID
        WHERE EmpID = @empId AND WorkDate = @day AND BranchID = @from
      `);
    const targetIds = tgt.recordset.map((r: { ID: number }) => Number(r.ID)).filter((id) => id > 0);
    moved.targets = targetIds.length;

    for (const targetId of targetIds) {
      try {
        await db
          .request()
          .input('targetId', sql.Int, targetId)
          .input('to', sql.Int, args.toBranchId)
          .query(`
            UPDATE dbo.TblEmpLedgerEntry
            SET BranchID = @to
            WHERE RefType IN (N'TblEmpDailyTarget', N'EmpDailyTarget')
              AND RefID = @targetId AND IsVoided = 0
          `);
      } catch {
        /* ledger optional */
      }
    }
  }

  console.warn(
    JSON.stringify({
      type: 'HR_RELOCATE_DAY_BRANCH',
      at: new Date().toISOString(),
      actorUserId: args.actorUserId,
      empId: args.empId,
      workDate: args.workDate,
      fromBranchId: args.fromBranchId,
      toBranchId: args.toBranchId,
      reason: args.reason.trim(),
      moved,
    }),
  );

  return { ok: true, preview, moved };
}

export async function listRelocateDestinationBranches(excludeBranchId: number) {
  const branches = await listActiveBranches();
  return branches
    .filter((b) => b.lifecycleStatus !== 'SETUP' && b.branchId !== excludeBranchId)
    .map((b) => ({
      branchId: b.branchId,
      branchCode: b.branchCode,
      branchName: b.branchName,
    }));
}
