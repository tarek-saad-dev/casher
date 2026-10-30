import 'server-only';

import { getPool, sql } from '@/lib/db';
import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';
import { roundMoney } from '@/lib/reportMonthUtils';
import { payrollMonthFromWorkDate } from '@/lib/services/employeeLedgerDualWrite';

export const EMP_LEDGER_REASON_ADDITIONAL_TARGET = 'bonus' as const;
export const EMP_LEDGER_REF_TYPE_ADDITIONAL_TARGET = 'AdditionalTarget' as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class EmployeeLedgerAdditionalTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeLedgerAdditionalTargetError';
  }
}

export function buildAdditionalTargetNote(entryDate: string, notes?: string | null): string {
  const base = `تارجت إضافي بتاريخ ${entryDate}`;
  const extra = notes?.trim();
  return extra ? `${base} — ${extra}` : base;
}

export interface AdditionalTargetPreview {
  empId: number;
  empName: string;
  branchId: number;
  branchCode: string;
  branchName: string;
  entryDate: string;
  /** إجمالي التارجت المسجّل في الدفتر لهذا اليوم (تارجت + عمولة + تارجت إضافي) */
  dayTargetTotal: number;
  /** إجمالي التارجت في الشهر حتى هذا اليوم (شامل اليوم) */
  monthTargetTotal: number;
  dayTargetEarned: number;
  dayAdditionalTarget: number;
}

export interface AdditionalTargetPostResult {
  success: true;
  ledgerEntryId: number;
  empId: number;
  empName: string;
  branchId: number;
  branchCode: string;
  entryDate: string;
  amountAdded: number;
  previousDayTargetTotal: number;
  newDayTargetTotal: number;
  monthTargetTotalAfter: number;
}

async function loadEmployeeAndBranch(empId: number, branchId: number) {
  const db = await getPool();
  const emp = await db
    .request()
    .input('empId', sql.Int, empId)
    .query(`
      SELECT EmpID, EmpName
      FROM dbo.TblEmp
      WHERE EmpID = @empId AND ISNULL(isActive, 1) = 1
    `);
  if (emp.recordset.length === 0) {
    throw new EmployeeLedgerAdditionalTargetError('الموظف غير موجود أو غير نشط');
  }

  const branch = await db
    .request()
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT BranchID, BranchCode, BranchName
      FROM dbo.TblBranch
      WHERE BranchID = @branchId AND ISNULL(IsActive, 1) = 1
    `);
  if (branch.recordset.length === 0) {
    throw new EmployeeLedgerAdditionalTargetError('الفرع غير موجود أو غير نشط');
  }

  return {
    empId: Number(emp.recordset[0].EmpID),
    empName: String(emp.recordset[0].EmpName),
    branchId: Number(branch.recordset[0].BranchID),
    branchCode: String(branch.recordset[0].BranchCode ?? ''),
    branchName: String(branch.recordset[0].BranchName ?? ''),
  };
}

async function sumTargetCredits(params: {
  empId: number;
  branchId: number;
  dateFrom: string;
  dateTo: string;
  reasonFilter?: 'all' | 'earned' | 'additional';
}): Promise<number> {
  const db = await getPool();
  const req = db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('dateFrom', sql.Date, params.dateFrom)
    .input('dateTo', sql.Date, params.dateTo);

  let reasonSql = `l.EntryReason IN (N'target', N'commission', N'bonus')`;
  if (params.reasonFilter === 'earned') {
    reasonSql = `l.EntryReason IN (N'target', N'commission')`;
  } else if (params.reasonFilter === 'additional') {
    reasonSql = `l.EntryReason = N'bonus'`;
  }

  const result = await req.query(`
    SELECT ISNULL(SUM(l.Amount), 0) AS Total
    FROM dbo.TblEmpLedgerEntry l
    WHERE l.EmpID = @empId
      AND l.BranchID = @branchId
      AND l.IsVoided = 0
      AND l.EntryDirection = N'credit'
      AND ${reasonSql}
      AND l.EntryDate >= @dateFrom
      AND l.EntryDate <= @dateTo
  `);
  return roundMoney(Number(result.recordset[0]?.Total ?? 0));
}

export async function previewAdditionalTarget(params: {
  empId: number;
  branchId: number;
  entryDate: string;
}): Promise<AdditionalTargetPreview> {
  if (!params.empId || params.empId <= 0) {
    throw new EmployeeLedgerAdditionalTargetError('يجب اختيار الموظف');
  }
  if (!params.branchId || params.branchId <= 0) {
    throw new EmployeeLedgerAdditionalTargetError('يجب اختيار الفرع');
  }
  if (!DATE_RE.test(params.entryDate)) {
    throw new EmployeeLedgerAdditionalTargetError('التاريخ يجب أن يكون بصيغة YYYY-MM-DD');
  }

  const meta = await loadEmployeeAndBranch(params.empId, params.branchId);
  const monthStart = `${params.entryDate.slice(0, 7)}-01`;

  const [dayTargetTotal, dayTargetEarned, dayAdditionalTarget, monthTargetTotal] =
    await Promise.all([
      sumTargetCredits({
        empId: params.empId,
        branchId: params.branchId,
        dateFrom: params.entryDate,
        dateTo: params.entryDate,
        reasonFilter: 'all',
      }),
      sumTargetCredits({
        empId: params.empId,
        branchId: params.branchId,
        dateFrom: params.entryDate,
        dateTo: params.entryDate,
        reasonFilter: 'earned',
      }),
      sumTargetCredits({
        empId: params.empId,
        branchId: params.branchId,
        dateFrom: params.entryDate,
        dateTo: params.entryDate,
        reasonFilter: 'additional',
      }),
      sumTargetCredits({
        empId: params.empId,
        branchId: params.branchId,
        dateFrom: monthStart,
        dateTo: params.entryDate,
        reasonFilter: 'all',
      }),
    ]);

  return {
    ...meta,
    entryDate: params.entryDate,
    dayTargetTotal,
    monthTargetTotal,
    dayTargetEarned,
    dayAdditionalTarget,
  };
}

/**
 * Ledger-only credit: additional target (bonus bucket) for emp + branch + date.
 * No cash move — entitlement only.
 */
export async function postAdditionalTarget(params: {
  empId: number;
  branchId: number;
  entryDate: string;
  amount: number;
  notes?: string | null;
  createdByUserId?: number | null;
}): Promise<AdditionalTargetPostResult> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    throw new EmployeeLedgerAdditionalTargetError(
      'ميزة التارجت الإضافي تتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED=true',
    );
  }
  if (!params.empId || params.empId <= 0) {
    throw new EmployeeLedgerAdditionalTargetError('يجب اختيار الموظف');
  }
  if (!params.branchId || params.branchId <= 0) {
    throw new EmployeeLedgerAdditionalTargetError('يجب اختيار الفرع');
  }
  if (!DATE_RE.test(params.entryDate)) {
    throw new EmployeeLedgerAdditionalTargetError('التاريخ يجب أن يكون بصيغة YYYY-MM-DD');
  }
  if (!params.amount || params.amount <= 0) {
    throw new EmployeeLedgerAdditionalTargetError('يجب إدخال مبلغ صحيح أكبر من صفر');
  }

  const amount = roundMoney(params.amount);
  const preview = await previewAdditionalTarget({
    empId: params.empId,
    branchId: params.branchId,
    entryDate: params.entryDate,
  });

  const db = await getPool();
  const transaction = new sql.Transaction(db);
  await transaction.begin();

  try {
    const payrollMonth = payrollMonthFromWorkDate(params.entryDate);
    const notes = buildAdditionalTargetNote(params.entryDate, params.notes);

    const insert = await new sql.Request(transaction)
      .input('BranchID', sql.Int, params.branchId)
      .input('EmpID', sql.Int, params.empId)
      .input('EntryDate', sql.Date, params.entryDate)
      .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_ADDITIONAL_TARGET)
      .input('Amount', sql.Decimal(12, 2), amount)
      .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
      .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_ADDITIONAL_TARGET)
      .input('Notes', sql.NVarChar(500), notes)
      .input('CreatedByUserID', sql.Int, params.createdByUserId ?? null)
      .query(`
        INSERT INTO dbo.TblEmpLedgerEntry (
          BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
          PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
          Notes, IsVoided, CreatedByUserID, CreatedAt
        )
        OUTPUT INSERTED.ID
        VALUES (
          @BranchID, @EmpID, @EntryDate, N'credit', @EntryReason, @Amount,
          @PayrollMonth, @RefType, NULL, NULL, NULL,
          @Notes, 0, @CreatedByUserID, SYSDATETIME()
        )
      `);

    const ledgerEntryId = Number(insert.recordset[0].ID);
    await transaction.commit();

    return {
      success: true,
      ledgerEntryId,
      empId: preview.empId,
      empName: preview.empName,
      branchId: preview.branchId,
      branchCode: preview.branchCode,
      entryDate: params.entryDate,
      amountAdded: amount,
      previousDayTargetTotal: preview.dayTargetTotal,
      newDayTargetTotal: roundMoney(preview.dayTargetTotal + amount),
      monthTargetTotalAfter: roundMoney(preview.monthTargetTotal + amount),
    };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  }
}
