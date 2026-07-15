import 'server-only';

import { getPool, sql, allocateInvID } from '@/lib/db';
import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';
import { roundMoney } from '@/lib/reportMonthUtils';
import {
  EmployeeLedgerDualWriteError,
  EMP_LEDGER_REF_TYPE_CASH_MOVE,
  EMP_LEDGER_REASON_EMPLOYEE_FUNDING,
  isMissingLedgerTableError,
  payrollMonthFromWorkDate,
} from '@/lib/services/employeeLedgerDualWrite';
import { getEmployeeAllTimeBalance, validateLedgerMonth } from '@/lib/services/employeeLedgerService';
import type { EmpLedgerFundingResponse } from '@/lib/types/employee-ledger';

export const EMPLOYEE_FUNDING_CATEGORY_NAME = 'تمويل من موظف';
export { EMP_LEDGER_REASON_EMPLOYEE_FUNDING };
export const EMPLOYEE_FUNDING_LEDGER_NOTE = 'تمويل من موظف للمحل';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class EmployeeLedgerFundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeLedgerFundingError';
  }
}

function buildCashMoveNotes(employeeName: string, notes?: string | null): string {
  const base = `تمويل من موظف: ${employeeName}`;
  const extra = notes?.trim();
  return extra ? `${base} — ${extra}` : base;
}

function buildLedgerNotes(notes?: string | null): string {
  const extra = notes?.trim();
  return extra ? `${EMPLOYEE_FUNDING_LEDGER_NOTE} — ${extra}` : EMPLOYEE_FUNDING_LEDGER_NOTE;
}

export async function ensureEmployeeFundingIncomeCategory(
  transaction: sql.Transaction,
): Promise<number> {
  const findResult = await new sql.Request(transaction)
    .input('catName', sql.NVarChar(200), EMPLOYEE_FUNDING_CATEGORY_NAME)
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
    .input('catName', sql.NVarChar(200), EMPLOYEE_FUNDING_CATEGORY_NAME)
    .input('expType', sql.NVarChar(50), 'ايرادات')
    .query(`
      INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
      OUTPUT INSERTED.ExpINID
      VALUES (@catName, @expType)
    `);

  return Number(insertResult.recordset[0].ExpINID);
}

export async function insertEmployeeFundingLedgerEntry(
  request: sql.Request,
  params: {
    empId: number;
    cashMoveId: number;
    entryDate: string;
    amount: number;
    notes?: string | null;
    createdByUserId?: number | null;
  },
): Promise<number> {
  const payrollMonth = payrollMonthFromWorkDate(params.entryDate);

  const insertResult = await request
    .input('EmpID', sql.Int, params.empId)
    .input('EntryDate', sql.Date, params.entryDate)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_EMPLOYEE_FUNDING)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('RefID', sql.Int, params.cashMoveId)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .input('Notes', sql.NVarChar(500), buildLedgerNotes(params.notes))
    .input('CreatedByUserID', sql.Int, params.createdByUserId ?? null)
    .query(`
      INSERT INTO dbo.TblEmpLedgerEntry (
        EmpID, EntryDate, EntryDirection, EntryReason, Amount,
        PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
        Notes, IsVoided, CreatedByUserID, CreatedAt
      )
      OUTPUT INSERTED.ID
      VALUES (
        @EmpID, @EntryDate, N'credit', @EntryReason, @Amount,
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
}): Promise<EmpLedgerFundingResponse> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    throw new EmployeeLedgerFundingError(
      'ميزة تمويل الموظف تتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED=true',
    );
  }

  if (!params.empId || params.empId <= 0) {
    throw new EmployeeLedgerFundingError('يجب اختيار الموظف');
  }
  if (!params.amount || params.amount <= 0) {
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
  const db = await getPool();

  const empResult = await db.request()
    .input('empId', sql.Int, params.empId)
    .query(`
      SELECT EmpID, EmpName
      FROM dbo.TblEmp
      WHERE EmpID = @empId AND ISNULL(isActive, 1) = 1
    `);
  if (empResult.recordset.length === 0) {
    throw new EmployeeLedgerFundingError('الموظف غير موجود أو غير نشط');
  }
  const employee = empResult.recordset[0];
  const employeeName = String(employee.EmpName);

  const pmResult = await db.request()
    .input('paymentMethodId', sql.Int, params.paymentMethodId)
    .query(`
      SELECT PaymentID
      FROM dbo.TblPaymentMethods
      WHERE PaymentID = @paymentMethodId
    `);
  if (pmResult.recordset.length === 0) {
    throw new EmployeeLedgerFundingError('طريقة الدفع غير موجودة');
  }

  const now = new Date();
  const invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
  const cashNotes = buildCashMoveNotes(employeeName, params.notes);

  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const previousBalance = await getEmployeeAllTimeBalance(params.empId, transaction);
    const fundingExpINID = await ensureEmployeeFundingIncomeCategory(transaction);
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
      .input('EmpID', sql.Int, params.empId);

    const cashInsert = await cashReq.query(`
      INSERT INTO [dbo].[TblCashMove] (
        invID, invType, invDate, invTime, ClientID,
        ExpINID, GrandTolal, inOut, Notes, ShiftMoveID, PaymentMethodID, EmpID
      )
      OUTPUT INSERTED.ID
      VALUES (
        @invID, @invType, @invDate, @invTime, @ClientID,
        @ExpINID, @GrandTolal, @inOut, @Notes, @ShiftMoveID, @PaymentMethodID, @EmpID
      )
    `);
    const cashMoveId = Number(cashInsert.recordset[0].ID);

    const ledgerEntryId = await insertEmployeeFundingLedgerEntry(new sql.Request(transaction), {
      empId: params.empId,
      cashMoveId,
      entryDate: params.date,
      amount,
      notes: params.notes,
      createdByUserId: params.createdByUserId,
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
