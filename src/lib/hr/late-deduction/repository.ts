import 'server-only';

import { sql } from '@/lib/db';
import type { LateDeductionCaseStatus } from './constants';
import type { LateDeductionKind } from './rules';

export interface LateDeductionCaseRow {
  caseId: number;
  empId: number;
  branchId: number;
  workDate: string;
  attendanceId: number | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  lateMinutes: number;
  deductionKind: LateDeductionKind;
  status: LateDeductionCaseStatus;
  dailyBasePay: number | null;
  amount: number | null;
  ledgerEntryId: number | null;
  notifiedAt1: string | null;
  notifiedAt61: string | null;
  notifiedAt121: string | null;
  notifiedFinalAt: string | null;
  managerNotes: string | null;
  managerDecidedBy: number | null;
  managerDecidedAt: string | null;
  cancelReason: string | null;
  cancelledBy: number | null;
  cancelledAt: string | null;
  doNotAutoRecreate: boolean;
}

type DbLike = { request: () => sql.Request };

function mapCase(row: Record<string, unknown>): LateDeductionCaseRow {
  const toDate = (v: unknown) => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
  };
  const toTime = (v: unknown) => {
    if (v == null) return null;
    const s = String(v);
    return s.length >= 5 ? s.slice(0, 5) : s;
  };
  const toIso = (v: unknown) => {
    if (v == null) return null;
    if (v instanceof Date) return v.toISOString();
    return String(v);
  };

  return {
    caseId: Number(row.CaseID),
    empId: Number(row.EmpID),
    branchId: Number(row.BranchID),
    workDate: toDate(row.WorkDate)!,
    attendanceId: row.AttendanceID == null ? null : Number(row.AttendanceID),
    scheduledStartTime: toTime(row.ScheduledStartTime),
    scheduledEndTime: toTime(row.ScheduledEndTime),
    lateMinutes: Number(row.LateMinutes ?? 0),
    deductionKind: String(row.DeductionKind) as LateDeductionKind,
    status: String(row.Status) as LateDeductionCaseStatus,
    dailyBasePay: row.DailyBasePay == null ? null : Number(row.DailyBasePay),
    amount: row.Amount == null ? null : Number(row.Amount),
    ledgerEntryId: row.LedgerEntryID == null ? null : Number(row.LedgerEntryID),
    notifiedAt1: toIso(row.NotifiedAt1),
    notifiedAt61: toIso(row.NotifiedAt61),
    notifiedAt121: toIso(row.NotifiedAt121),
    notifiedFinalAt: toIso(row.NotifiedFinalAt),
    managerNotes: row.ManagerNotes == null ? null : String(row.ManagerNotes),
    managerDecidedBy: row.ManagerDecidedBy == null ? null : Number(row.ManagerDecidedBy),
    managerDecidedAt: toIso(row.ManagerDecidedAt),
    cancelReason: row.CancelReason == null ? null : String(row.CancelReason),
    cancelledBy: row.CancelledBy == null ? null : Number(row.CancelledBy),
    cancelledAt: toIso(row.CancelledAt),
    doNotAutoRecreate: Boolean(row.DoNotAutoRecreate),
  };
}

const CASE_SELECT = `
  CaseID, EmpID, BranchID, WorkDate, AttendanceID,
  CONVERT(VARCHAR(5), ScheduledStartTime, 108) AS ScheduledStartTime,
  CONVERT(VARCHAR(5), ScheduledEndTime, 108) AS ScheduledEndTime,
  LateMinutes, DeductionKind, Status, DailyBasePay, Amount, LedgerEntryID,
  NotifiedAt1, NotifiedAt61, NotifiedAt121, NotifiedFinalAt,
  ManagerNotes, ManagerDecidedBy, ManagerDecidedAt,
  CancelReason, CancelledBy, CancelledAt, DoNotAutoRecreate
`;

export async function findLateDeductionCase(
  db: DbLike,
  empId: number,
  branchId: number,
  workDate: string,
): Promise<LateDeductionCaseRow | null> {
  const result = await db
    .request()
    .input('empId', sql.Int, empId)
    .input('branchId', sql.Int, branchId)
    .input('workDate', sql.Date, workDate)
    .query(`
      SELECT ${CASE_SELECT}
      FROM dbo.TblEmpLateDeductionCase
      WHERE EmpID = @empId AND BranchID = @branchId AND WorkDate = @workDate
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapCase(row) : null;
}

export async function findLateDeductionCaseById(
  db: DbLike,
  caseId: number,
): Promise<LateDeductionCaseRow | null> {
  const result = await db
    .request()
    .input('caseId', sql.Int, caseId)
    .query(`
      SELECT ${CASE_SELECT}
      FROM dbo.TblEmpLateDeductionCase
      WHERE CaseID = @caseId
    `);
  const row = result.recordset[0] as Record<string, unknown> | undefined;
  return row ? mapCase(row) : null;
}

export async function upsertLateDeductionCase(
  db: DbLike,
  input: {
    empId: number;
    branchId: number;
    workDate: string;
    attendanceId?: number | null;
    scheduledStart?: string | null;
    scheduledEnd?: string | null;
    lateMinutes: number;
    deductionKind: LateDeductionKind;
    status: LateDeductionCaseStatus;
    dailyBasePay?: number | null;
    amount?: number | null;
    ledgerEntryId?: number | null;
  },
): Promise<LateDeductionCaseRow> {
  await db
    .request()
    .input('empId', sql.Int, input.empId)
    .input('branchId', sql.Int, input.branchId)
    .input('workDate', sql.Date, input.workDate)
    .input('attendanceId', sql.Int, input.attendanceId ?? null)
    .input('scheduledStart', sql.NVarChar(8), input.scheduledStart ?? null)
    .input('scheduledEnd', sql.NVarChar(8), input.scheduledEnd ?? null)
    .input('lateMinutes', sql.Int, input.lateMinutes)
    .input('deductionKind', sql.NVarChar(30), input.deductionKind)
    .input('status', sql.NVarChar(30), input.status)
    .input('dailyBasePay', sql.Decimal(12, 2), input.dailyBasePay ?? null)
    .input('amount', sql.Decimal(12, 2), input.amount ?? null)
    .input('ledgerEntryId', sql.Int, input.ledgerEntryId ?? null)
    .query(`
      MERGE dbo.TblEmpLateDeductionCase AS t
      USING (SELECT @empId AS EmpID, @branchId AS BranchID, @workDate AS WorkDate) AS s
      ON t.EmpID = s.EmpID AND t.BranchID = s.BranchID AND t.WorkDate = s.WorkDate
      WHEN MATCHED AND t.Status IN (N'cancelled', N'manager_applied') THEN UPDATE SET
        UpdatedAt = SYSUTCDATETIME()
      WHEN MATCHED THEN UPDATE SET
        AttendanceID = COALESCE(@attendanceId, t.AttendanceID),
        ScheduledStartTime = COALESCE(TRY_CAST(@scheduledStart AS TIME), t.ScheduledStartTime),
        ScheduledEndTime = COALESCE(TRY_CAST(@scheduledEnd AS TIME), t.ScheduledEndTime),
        LateMinutes = @lateMinutes,
        DeductionKind = CASE
          -- Race loser must not wipe an already-applied case via finalize_pending.
          WHEN t.Status = N'applied' AND @status = N'finalize_pending' THEN t.DeductionKind
          ELSE @deductionKind
        END,
        Status = CASE
          WHEN t.Status = N'applied' AND @status = N'finalize_pending' THEN t.Status
          ELSE @status
        END,
        DailyBasePay = COALESCE(@dailyBasePay, t.DailyBasePay),
        Amount = CASE
          WHEN t.Status = N'applied' AND @status = N'finalize_pending' THEN t.Amount
          ELSE @amount
        END,
        LedgerEntryID = COALESCE(@ledgerEntryId, t.LedgerEntryID),
        UpdatedAt = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (
        EmpID, BranchID, WorkDate, AttendanceID, ScheduledStartTime, ScheduledEndTime,
        LateMinutes, DeductionKind, Status, DailyBasePay, Amount, LedgerEntryID
      ) VALUES (
        @empId, @branchId, @workDate, @attendanceId,
        TRY_CAST(@scheduledStart AS TIME), TRY_CAST(@scheduledEnd AS TIME),
        @lateMinutes, @deductionKind, @status, @dailyBasePay, @amount, @ledgerEntryId
      );
    `);

  const row = await findLateDeductionCase(db, input.empId, input.branchId, input.workDate);
  if (!row) throw new Error('Failed to upsert late deduction case');
  return row;
}

export async function markThresholdNotified(
  db: DbLike,
  caseId: number,
  threshold: 1 | 61 | 121,
): Promise<boolean> {
  const col =
    threshold === 1 ? 'NotifiedAt1' : threshold === 61 ? 'NotifiedAt61' : 'NotifiedAt121';
  const result = await db
    .request()
    .input('caseId', sql.Int, caseId)
    .query(`
      UPDATE dbo.TblEmpLateDeductionCase
      SET ${col} = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
      WHERE CaseID = @caseId AND ${col} IS NULL
    `);
  return (result.rowsAffected[0] ?? 0) > 0;
}

export async function markFinalNotified(db: DbLike, caseId: number): Promise<void> {
  await db
    .request()
    .input('caseId', sql.Int, caseId)
    .query(`
      UPDATE dbo.TblEmpLateDeductionCase
      SET NotifiedFinalAt = SYSUTCDATETIME(), UpdatedAt = SYSUTCDATETIME()
      WHERE CaseID = @caseId AND NotifiedFinalAt IS NULL
    `);
}

export async function listPendingManagerCases(
  db: DbLike,
  params?: { branchId?: number; workDate?: string },
): Promise<LateDeductionCaseRow[]> {
  const req = db.request();
  const filters: string[] = [`Status = N'pending_manager'`];
  if (params?.branchId) {
    req.input('branchId', sql.Int, params.branchId);
    filters.push('BranchID = @branchId');
  }
  if (params?.workDate) {
    req.input('workDate', sql.Date, params.workDate);
    filters.push('WorkDate = @workDate');
  }
  const result = await req.query(`
    SELECT ${CASE_SELECT}
    FROM dbo.TblEmpLateDeductionCase
    WHERE ${filters.join(' AND ')}
    ORDER BY WorkDate DESC, CaseID DESC
  `);
  return (result.recordset as Record<string, unknown>[]).map(mapCase);
}

export async function isEmployeeLateDeductionExempt(
  db: DbLike,
  empId: number,
): Promise<boolean> {
  const result = await db.request().input('empId', sql.Int, empId).query(`
    SELECT
      CASE
        WHEN COL_LENGTH(N'dbo.TblEmp', N'LateDeductionExempt') IS NULL THEN CAST(0 AS bit)
        ELSE ISNULL(LateDeductionExempt, 0)
      END AS Exempt
    FROM dbo.TblEmp
    WHERE EmpID = @empId
  `);
  return Boolean(result.recordset[0]?.Exempt);
}
