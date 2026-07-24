import 'server-only';

import { getPool, sql, allocateInvID } from '@/lib/db';
import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';
import { roundMoney } from '@/lib/reportMonthUtils';
import {
  EmployeeLedgerDualWriteError,
  EMP_LEDGER_REF_TYPE_CASH_MOVE,
  isMissingLedgerTableError,
  payrollMonthFromWorkDate,
} from '@/lib/services/employeeLedgerDualWrite';
import { getEmployeeAllTimeBalance, validateLedgerMonth } from '@/lib/services/employeeLedgerService';
import type { EmpLedgerTipResponse } from '@/lib/types/employee-ledger';
import { calculateTipAmount } from '@/lib/pos/tipMath';

export { calculateTipAmount } from '@/lib/pos/tipMath';
export const EMP_LEDGER_REASON_TIP = 'tip';
export const TIP_INCOME_CATEGORY_NAME = 'تبس';
export const TIP_LEDGER_NOTE = 'تبس من فاتورة';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class EmployeeTipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeTipError';
  }
}

function buildCashMoveNotes(employeeName: string, tipAmount: number, invoiceTotal: number, amountPaid: number): string {
  return `تبس — ${employeeName} | فرق ${tipAmount.toFixed(2)} (دفع ${amountPaid.toFixed(2)} − فاتورة ${invoiceTotal.toFixed(2)})`;
}

function buildLedgerNotes(invoiceTotal: number, amountPaid: number): string {
  return `${TIP_LEDGER_NOTE} — دفع ${amountPaid.toFixed(2)} − إجمالي ${invoiceTotal.toFixed(2)}`;
}

export async function ensureTipIncomeCategory(
  transaction: sql.Transaction,
): Promise<number> {
  const findResult = await new sql.Request(transaction)
    .input('catName', sql.NVarChar(200), TIP_INCOME_CATEGORY_NAME)
    .input('expType', sql.NVarChar(50), 'ايرادات')
    .query(`
      SELECT ExpINID
      FROM dbo.TblExpINCat
      WHERE CatName = @catName AND ExpINType = @expType
    `);

  if (findResult.recordset.length > 0) {
    return Number(findResult.recordset[0].ExpINID);
  }

  const insertResult = await new sql.Request(transaction)
    .input('catName', sql.NVarChar(200), TIP_INCOME_CATEGORY_NAME)
    .input('expType', sql.NVarChar(50), 'ايرادات')
    .query(`
      INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
      OUTPUT INSERTED.ExpINID
      VALUES (@catName, @expType)
    `);

  return Number(insertResult.recordset[0].ExpINID);
}

async function insertTipLedgerEntry(
  request: sql.Request,
  params: {
    empId: number;
    branchId: number;
    cashMoveId: number;
    entryDate: string;
    amount: number;
    invoiceTotal: number;
    amountPaid: number;
    createdByUserId?: number | null;
  },
): Promise<number> {
  const payrollMonth = payrollMonthFromWorkDate(params.entryDate);

  const insertResult = await request
    .input('BranchID', sql.Int, params.branchId)
    .input('EmpID', sql.Int, params.empId)
    .input('EntryDate', sql.Date, params.entryDate)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_TIP)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('RefID', sql.Int, params.cashMoveId)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .input('Notes', sql.NVarChar(500), buildLedgerNotes(params.invoiceTotal, params.amountPaid))
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

export async function executeEmployeeTip(params: {
  empId: number;
  invoiceTotal: number;
  amountPaid: number;
  paymentMethodId: number;
  date: string;
  createdByUserId?: number | null;
  /** Never trust browser branchId — always resolved from gated session context. */
  branchId: number;
  /** Nullable only for legacy records predating the business-day migration. */
  businessDayId: number | null;
}): Promise<EmpLedgerTipResponse> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    throw new EmployeeTipError(
      'ميزة تبس الموظف تتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED=true',
    );
  }

  if (!params.empId || params.empId <= 0) {
    throw new EmployeeTipError('يجب اختيار الحلاق');
  }
  if (!params.paymentMethodId || params.paymentMethodId <= 0) {
    throw new EmployeeTipError('يجب اختيار طريقة الدفع');
  }
  if (!DATE_RE.test(params.date)) {
    throw new EmployeeTipError('date يجب أن يكون بصيغة YYYY-MM-DD');
  }
  if (!Number.isFinite(params.invoiceTotal) || params.invoiceTotal < 0) {
    throw new EmployeeTipError('إجمالي الفاتورة غير صالح');
  }
  if (!Number.isFinite(params.amountPaid) || params.amountPaid <= 0) {
    throw new EmployeeTipError('يجب إدخال المبلغ المدفوع بشكل صحيح');
  }

  const invoiceTotal = roundMoney(params.invoiceTotal);
  const amountPaid = roundMoney(params.amountPaid);
  const tipAmount = calculateTipAmount(amountPaid, invoiceTotal);

  if (tipAmount <= 0) {
    throw new EmployeeTipError(
      'المبلغ المدفوع يجب أن يكون أكبر من إجمالي الفاتورة حتى يوجد تبس',
    );
  }

  const payrollMonth = payrollMonthFromWorkDate(params.date);
  const monthError = validateLedgerMonth(payrollMonth);
  if (monthError) {
    throw new EmployeeTipError(monthError);
  }

  const parsedDate = new Date(`${params.date}T12:00:00`);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new EmployeeTipError('تاريخ غير صالح');
  }

  const db = await getPool();

  const empResult = await db.request()
    .input('empId', sql.Int, params.empId)
    .query(`
      SELECT EmpID, EmpName
      FROM dbo.TblEmp
      WHERE EmpID = @empId AND ISNULL(isActive, 1) = 1
    `);
  if (empResult.recordset.length === 0) {
    throw new EmployeeTipError('الموظف غير موجود أو غير نشط');
  }
  const employeeName = String(empResult.recordset[0].EmpName);

  const pmResult = await db.request()
    .input('paymentMethodId', sql.Int, params.paymentMethodId)
    .query(`
      SELECT PaymentID
      FROM dbo.TblPaymentMethods
      WHERE PaymentID = @paymentMethodId
    `);
  if (pmResult.recordset.length === 0) {
    throw new EmployeeTipError('طريقة الدفع غير موجودة');
  }

  const now = new Date();
  const invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
  const cashNotes = buildCashMoveNotes(employeeName, tipAmount, invoiceTotal, amountPaid);

  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const previousBalance = await getEmployeeAllTimeBalance(params.empId, transaction);
    const tipExpINID = await ensureTipIncomeCategory(transaction);
    const newInvID = await allocateInvID(transaction, 'TblCashMove', 'ايرادات', 5000);

    const cashReq = new sql.Request(transaction);
    cashReq
      .input('invID', sql.Int, newInvID)
      .input('invType', sql.NVarChar(20), 'ايرادات')
      .input('invDate', sql.Date, params.date)
      .input('invTime', sql.NVarChar(50), invTime)
      .input('ClientID', sql.Int, null)
      .input('ExpINID', sql.Int, tipExpINID)
      .input('GrandTolal', sql.Decimal(10, 2), tipAmount)
      .input('inOut', sql.NVarChar(5), 'in')
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

    const ledgerEntryId = await insertTipLedgerEntry(new sql.Request(transaction), {
      empId: params.empId,
      branchId: params.branchId,
      cashMoveId,
      entryDate: params.date,
      amount: tipAmount,
      invoiceTotal,
      amountPaid,
      createdByUserId: params.createdByUserId,
    });

    const newBalance = roundMoney(previousBalance + tipAmount);

    await transaction.commit();

    return {
      success: true,
      cashMoveId,
      ledgerEntryId,
      invID: newInvID,
      employeeName,
      invoiceTotal,
      amountPaid,
      tipAmount,
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

    if (err instanceof EmployeeTipError || err instanceof EmployeeLedgerDualWriteError) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    if (isMissingLedgerTableError(message)) {
      throw new EmployeeTipError(
        'جدول دفتر الموظفين غير موجود — شغّل ترحيل دفتر الموظفين ثم أعد المحاولة',
      );
    }

    if (/CK_TblEmpLedgerEntry_EntryReason|CHECK constraint/i.test(message)) {
      throw new EmployeeTipError(
        'سبب التبس غير مفعّل في قاعدة البيانات — شغّل db/migrations/add-employee-ledger-tip-reason.sql',
      );
    }

    throw new EmployeeTipError(`فشل تسجيل التبس: ${message}`);
  }
}
