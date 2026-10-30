import 'server-only';

import { getPool, sql, allocateInvID } from '@/lib/db';
import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';
import { roundMoney } from '@/lib/reportMonthUtils';
import { getMaxEmployeeAdvanceRepayment } from '@/lib/hr/advance-repayment';
import {
  EmployeeLedgerDualWriteError,
  EMP_LEDGER_REF_TYPE_CASH_MOVE,
  EMP_LEDGER_REASON_EMPLOYEE_FUNDING,
  isMissingLedgerTableError,
  payrollMonthFromWorkDate,
} from '@/lib/services/employeeLedgerDualWrite';
import { getEmployeeAllTimeBalance, getEmployeeBranchBalance, getEmployeeMonthlyBranchBalance, validateLedgerMonth } from '@/lib/services/employeeLedgerService';
import type { EmpLedgerFundingResponse } from '@/lib/types/employee-ledger';
import { getCairoInvTimeDotStr } from '@/lib/businessDate';
import { ensureTenantFinanceCategory } from '@/platform/masterData/financeCategories';
import { resolveLegacyBranchTenantId } from '@/platform/masterData/tenantScope';

export const EMPLOYEE_FUNDING_CATEGORY_NAME = 'تمويل من موظف';
export const ADVANCE_REPAYMENT_CATEGORY_NAME = 'سداد سلفة موظف';
export { EMP_LEDGER_REASON_EMPLOYEE_FUNDING };
export const EMPLOYEE_FUNDING_LEDGER_NOTE = 'تمويل من موظف للمحل';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class EmployeeLedgerFundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeLedgerFundingError';
  }
}

function buildCashMoveNotes(employeeName: string, notes?: string | null, repaymentId?: string): string {
  const base = repaymentId ? `سداد سلفة موظف: ${employeeName}` : `تمويل من موظف: ${employeeName}`;
  const extra = notes?.trim();
  const label = extra ? `${base} — ${extra}` : base;
  return repaymentId ? `${label} — repaymentRef:${repaymentId}` : label;
}

function buildLedgerNotes(notes?: string | null, repayment?: boolean): string {
  const base = repayment ? 'سداد سلفة موظف للمحل (تحصيل دين، ليس مبيعات)' : EMPLOYEE_FUNDING_LEDGER_NOTE;
  const extra = notes?.trim();
  return (extra ? `${base} — ${extra}` : base).slice(0, 500);
}

export async function ensureEmployeeFundingIncomeCategory(
  transaction: sql.Transaction,
  tenantId: string,
): Promise<number> {
  return ensureTenantFinanceCategory(transaction, tenantId, EMPLOYEE_FUNDING_CATEGORY_NAME, 'ايرادات');
}

export async function insertEmployeeFundingLedgerEntry(
  request: sql.Request,
  params: {
    empId: number;
    branchId: number;
    cashMoveId: number;
    entryDate: string;
    amount: number;
    notes?: string | null;
    createdByUserId?: number | null;
    repayment?: boolean;
  },
): Promise<number> {
  const payrollMonth = payrollMonthFromWorkDate(params.entryDate);

  const insertResult = await request
    .input('BranchID', sql.Int, params.branchId)
    .input('EmpID', sql.Int, params.empId)
    .input('EntryDate', sql.Date, params.entryDate)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_EMPLOYEE_FUNDING)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('RefID', sql.Int, params.cashMoveId)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .input('Notes', sql.NVarChar(500), buildLedgerNotes(params.notes, params.repayment))
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
        @PayrollMonth, @RefType, @RefID, @CashMoveID, NULL,
        @Notes, 0, @CreatedByUserID, SYSDATETIME()
      )
    `);

  return Number(insertResult.recordset[0].ID);
}

export async function executeEmployeeFunding(params: {
  empId: number;
  amount: number;
  paymentMethodId: number;
  date: string;
  notes?: string | null;
  createdByUserId?: number | null;
  /** Never trust browser branchId — always resolved from gated session context. */
  branchId: number;
  /** Nullable only for legacy records predating the business-day migration. */
  businessDayId: number | null;
  /** Dedicated collection of an existing employee advance, never new employee investment. */
  purpose?: 'advance_repayment';
  /** Stable UUID prevents a repeated click/network retry from collecting twice. */
  repaymentId?: string;
}): Promise<EmpLedgerFundingResponse> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    throw new EmployeeLedgerFundingError(
      'ميزة تمويل الموظف تتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED=true',
    );
  }

  if (!params.empId || params.empId <= 0) {
    throw new EmployeeLedgerFundingError('يجب اختيار الموظف');
  }
  if (!Number.isFinite(params.amount) || !params.amount || params.amount <= 0) {
    throw new EmployeeLedgerFundingError('يجب إدخال مبلغ صحيح أكبر من صفر');
  }
  if (!params.paymentMethodId || params.paymentMethodId <= 0) {
    throw new EmployeeLedgerFundingError('يجب اختيار طريقة الدفع');
  }
  if (!DATE_RE.test(params.date)) {
    throw new EmployeeLedgerFundingError('date يجب أن يكون بصيغة YYYY-MM-DD');
  }

  const payrollMonth = payrollMonthFromWorkDate(params.date);
  const monthError = validateLedgerMonth(payrollMonth);
  if (monthError) {
    throw new EmployeeLedgerFundingError(monthError);
  }

  const parsedDate = new Date(`${params.date}T12:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new EmployeeLedgerFundingError('تاريخ غير صالح');
  }

  const amount = roundMoney(params.amount);
  if (amount <= 0) throw new EmployeeLedgerFundingError('مبلغ السداد يجب ألا يقل عن قرش واحد');
  const isRepayment = params.purpose === 'advance_repayment';
  if (isRepayment && (!params.repaymentId || !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(params.repaymentId))) {
    throw new EmployeeLedgerFundingError('معرف سداد السلفة غير صالح');
  }
  const db = await getPool();
  const tenantId = await resolveLegacyBranchTenantId(params.branchId);

  const empResult = await db.request()
    .input('empId', sql.Int, params.empId)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT EmpID, EmpName
      FROM dbo.TblEmp
      WHERE EmpID = @empId AND TenantId = @tenantId AND ISNULL(isActive, 1) = 1
    `);
  if (empResult.recordset.length === 0) {
    throw new EmployeeLedgerFundingError('الموظف غير موجود أو غير نشط');
  }
  const employee = empResult.recordset[0];
  const employeeName = String(employee.EmpName);

  const pmResult = await db.request()
    .input('paymentMethodId', sql.Int, params.paymentMethodId)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT PaymentID
      FROM dbo.TblPaymentMethods
      WHERE PaymentID = @paymentMethodId AND TenantId = @tenantId
    `);
  if (pmResult.recordset.length === 0) {
    throw new EmployeeLedgerFundingError('طريقة الدفع غير موجودة');
  }

  const invTime = getCairoInvTimeDotStr();
  const cashNotes = buildCashMoveNotes(employeeName, params.notes, isRepayment ? params.repaymentId : undefined);

  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    if (isRepayment) {
      // One transaction-scoped lock per employee/branch/month; protects the debt limit
      // and the idempotency check against concurrent settlement requests.
      const lock = await new sql.Request(transaction)
        .input('lockResource', sql.NVarChar(255), `advance-repay:${params.branchId}:${params.empId}:${payrollMonth}`)
        .query(`
          DECLARE @status INT;
          EXEC @status = sys.sp_getapplock
            @Resource = @lockResource, @LockMode = 'Exclusive',
            @LockOwner = 'Transaction', @LockTimeout = 10000;
          SELECT @status AS LockStatus;
        `);
      if (Number(lock.recordset[0]?.LockStatus) < 0) {
        throw new EmployeeLedgerFundingError('تعذر تأمين تسجيل السداد، برجاء المحاولة مرة أخرى');
      }

      // A retry of exactly the same operation must return the existing receipt.
      const prior = await new sql.Request(transaction)
        .input('empId', sql.Int, params.empId)
        .input('branchId', sql.Int, params.branchId)
        .input('marker', sql.NVarChar(100), `repaymentRef:${params.repaymentId}`)
        .query(`
          SELECT TOP (1) cm.ID AS CashMoveID, l.ID AS LedgerEntryID, cm.GrandTolal AS Amount
          FROM dbo.TblCashMove cm WITH (UPDLOCK, HOLDLOCK)
          INNER JOIN dbo.TblEmpLedgerEntry l ON l.CashMoveID = cm.ID AND l.IsVoided = 0
          WHERE cm.EmpID = @empId AND cm.BranchID = @branchId
            AND cm.invType = N'ايرادات' AND cm.inOut = N'in'
            AND CHARINDEX(@marker, ISNULL(cm.Notes, N'')) > 0
          ORDER BY cm.ID DESC
        `);
      if (prior.recordset.length) {
        const priorRow = prior.recordset[0];
        const currentBalance = await getEmployeeAllTimeBalance(params.empId, transaction);
        if (roundMoney(Number(priorRow.Amount)) !== amount) {
          throw new EmployeeLedgerFundingError('هذا الطلب سُجل سابقًا بمبلغ مختلف');
        }
        await transaction.commit();
        return {
          success: true, cashMoveId: Number(priorRow.CashMoveID),
          ledgerEntryId: Number(priorRow.LedgerEntryID),
          employeeName, amount, previousBalance: roundMoney(currentBalance - amount),
          newBalance: currentBalance, ledgerDualWrite: true, idempotentReplay: true,
        };
      }

      // Never collect more than the employee owes on THIS branch and month.
      // The branch-wide balance also prevents "repaying" a debt cleared by other months.
      const branchBalance = await getEmployeeBranchBalance(params.empId, params.branchId, transaction);
      const monthBalance = await getEmployeeMonthlyBranchBalance(
        params.empId, params.branchId, payrollMonth, transaction,
      );
      const due = getMaxEmployeeAdvanceRepayment(branchBalance, monthBalance);
      if (due <= 0) throw new EmployeeLedgerFundingError('لا توجد سلفة مستحقة قابلة للسداد على هذا الفرع والشهر');
      if (amount > due) throw new EmployeeLedgerFundingError(`المبلغ أكبر من العجز المتبقي (${due.toFixed(2)} ج.م)`);
    }

    const previousBalance = await getEmployeeAllTimeBalance(params.empId, transaction);
    const fundingExpINID = isRepayment
      ? await ensureTenantFinanceCategory(transaction, tenantId, ADVANCE_REPAYMENT_CATEGORY_NAME, 'ايرادات')
      : await ensureEmployeeFundingIncomeCategory(transaction, tenantId);
    const newInvID = await allocateInvID(transaction, 'TblCashMove', 'ايرادات', 5000);

    const cashReq = new sql.Request(transaction);
    cashReq
      .input('invID', sql.Int, newInvID)
      .input('invType', sql.NVarChar(20), N('ايرادات'))
      .input('invDate', sql.Date, params.date)
      .input('invTime', sql.NVarChar(50), invTime)
      .input('ClientID', sql.Int, null)
      .input('ExpINID', sql.Int, fundingExpINID)
      .input('GrandTolal', sql.Decimal(10, 2), amount)
      .input('inOut', sql.NVarChar(5), N('in'))
      .input('Notes', sql.NVarChar(sql.MAX), cashNotes)
      .input('ShiftMoveID', sql.Int, null)
      .input('PaymentMethodID', sql.Int, params.paymentMethodId)
      .input('EmpID', sql.Int, params.empId)
      .input('BranchID', sql.Int, params.branchId)
      .input('BusinessDayID', sql.Int, params.businessDayId);

    const cashInsert = await cashReq.query(`
      INSERT INTO [dbo].[TblCashMove] (
        invID, invType, invDate, invTime, ClientID,
        ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID, EmpID,
        BranchID, BusinessDayID
      )
      OUTPUT INSERTED.ID
      VALUES (
        @invID, @invType, @invDate, @invTime, @ClientID,
        @ExpINID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID, @EmpID,
        @BranchID, @BusinessDayID
      )
    `);
    const cashMoveId = Number(cashInsert.recordset[0].ID);

    const ledgerEntryId = await insertEmployeeFundingLedgerEntry(new sql.Request(transaction), {
      empId: params.empId,
      branchId: params.branchId,
      cashMoveId,
      entryDate: params.date,
      amount,
      notes: params.notes,
      createdByUserId: params.createdByUserId,
      repayment: isRepayment,
    });

    const newBalance = roundMoney(previousBalance + amount);

    await transaction.commit();

    return {
      success: true,
      cashMoveId,
      ledgerEntryId,
      employeeName,
      amount,
      previousBalance,
      newBalance,
      ledgerDualWrite: true,
    };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* already rolled back */
    }

    if (err instanceof EmployeeLedgerFundingError || err instanceof EmployeeLedgerDualWriteError) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    if (isMissingLedgerTableError(message)) {
      throw new EmployeeLedgerFundingError(
        'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql ثم أعد المحاولة',
      );
    }

    throw new EmployeeLedgerFundingError(`فشل تسجيل تمويل الموظف: ${message}`);
  }
}

function N(value: string): string {
  return value;
}
