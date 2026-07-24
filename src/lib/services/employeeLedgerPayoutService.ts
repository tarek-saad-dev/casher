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
import { getEmployeeBranchBalance } from '@/lib/services/employeeLedgerService';
import type { EmpLedgerPayoutResponse } from '@/lib/types/employee-ledger';

export const PAYOUT_EXPENSE_CATEGORY_NAME = 'صرف مستحقات الموظفين';
export const EMP_LEDGER_REASON_PAYOUT = 'payout';
export const PAYOUT_LEDGER_NOTE = 'صرف مستحقات موظف من الخزنة';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class EmployeeLedgerPayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeLedgerPayoutError';
  }
}

function buildCashMoveNotes(employeeName: string, notes?: string | null): string {
  const base = `صرف مستحقات موظف: ${employeeName}`;
  const extra = notes?.trim();
  return extra ? `${base} — ${extra}` : base;
}

export async function ensurePayoutExpenseCategory(
  transaction: sql.Transaction,
): Promise<number> {
  const findResult = await new sql.Request(transaction)
    .input('catName', sql.NVarChar(200), PAYOUT_EXPENSE_CATEGORY_NAME)
    .input('expType', sql.NVarChar(50), 'مصروفات')
    .query(`
      SELECT ExpINID
      FROM dbo.TblExpINCat
      WHERE CatName = @catName AND ExpINType = @expType
    `);

  if (findResult.recordset.length > 0) {
    return Number(findResult.recordset[0].ExpINID);
  }

  const insertResult = await new sql.Request(transaction)
    .input('catName', sql.NVarChar(200), PAYOUT_EXPENSE_CATEGORY_NAME)
    .input('expType', sql.NVarChar(50), 'مصروفات')
    .query(`
      INSERT INTO dbo.TblExpINCat (CatName, ExpINType)
      OUTPUT INSERTED.ExpINID
      VALUES (@catName, @expType)
    `);

  return Number(insertResult.recordset[0].ExpINID);
}

export async function insertPayoutLedgerEntry(
  request: sql.Request,
  params: {
    empId: number;
    branchId: number;
    cashMoveId: number;
    entryDate: string;
    amount: number;
    createdByUserId?: number | null;
  },
): Promise<number> {
  const payrollMonth = payrollMonthFromWorkDate(params.entryDate);

  const insertResult = await request
    .input('EmpID', sql.Int, params.empId)
    .input('BranchID', sql.Int, params.branchId)
    .input('EntryDate', sql.Date, params.entryDate)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_PAYOUT)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('RefID', sql.Int, params.cashMoveId)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .input('Notes', sql.NVarChar(500), PAYOUT_LEDGER_NOTE)
    .input('CreatedByUserID', sql.Int, params.createdByUserId ?? null)
    .query(`
      INSERT INTO dbo.TblEmpLedgerEntry (
        BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
        PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
        Notes, IsVoided, CreatedByUserID, CreatedAt
      )
      OUTPUT INSERTED.ID
      VALUES (
        @BranchID, @EmpID, @EntryDate, N'debit', @EntryReason, @Amount,
        @PayrollMonth, @RefType, @RefID, @CashMoveID, NULL,
        @Notes, 0, @CreatedByUserID, SYSDATETIME()
      )
    `);

  return Number(insertResult.recordset[0].ID);
}

export async function executeEmployeePayout(params: {
  empId: number;
  amount: number;
  paymentMethodId: number;
  payoutDate: string;
  notes?: string | null;
  createdByUserId?: number | null;
  allowOverpay?: boolean;
  /** Never trust browser branchId — always resolved from gated session context. */
  branchId: number;
  /** Nullable only for legacy records predating the business-day migration. */
  businessDayId: number | null;
}): Promise<EmpLedgerPayoutResponse> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    throw new EmployeeLedgerPayoutError(
      'ميزة صرف المستحقات تتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED=true',
    );
  }

  if (!params.empId || params.empId <= 0) {
    throw new EmployeeLedgerPayoutError('يجب اختيار الموظف');
  }
  if (!params.amount || params.amount <= 0) {
    throw new EmployeeLedgerPayoutError('يجب إدخال مبلغ صحيح أكبر من صفر');
  }
  if (!params.paymentMethodId || params.paymentMethodId <= 0) {
    throw new EmployeeLedgerPayoutError('يجب اختيار طريقة الدفع');
  }
  if (!DATE_RE.test(params.payoutDate)) {
    throw new EmployeeLedgerPayoutError('payoutDate يجب أن يكون بصيغة YYYY-MM-DD');
  }

  const amount = roundMoney(params.amount);
  const allowOverpay = params.allowOverpay === true;

  const db = await getPool();

  const empResult = await db.request()
    .input('empId', sql.Int, params.empId)
    .query(`
      SELECT EmpID, EmpName
      FROM dbo.TblEmp
      WHERE EmpID = @empId AND ISNULL(isActive, 1) = 1
    `);
  if (empResult.recordset.length === 0) {
    throw new EmployeeLedgerPayoutError('الموظف غير موجود أو غير نشط');
  }
  const employee = empResult.recordset[0];

  const pmResult = await db.request()
    .input('paymentMethodId', sql.Int, params.paymentMethodId)
    .query(`
      SELECT PaymentID
      FROM dbo.TblPaymentMethods
      WHERE PaymentID = @paymentMethodId
    `);
  if (pmResult.recordset.length === 0) {
    throw new EmployeeLedgerPayoutError('طريقة الدفع غير موجودة');
  }

  const now = new Date();
  const invTime = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
  const cashNotes = buildCashMoveNotes(String(employee.EmpName), params.notes);

  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const previousBalance = await getEmployeeBranchBalance(
      params.empId,
      params.branchId,
      transaction,
    );

    if (!allowOverpay && amount > previousBalance) {
      throw new EmployeeLedgerPayoutError(
        'المبلغ أكبر من رصيد الموظف في هذا الفرع',
      );
    }

    const payoutExpINID = await ensurePayoutExpenseCategory(transaction);
    const newInvID = await allocateInvID(transaction, 'TblCashMove', 'مصروفات', 5000);

    const cashReq = new sql.Request(transaction);
    cashReq
      .input('invID', sql.Int, newInvID)
      .input('invType', sql.NVarChar(20), N('مصروفات'))
      .input('invDate', sql.Date, params.payoutDate)
      .input('invTime', sql.NVarChar(50), invTime)
      .input('ClientID', sql.Int, null)
      .input('ExpINID', sql.Int, payoutExpINID)
      .input('GrandTolal', sql.Decimal(10, 2), amount)
      .input('inOut', sql.NVarChar(5), N('out'))
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

    const ledgerEntryId = await insertPayoutLedgerEntry(new sql.Request(transaction), {
      empId: params.empId,
      branchId: params.branchId,
      cashMoveId,
      entryDate: params.payoutDate,
      amount,
      createdByUserId: params.createdByUserId,
    });

    const newBalance = roundMoney(previousBalance - amount);

    await transaction.commit();

    return {
      success: true,
      cashMoveId,
      ledgerEntryId,
      previousBalance,
      payoutAmount: amount,
      newBalance,
      ledgerDualWrite: true,
    };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* already rolled back */
    }

    if (err instanceof EmployeeLedgerPayoutError || err instanceof EmployeeLedgerDualWriteError) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    if (isMissingLedgerTableError(message)) {
      throw new EmployeeLedgerPayoutError(
        'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql ثم أعد المحاولة',
      );
    }

    throw new EmployeeLedgerPayoutError(`فشل صرف مستحقات الموظف: ${message}`);
  }
}

function N(value: string): string {
  return value;
}
