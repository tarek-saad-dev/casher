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
import type { LateCaseDb } from './caseTransaction';
import { withLateDeductionCaseLock } from './caseTransaction';

export class LateDeductionActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LateDeductionActionError';
  }
}

async function assertScopedCase(db: LateCaseDb, row: LateDeductionCaseRow, branchId: number, tenantId: string): Promise<void> {
  if (row.branchId !== branchId) throw new LateDeductionActionError('الحالة غير موجودة في هذا الفرع');
  const result = await db.request()
    .input('empId', sql.Int, row.empId)
    .input('branchId', sql.Int, branchId)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT TOP 1 1 AS Allowed FROM dbo.TblEmp e
      JOIN dbo.Location l ON l.TenantId = e.TenantId
      WHERE e.EmpID = @empId AND e.TenantId = @tenantId
        AND l.LegacyBranchId = @branchId AND l.Status = N'active'
    `);
  if (!result.recordset.length) throw new LateDeductionActionError('الحالة غير موجودة في هذه المنشأة');
}

export async function listLateDeductionManagerQueue(params: {
  branchId: number;
  tenantId: string;
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
  branchId: number;
  tenantId: string;
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

  const initial = await findLateDeductionCaseById(db, params.caseId);
  if (!initial) throw new LateDeductionActionError('الحالة غير موجودة');
  await assertScopedCase(db, initial, params.branchId, params.tenantId);
  return withLateDeductionCaseLock(initial, async (db) => {
  const existing = await findLateDeductionCaseById(db, params.caseId);
  if (!existing) throw new LateDeductionActionError('الحالة غير موجودة');
  await assertScopedCase(db, existing, params.branchId, params.tenantId);
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
  });
}

/**
 * Cancel an incorrect automatic/manual late deduction with audit trail.
 * Sets DoNotAutoRecreate so check-in corrections do not recreate it.
 */
export async function cancelLateDeductionCase(params: {
  caseId: number;
  branchId: number;
  tenantId: string;
  reason: string;
  userId: number;
}): Promise<LateDeductionCaseRow> {
  const db = await getPool();
  if (!(await isLateDeductionSchemaReady(db))) {
    throw new LateDeductionActionError('مخطط خصم التأخير غير مُثبَّت — نفّذ ترحيل DRVO أولاً');
  }

  const reason = String(params.reason ?? '').trim();
  if (!reason) throw new LateDeductionActionError('سبب الإلغاء مطلوب');

  const initial = await findLateDeductionCaseById(db, params.caseId);
  if (!initial) throw new LateDeductionActionError('الحالة غير موجودة');
  await assertScopedCase(db, initial, params.branchId, params.tenantId);
  return withLateDeductionCaseLock(initial, async (db) => {
  const existing = await findLateDeductionCaseById(db, params.caseId);
  if (!existing) throw new LateDeductionActionError('الحالة غير موجودة');
  await assertScopedCase(db, existing, params.branchId, params.tenantId);
  if (existing.status === 'cancelled') return existing;

  if (existing.attendanceId) {
    await voidLateDeductionLedgerEntry(db, {
      attendanceId: existing.attendanceId,
      branchId: existing.branchId,
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
  });
}

export type LateDeductionEmployeeRow = {
  empId: number;
  empName: string;
  job: string | null;
  employmentType: string | null;
  lateDeductionExempt: boolean;
  defaultCheckInTime: string | null;
  defaultCheckOutTime: string | null;
  /** Effective schedule for the reference work date (branch schedule, else defaults). */
  todayScheduleStart: string | null;
  todayScheduleEnd: string | null;
  todayIsWorkingDay: boolean | null;
  weeklySchedule: Array<{
    dayOfWeek: number;
    isWorking: boolean;
    startTime: string | null;
    endTime: string | null;
  }>;
};

/**
 * Active employees assigned to the branch — schedule + late-deduction exempt flag
 * for the late-deduction management panel.
 */
export async function listActiveEmployeesForLateDeduction(params: {
  branchId: number;
  tenantId: string;
  workDate: string;
}): Promise<LateDeductionEmployeeRow[]> {
  const db = await getPool();
  const { ensureEmpBranchWorkScheduleTable } = await import(
    '@/lib/hr/empBranchWorkSchedule'
  );
  await ensureEmpBranchWorkScheduleTable();
  const dayOfWeek = new Date(`${params.workDate}T12:00:00Z`).getDay();
  const schemaOk = await isLateDeductionSchemaReady(db);

  const result = await db
    .request()
    .input('branchId', sql.Int, params.branchId)
    .input('tenantId', sql.UniqueIdentifier, params.tenantId)
    .input('workDate', sql.Date, params.workDate)
    .input('dayOfWeek', sql.TinyInt, dayOfWeek)
    .query(`
      SELECT
        e.EmpID,
        e.EmpName,
        e.Job,
        e.EmploymentType,
        CONVERT(VARCHAR(5), e.DefaultCheckInTime, 108) AS DefaultCheckInTime,
        CONVERT(VARCHAR(5), e.DefaultCheckOutTime, 108) AS DefaultCheckOutTime,
        ${
          schemaOk
            ? `CASE
          WHEN COL_LENGTH(N'dbo.TblEmp', N'LateDeductionExempt') IS NULL THEN CAST(0 AS bit)
          ELSE ISNULL(e.LateDeductionExempt, 0)
        END AS LateDeductionExempt`
            : `CAST(0 AS bit) AS LateDeductionExempt`
        },
        ws.ScheduleDayOfWeek,
        ws.IsWorkingDay,
        ws.ScheduleStartTime,
        ws.ScheduleEndTime
      FROM dbo.TblEmp e
      INNER JOIN dbo.TblEmpBranchAssignment ea
        ON ea.EmpID = e.EmpID
       AND ea.BranchID = @branchId
       AND ea.IsActive = 1
       AND ea.EffectiveFrom <= @workDate
       AND (ea.EffectiveTo IS NULL OR ea.EffectiveTo >= @workDate)
      OUTER APPLY (
        SELECT TOP 1
          s.DayOfWeek AS ScheduleDayOfWeek,
          CAST(s.IsWorking AS bit) AS IsWorkingDay,
          CONVERT(VARCHAR(5), s.StartTime, 108) AS ScheduleStartTime,
          CONVERT(VARCHAR(5), s.EndTime, 108) AS ScheduleEndTime
        FROM dbo.TblEmpBranchWorkSchedule s
        WHERE s.EmpID = e.EmpID
          AND s.BranchID = @branchId
          AND s.DayOfWeek = @dayOfWeek
          AND s.IsActive = 1
          AND s.EffectiveFrom <= @workDate
          AND (s.EffectiveTo IS NULL OR s.EffectiveTo >= @workDate)
        ORDER BY s.EffectiveFrom DESC, s.ScheduleID DESC
      ) ws
      WHERE ISNULL(e.isActive, 1) = 1
        AND e.TenantId = @tenantId
        AND e.TenantId IN (
          SELECT l.TenantId FROM dbo.Location l
          WHERE l.LegacyBranchId = @branchId AND l.Status = N'active'
        )
      ORDER BY e.EmpName
    `);

  const rows = result.recordset as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const empIds = rows.map((r) => Number(r.EmpID));
  const weeklyByEmp = new Map<
    number,
    Array<{
      dayOfWeek: number;
      isWorking: boolean;
      startTime: string | null;
      endTime: string | null;
    }>
  >();

  if (empIds.length > 0) {
    const weeklyReq = db
      .request()
      .input('branchId', sql.Int, params.branchId)
      .input('workDate', sql.Date, params.workDate);
    empIds.forEach((id, i) => weeklyReq.input(`e${i}`, sql.Int, id));
    const weeklyResult = await weeklyReq.query(`
      SELECT
        s.EmpID,
        s.DayOfWeek,
        CAST(s.IsWorking AS bit) AS IsWorking,
        CONVERT(VARCHAR(5), s.StartTime, 108) AS StartTime,
        CONVERT(VARCHAR(5), s.EndTime, 108) AS EndTime
      FROM dbo.TblEmpBranchWorkSchedule s
      INNER JOIN (
        SELECT EmpID, DayOfWeek, MAX(EffectiveFrom) AS MaxFrom
        FROM dbo.TblEmpBranchWorkSchedule
        WHERE BranchID = @branchId
          AND IsActive = 1
          AND EffectiveFrom <= @workDate
          AND (EffectiveTo IS NULL OR EffectiveTo >= @workDate)
          AND EmpID IN (${empIds.map((_, i) => `@e${i}`).join(',')})
        GROUP BY EmpID, DayOfWeek
      ) latest
        ON latest.EmpID = s.EmpID
       AND latest.DayOfWeek = s.DayOfWeek
       AND latest.MaxFrom = s.EffectiveFrom
      WHERE s.BranchID = @branchId
        AND s.IsActive = 1
      ORDER BY s.EmpID, s.DayOfWeek
    `);

    for (const w of weeklyResult.recordset as Array<Record<string, unknown>>) {
      const empId = Number(w.EmpID);
      const list = weeklyByEmp.get(empId) ?? [];
      list.push({
        dayOfWeek: Number(w.DayOfWeek),
        isWorking: Boolean(w.IsWorking),
        startTime: (w.StartTime as string) || null,
        endTime: (w.EndTime as string) || null,
      });
      weeklyByEmp.set(empId, list);
    }
  }

  return rows.map((r) => {
    const defaultIn = (r.DefaultCheckInTime as string) || null;
    const defaultOut = (r.DefaultCheckOutTime as string) || null;
    const hasScheduleRow = r.ScheduleDayOfWeek != null;
    const isWorking =
      r.IsWorkingDay == null ? null : Boolean(r.IsWorkingDay);
    const scheduleStart = hasScheduleRow
      ? ((r.ScheduleStartTime as string) || defaultIn)
      : defaultIn;
    const scheduleEnd = hasScheduleRow
      ? ((r.ScheduleEndTime as string) || defaultOut)
      : defaultOut;
    return {
      empId: Number(r.EmpID),
      empName: String(r.EmpName ?? ''),
      job: (r.Job as string) || null,
      employmentType: (r.EmploymentType as string) || null,
      lateDeductionExempt: Boolean(r.LateDeductionExempt),
      defaultCheckInTime: defaultIn,
      defaultCheckOutTime: defaultOut,
      todayScheduleStart: isWorking === false ? null : scheduleStart,
      todayScheduleEnd: isWorking === false ? null : scheduleEnd,
      todayIsWorkingDay: isWorking,
      weeklySchedule: weeklyByEmp.get(Number(r.EmpID)) ?? [],
    };
  });
}

export async function setEmployeeLateDeductionExempt(params: {
  empId: number;
  exempt: boolean;
  tenantId: string;
  branchId: number;
}): Promise<{ empId: number; lateDeductionExempt: boolean }> {
  const db = await getPool();
  if (!(await isLateDeductionSchemaReady(db))) {
    throw new LateDeductionActionError('مخطط خصم التأخير غير مُثبَّت — نفّذ ترحيل DRVO أولاً');
  }

  const allowed = await db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('tenantId', sql.UniqueIdentifier, params.tenantId)
    .query(`
      SELECT TOP 1 1 AS Allowed
      FROM dbo.TblEmp e
      INNER JOIN dbo.TblEmpBranchAssignment ea
        ON ea.EmpID = e.EmpID
       AND ea.BranchID = @branchId
       AND ea.IsActive = 1
      WHERE e.EmpID = @empId
        AND e.TenantId = @tenantId
        AND ISNULL(e.isActive, 1) = 1
        AND e.TenantId IN (
          SELECT l.TenantId FROM dbo.Location l
          WHERE l.LegacyBranchId = @branchId AND l.Status = N'active'
        )
    `);
  if (!allowed.recordset.length) {
    throw new LateDeductionActionError('الموظف غير موجود أو غير معيَّن لهذا الفرع');
  }

  const result = await db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('tenantId', sql.UniqueIdentifier, params.tenantId)
    .input('exempt', sql.Bit, params.exempt ? 1 : 0)
    .query(`
      UPDATE dbo.TblEmp
      SET LateDeductionExempt = @exempt
      WHERE EmpID = @empId AND TenantId = @tenantId;

      SELECT
        CASE
          WHEN COL_LENGTH(N'dbo.TblEmp', N'LateDeductionExempt') IS NULL THEN CAST(0 AS bit)
          ELSE ISNULL(LateDeductionExempt, 0)
        END AS LateDeductionExempt
      FROM dbo.TblEmp
      WHERE EmpID = @empId AND TenantId = @tenantId;
    `);

  const recordsets = (result as { recordsets?: Array<Array<Record<string, unknown>>> })
    .recordsets;
  const selectRows = recordsets?.[recordsets.length - 1] ?? result.recordset;
  const row = selectRows?.[0];
  if (!row) throw new LateDeductionActionError('فشل تحديث استثناء خصم التأخير');

  return {
    empId: params.empId,
    lateDeductionExempt: Boolean(row.LateDeductionExempt),
  };
}
