import 'server-only';

import { getPool, sql } from '@/lib/db';
import { upsertLateDeductionLedgerEntry, voidLateDeductionLedgerEntry } from './ledger';
import { buildManagerDecisionEmployeeMessage } from './messages';
import {
  findLateDeductionCaseById,
  listPendingManagerCases,
  type LateDeductionCaseRow,
} from './repository';
import { isLateDeductionSchemaReady } from './schema';
import { scheduleLateDeductionWhatsApp } from './whatsapp';
import { roundMoney } from '@/lib/reportMonthUtils';

export class LateDeductionActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LateDeductionActionError';
  }
}

export async function listLateDeductionManagerQueue(params?: {
  branchId?: number;
  workDate?: string;
}): Promise<LateDeductionCaseRow[]> {
  const db = await getPool();
  if (!(await isLateDeductionSchemaReady(db))) return [];
  return listPendingManagerCases(db, params);
}

/**
 * Manager confirms a manual penalty for >120 minute (or missing-pay) cases.
 * Idempotent: second submit on already manager_applied returns the existing result.
 */
export async function applyManagerLatePenalty(params: {
  caseId: number;
  amount: number;
  notes?: string | null;
  userId: number;
  suppressWhatsApp?: boolean;
}): Promise<LateDeductionCaseRow> {
  const db = await getPool();
  if (!(await isLateDeductionSchemaReady(db))) {
    throw new LateDeductionActionError('مخطط خصم التأخير غير مُثبَّت — نفّذ ترحيل DRVO أولاً');
  }

  const amount = roundMoney(Number(params.amount));
  if (!(amount > 0)) {
    throw new LateDeductionActionError('مبلغ الخصم يجب أن يكون أكبر من صفر');
  }

  const existing = await findLateDeductionCaseById(db, params.caseId);
  if (!existing) throw new LateDeductionActionError('الحالة غير موجودة');
  if (existing.status === 'cancelled') {
    throw new LateDeductionActionError('لا يمكن اعتماد خصم لحالة ملغاة');
  }
  if (existing.status === 'manager_applied' && existing.amount === amount) {
    return existing;
  }
  if (existing.status !== 'pending_manager' && existing.status !== 'manager_applied') {
    throw new LateDeductionActionError('هذه الحالة ليست قيد مراجعة المدير');
  }
  if (!existing.attendanceId) {
    throw new LateDeductionActionError('لا يوجد سجل حضور مرتبط — سجّل الحضور أولاً');
  }

  const ledger = await upsertLateDeductionLedgerEntry(db, {
    empId: existing.empId,
    branchId: existing.branchId,
    workDate: existing.workDate,
    attendanceId: existing.attendanceId,
    amount,
    lateMinutes: existing.lateMinutes,
    kind: 'manager_decision',
    createdByUserId: params.userId,
  });

  await db
    .request()
    .input('caseId', sql.Int, params.caseId)
    .input('amount', sql.Decimal(12, 2), amount)
    .input('ledgerId', sql.Int, ledger.ledgerEntryId)
    .input('notes', sql.NVarChar(500), params.notes?.trim() || null)
    .input('userId', sql.Int, params.userId)
    .query(`
      UPDATE dbo.TblEmpLateDeductionCase
      SET Status = N'manager_applied',
          DeductionKind = N'manager_review',
          Amount = @amount,
          LedgerEntryID = @ledgerId,
          ManagerNotes = @notes,
          ManagerDecidedBy = @userId,
          ManagerDecidedAt = SYSUTCDATETIME(),
          UpdatedAt = SYSUTCDATETIME()
      WHERE CaseID = @caseId
        AND Status IN (N'pending_manager', N'manager_applied')
    `);

  const updated = await findLateDeductionCaseById(db, params.caseId);
  if (!updated) throw new LateDeductionActionError('فشل تحديث الحالة');

  if (!params.suppressWhatsApp) {
    scheduleLateDeductionWhatsApp({
      empId: updated.empId,
      branchId: updated.branchId,
      text: buildManagerDecisionEmployeeMessage({
        lateMinutes: updated.lateMinutes,
        amount,
      }),
      metadata: { lateCaseId: updated.caseId, event: 'manager_decision' },
    });
  }

  return updated;
}

/**
 * Cancel an incorrect automatic/manual late deduction with audit trail.
 * Sets DoNotAutoRecreate so check-in corrections do not recreate it.
 */
export async function cancelLateDeductionCase(params: {
  caseId: number;
  reason: string;
  userId: number;
}): Promise<LateDeductionCaseRow> {
  const db = await getPool();
  if (!(await isLateDeductionSchemaReady(db))) {
    throw new LateDeductionActionError('مخطط خصم التأخير غير مُثبَّت — نفّذ ترحيل DRVO أولاً');
  }

  const reason = String(params.reason ?? '').trim();
  if (!reason) throw new LateDeductionActionError('سبب الإلغاء مطلوب');

  const existing = await findLateDeductionCaseById(db, params.caseId);
  if (!existing) throw new LateDeductionActionError('الحالة غير موجودة');
  if (existing.status === 'cancelled') return existing;

  if (existing.attendanceId) {
    await voidLateDeductionLedgerEntry(db, {
      attendanceId: existing.attendanceId,
      voidReason: `إلغاء خصم تأخير: ${reason}`,
    });
  }

  await db
    .request()
    .input('caseId', sql.Int, params.caseId)
    .input('reason', sql.NVarChar(500), reason)
    .input('userId', sql.Int, params.userId)
    .query(`
      UPDATE dbo.TblEmpLateDeductionCase
      SET Status = N'cancelled',
          Amount = NULL,
          LedgerEntryID = NULL,
          CancelReason = @reason,
          CancelledBy = @userId,
          CancelledAt = SYSUTCDATETIME(),
          DoNotAutoRecreate = 1,
          UpdatedAt = SYSUTCDATETIME()
      WHERE CaseID = @caseId
    `);

  const updated = await findLateDeductionCaseById(db, params.caseId);
  if (!updated) throw new LateDeductionActionError('فشل إلغاء الحالة');
  return updated;
}

export async function setEmployeeLateDeductionExempt(params: {
  empId: number;
  exempt: boolean;
  tenantId?: string | null;
}): Promise<void> {
  const db = await getPool();
  if (!(await isLateDeductionSchemaReady(db))) {
    throw new LateDeductionActionError('مخطط خصم التأخير غير مُثبَّت — نفّذ ترحيل DRVO أولاً');
  }
  const req = db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('exempt', sql.Bit, params.exempt ? 1 : 0);
  if (params.tenantId) {
    req.input('tenantId', sql.UniqueIdentifier, params.tenantId);
    await req.query(`
      UPDATE dbo.TblEmp
      SET LateDeductionExempt = @exempt
      WHERE EmpID = @empId AND TenantId = @tenantId
    `);
  } else {
    await req.query(`
      UPDATE dbo.TblEmp
      SET LateDeductionExempt = @exempt
      WHERE EmpID = @empId
    `);
  }
}
