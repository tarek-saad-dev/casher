import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import { requireBranchOperationAccess } from '@/lib/branch/context';
import { assertEmpBranchWorkDayMutable } from '@/lib/hr/empBranchWorkDayClose.service';
import { isEmpBranchWorkDayCloseError, empBranchWorkDayCloseErrorResponse } from '@/lib/hr/empBranchWorkDayClose.http';
import { EMP_LEDGER_REASON_HOURLY_WAGE, EMP_LEDGER_REF_TYPE_DAILY_PAYROLL } from '@/lib/services/employeeLedgerDualWrite';

/**
 * Mark one employee absent for a mutable branch work day.
 * Attendance + unposted payroll removal + wage-ledger reversal are atomic.
 * Posted cash entries must be corrected through the existing finance workflow.
 */
export async function POST(req: NextRequest) {
  const auth = await requirePageAccess('/admin/hr');
  if (!isAuthResult(auth)) return auth;
  try {
    const body = await req.json();
    const empId = Number(body.empId);
    const workDate = String(body.workDate ?? '');
    if (!Number.isInteger(empId) || empId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
      return NextResponse.json({ error: 'الموظف أو التاريخ غير صالح' }, { status: 400 });
    }
    if (body.branchId != null || body.BranchID != null) {
      return NextResponse.json({ error: 'لا يمكن تحديد الفرع من الطلب' }, { status: 400 });
    }
    const branch = await requireBranchOperationAccess();
    if (branch instanceof NextResponse) return branch;
    const branchId = branch.branchId;
    await assertEmpBranchWorkDayMutable(branchId, workDate);
    const pool = await getPool();
    const transaction = new sql.Transaction(pool);
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    try {
      const rows = await new sql.Request(transaction)
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, branchId)
        .input('workDate', sql.Date, workDate)
        .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
        .query(`
          SELECT e.EmpID
          FROM dbo.TblEmp e WITH (UPDLOCK, HOLDLOCK)
          WHERE e.EmpID = @empId AND e.TenantId = @tenantId
            AND (
              EXISTS (
                SELECT 1 FROM dbo.TblEmpBranchAssignment ba
                WHERE ba.EmpID = e.EmpID AND ba.BranchID = @branchId
                  AND ba.EffectiveFrom <= @workDate
                  AND (ba.EffectiveTo IS NULL OR ba.EffectiveTo >= @workDate)
              )
              OR EXISTS (
                SELECT 1 FROM dbo.TblEmpAttendance a
                WHERE a.EmpID = e.EmpID AND a.BranchID = @branchId AND a.WorkDate = @workDate
              )
            );

          SELECT p.ID, p.Status, p.CashMoveID, p.EmployeeIncomeCashMoveID
          FROM dbo.TblEmpDailyPayroll p WITH (UPDLOCK, HOLDLOCK)
          WHERE p.EmpID = @empId AND p.BranchID = @branchId AND p.WorkDate = @workDate;
        `);
      if (!rows.recordsets[0]?.length) {
        await transaction.rollback();
        return NextResponse.json({ error: 'الموظف غير تابع لهذا الفرع في هذا اليوم' }, { status: 404 });
      }
      const payroll = rows.recordsets[1] ?? [];
      if (payroll.some((p: { Status: string; CashMoveID: number | null; EmployeeIncomeCashMoveID: number | null }) =>
        p.Status === 'PostedToCashMove' || p.CashMoveID != null || p.EmployeeIncomeCashMoveID != null)) {
        await transaction.rollback();
        return NextResponse.json({
          error: 'اليومية مترحّلة للخزنة. يجب تصحيح الترحيل المالي أولًا قبل تسجيل الغياب.',
          code: 'PAYROLL_ALREADY_POSTED',
        }, { status: 409 });
      }
      await new sql.Request(transaction)
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, branchId)
        .input('workDate', sql.Date, workDate)
        .input('userId', sql.Int, auth.userId ?? null)
        .query(`
          UPDATE dbo.TblEmpAttendance
          SET Status = N'Absent', CheckInTime = NULL, CheckOutTime = NULL,
              LateMinutes = 0, EarlyLeaveMinutes = 0,
              BreakMinutesTotal = 0, BreakTimeMinutesTotal = 0,
              Notes = N'غياب اليوم من شاشة اليوميات',
              UpdatedByUserID = @userId, UpdatedAt = GETDATE()
          WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate;

          IF @@ROWCOUNT = 0
          BEGIN
            INSERT INTO dbo.TblEmpAttendance
              (EmpID, BranchID, WorkDate, Status, Notes, CreatedByUserID)
            VALUES (@empId, @branchId, @workDate, N'Absent', N'غياب اليوم من شاشة اليوميات', @userId);
          END
        `);
      if (payroll.length) {
        const payrollIds = payroll.map((p: { ID: number }) => Number(p.ID));
        for (const id of payrollIds) {
          await new sql.Request(transaction)
            .input('payrollId', sql.Int, id)
            .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_DAILY_PAYROLL)
            .input('reason', sql.NVarChar(40), EMP_LEDGER_REASON_HOURLY_WAGE)
            .query(`
              UPDATE dbo.TblEmpLedgerEntry
              SET IsVoided = 1, VoidReason = N'إلغاء اليومية بسبب تسجيل غياب الموظف',
                  UpdatedAt = SYSDATETIME()
              WHERE RefType = @refType AND RefID = @payrollId
                AND EntryReason = @reason AND IsVoided = 0;
              DELETE FROM dbo.TblEmpDailyPayroll WHERE ID = @payrollId;
            `);
        }
      }
      await transaction.commit();
      return NextResponse.json({ success: true, message: 'تم تسجيل الغياب وإلغاء اليومية وقيد أجرها', removedPayrollCount: payroll.length });
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  } catch (err) {
    if (isEmpBranchWorkDayCloseError(err)) return empBranchWorkDayCloseErrorResponse(err);
    console.error('[hr/mark-absent]', err);
    return NextResponse.json({ error: 'تعذر تسجيل الغياب. لم يتم حفظ تعديل جزئي.' }, { status: 500 });
  }
}
