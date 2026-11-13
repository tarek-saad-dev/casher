import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { isAuthResult, requireAdmin } from '@/lib/api-auth';
import { requireBranchOperationAccess, isActiveBranchContext } from '@/lib/branch/context';
import { sql } from '@/lib/db';
import { executeAuditedAction } from '@/lib/sensitiveActionAudit';
import { requireHrTenantId } from '@/lib/hr/hrTenantScope';
import { isSourceLinkedLedgerEntry, validateEditableLedgerFields } from '@/lib/hr/employee-ledger-entry-actions';

class LedgerActionError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

type LedgerRow = {
  ID: number;
  EmpID: number;
  BranchID: number | null;
  EntryDate: Date | string;
  EntryDirection: string;
  EntryReason: string;
  Amount: number;
  PayrollMonth: string | null;
  RefType: string | null;
  RefID: number | null;
  CashMoveID: number | null;
  AttendanceID: number | null;
  Notes: string | null;
  IsVoided: boolean;
  UpdatedAt: Date | null;
};

async function runAction(request: NextRequest, mode: 'edit' | 'delete') {
  const auth = await requireAdmin();
  if (!isAuthResult(auth)) return auth;
  const branch = await requireBranchOperationAccess();
  if (!isActiveBranchContext(branch)) return branch;
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'يرجى تسجيل الدخول' }, { status: 401 });

  try {
    const body: Record<string, unknown> = await request.json();
    const entryId = Number(body.entryId);
    const reason = String(body.reason ?? '').trim();
    if (!Number.isInteger(entryId) || entryId <= 0) throw new LedgerActionError('معرّف القيد غير صالح');
    if (reason.length < 3 || reason.length > 500) throw new LedgerActionError('اكتب سبب التعديل أو الحذف (3 حروف على الأقل)');
    const tenantId = requireHrTenantId(auth.tenantId, 'employee-ledger-entry-action');
    const path = '/api/admin/hr/employee-ledger/entry';
    let existing: LedgerRow | null = null;

    const result = await executeAuditedAction({
      actionType: mode === 'edit' ? 'edit_employee_ledger_entry' : 'delete_employee_ledger_entry',
      user: session,
      request,
      actionMethod: mode === 'edit' ? 'PATCH' : 'DELETE',
      endpointPath: path,
      entityType: 'TblEmpLedgerEntry',
      entityId: entryId,
      reason,
      loadOldData: async (tx) => {
        const found = await new sql.Request(tx)
          .input('entryId', sql.Int, entryId)
          .input('tenantId', sql.UniqueIdentifier, tenantId)
          .input('branchId', sql.Int, branch.branchId)
          .query(`
            SELECT l.ID, l.EmpID, l.BranchID, l.EntryDate, l.EntryDirection, l.EntryReason,
                   l.Amount, l.PayrollMonth, l.RefType, l.RefID, l.CashMoveID,
                   l.AttendanceID, l.Notes, l.IsVoided, l.UpdatedAt
            FROM dbo.TblEmpLedgerEntry l WITH (UPDLOCK, HOLDLOCK)
            INNER JOIN dbo.TblEmp e ON e.EmpID = l.EmpID AND e.TenantId = @tenantId
            WHERE l.ID = @entryId AND l.BranchID = @branchId
          `);
        existing = (found.recordset[0] ?? null) as LedgerRow | null;
        if (!existing) throw new LedgerActionError('القيد غير موجود في الفرع النشط، بدّل الفرع أولاً', 404);
        if (existing.IsVoided) throw new LedgerActionError('القيد ملغي بالفعل', 409);
        return { ...existing };
      },
      execute: async (tx) => {
        if (!existing) throw new LedgerActionError('القيد غير موجود', 404);
        const linked = isSourceLinkedLedgerEntry({
          refType: existing.RefType, refId: existing.RefID,
          cashMoveId: existing.CashMoveID, attendanceId: existing.AttendanceID,
        });
        if (mode === 'delete' && linked) {
          throw new LedgerActionError('القيد مرتبط بخزنة أو حضور أو راتب. احذف/صحح الحركة من مصدرها حتى تظل الحسابات متطابقة.', 409);
        }
        if (mode === 'edit' && linked) {
          if (['amount', 'entryDate', 'entryDirection', 'entryReason', 'payrollMonth'].some((k) => Object.hasOwn(body, k))) {
            throw new LedgerActionError('القيد آلي. يمكن تعديل الملاحظات فقط؛ المبلغ والتاريخ يتعدلوا من الحركة الأصلية.', 409);
          }
          const notes = String(body.notes ?? '').trim();
          if (notes.length > 500) throw new LedgerActionError('الملاحظات لا تتجاوز 500 حرف');
          await new sql.Request(tx)
            .input('entryId', sql.Int, entryId)
            .input('notes', sql.NVarChar(500), notes || null)
            .query('UPDATE dbo.TblEmpLedgerEntry SET Notes = @notes, UpdatedAt = SYSDATETIME() WHERE ID = @entryId AND IsVoided = 0');
        } else {
          const originalMonth = existing.PayrollMonth || String(existing.EntryDate).slice(0, 7);
          if (mode === 'edit') {
            let updated: ReturnType<typeof validateEditableLedgerFields>;
            try { updated = validateEditableLedgerFields(body); }
            catch (error) { throw new LedgerActionError(error instanceof Error ? error.message : 'بيانات القيد غير صالحة'); }
            await assertMonthNotClosed(tx, originalMonth);
            await assertMonthNotClosed(tx, updated.payrollMonth || updated.entryDate.slice(0, 7));
            await new sql.Request(tx)
              .input('entryId', sql.Int, entryId)
              .input('entryDate', sql.Date, updated.entryDate)
              .input('entryDirection', sql.NVarChar(10), updated.entryDirection)
              .input('entryReason', sql.NVarChar(40), updated.entryReason)
              .input('amount', sql.Decimal(12, 2), updated.amount)
              .input('payrollMonth', sql.NVarChar(7), updated.payrollMonth)
              .input('notes', sql.NVarChar(500), updated.notes)
              .query(`
                UPDATE dbo.TblEmpLedgerEntry
                SET EntryDate = @entryDate, EntryDirection = @entryDirection,
                    EntryReason = @entryReason, Amount = @amount,
                    PayrollMonth = @payrollMonth, Notes = @notes,
                    UpdatedAt = SYSDATETIME()
                WHERE ID = @entryId AND IsVoided = 0
              `);
          } else {
            await assertMonthNotClosed(tx, originalMonth);
            await new sql.Request(tx)
              .input('entryId', sql.Int, entryId)
              .input('voidReason', sql.NVarChar(500), reason)
              .query(`
                UPDATE dbo.TblEmpLedgerEntry
                SET IsVoided = 1, VoidReason = @voidReason, UpdatedAt = SYSDATETIME()
                WHERE ID = @entryId AND IsVoided = 0
              `);
          }
        }
        return { entryId, mode };
      },
      loadNewData: async (tx) => {
        const updated = await new sql.Request(tx).input('entryId', sql.Int, entryId)
          .query('SELECT ID, EmpID, BranchID, EntryDate, EntryDirection, EntryReason, Amount, PayrollMonth, RefType, RefID, CashMoveID, AttendanceID, Notes, IsVoided, VoidReason, UpdatedAt FROM dbo.TblEmpLedgerEntry WHERE ID = @entryId');
        return (updated.recordset[0] ?? null) as Record<string, unknown> | null;
      },
    });
    return NextResponse.json({ success: true, entryId, auditId: result.auditId });
  } catch (error) {
    if (error instanceof LedgerActionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[employee-ledger-entry]', mode, error);
    return NextResponse.json({ error: 'تعذّر حفظ تغيير القيد. راجع السجل وحاول مرة أخرى.' }, { status: 500 });
  }
}

async function assertMonthNotClosed(tx: sql.Transaction, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new LedgerActionError('شهر الرواتب غير صالح');
  }
  const [year, monthNumber] = month.split('-').map(Number);
  const row = await new sql.Request(tx)
    .input('year', sql.Int, year)
    .input('month', sql.Int, monthNumber)
    .query("SELECT TOP 1 Status FROM dbo.TblPayrollMonth WHERE [Year] = @year AND [Month] = @month AND LOWER(Status) IN (N'closed', N'finalized')");
  if (row.recordset.length) throw new LedgerActionError('شهر الرواتب مُغلق. افتح الشهر بالإجراء المعتمد قبل التعديل.', 409);
}

export async function PATCH(request: NextRequest) {
  return runAction(request, 'edit');
}

export async function DELETE(request: NextRequest) {
  return runAction(request, 'delete');
}
