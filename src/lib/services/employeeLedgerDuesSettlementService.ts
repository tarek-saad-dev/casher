import 'server-only';

import { getPool, sql, allocateInvID } from '@/lib/db';
import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import { ensureEmployeeAdvanceMapping } from '@/lib/hr/employee-hr-advance';
import { resolveLegacyBranchTenantId } from '@/platform/masterData/tenantScope';
import {
  EmployeeLedgerDualWriteError,
  EMP_LEDGER_REF_TYPE_CASH_MOVE,
  EMP_LEDGER_REASON_ADVANCE,
  FINAL_ADVANCE_SETTLEMENT_NOTE_PREFIX,
  isMissingLedgerTableError,
} from '@/lib/services/employeeLedgerDualWrite';
import {
  getEmployeeMonthlyBranchBalance,
  validateLedgerMonth,
} from '@/lib/services/employeeLedgerService';
import type { EmpLedgerDuesSettlementResponse } from '@/lib/types/employee-ledger';
import { getCairoInvTimeDotStr } from '@/lib/businessDate';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9-]{8,128}$/;

export const DUES_SETTLEMENT_NOTE_PREFIX = FINAL_ADVANCE_SETTLEMENT_NOTE_PREFIX;
export const DUES_SETTLEMENT_IDEMPOTENCY_PREFIX = '[settle-id:';

export class EmployeeLedgerDuesSettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeLedgerDuesSettlementError';
  }
}

export function buildDuesSettlementLedgerNote(payrollMonth: string): string {
  return `${DUES_SETTLEMENT_NOTE_PREFIX} ${payrollMonth} — صرف مستحقات`;
}

export function buildDuesSettlementCashMoveNotes(
  employeeName: string,
  payrollMonth: string,
  idempotencyKey?: string | null,
): string {
  const base = `${buildDuesSettlementLedgerNote(payrollMonth)} — ${employeeName}`;
  const key = idempotencyKey?.trim();
  if (key && IDEMPOTENCY_KEY_RE.test(key)) {
    return `${base} ${DUES_SETTLEMENT_IDEMPOTENCY_PREFIX}${key}]`;
  }
  return base;
}

function bindMonthBalanceInputs(
  req: sql.Request,
  month: string,
): sql.Request {
  const [yearStr, monthStr] = month.split('-');
  const { startDate, endDate } = getMonthDateRange(
    parseInt(yearStr, 10),
    parseInt(monthStr, 10),
  );
  return req
    .input('month', sql.NVarChar(7), month)
    .input('monthStart', sql.Date, startDate)
    .input('monthEnd', sql.Date, endDate);
}

async function findExistingSettlementByIdempotencyKey(
  transaction: sql.Transaction,
  params: {
    empId: number;
    branchId: number;
    payrollMonth: string;
    idempotencyKey: string;
  },
): Promise<{ cashMoveId: number; ledgerEntryId: number } | null> {
  // The marker lives only on TblCashMove.Notes. Compare it literally:
  // T-SQL LIKE treats [settle-id:…] as a character class, so a different UUID
  // would match the payroll-month digits in the ledger note and skip a real cash-out.
  const marker = `${DUES_SETTLEMENT_IDEMPOTENCY_PREFIX}${params.idempotencyKey}]`;
  const result = await bindMonthBalanceInputs(new sql.Request(transaction), params.payrollMonth)
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('marker', sql.NVarChar(200), marker)
    .input('entryReason', sql.NVarChar(40), EMP_LEDGER_REASON_ADVANCE)
    .query(`
      SELECT TOP 1
        l.ID AS LedgerEntryID,
        c.ID AS CashMoveID
      FROM dbo.TblCashMove c
      INNER JOIN dbo.TblEmpLedgerEntry l
        ON l.CashMoveID = c.ID
       AND l.EmpID = c.EmpID
       AND l.BranchID = c.BranchID
      WHERE c.EmpID = @empId
        AND c.BranchID = @branchId
        AND l.PayrollMonth = @month
        AND l.EntryReason = @entryReason
        AND l.IsVoided = 0
        AND CHARINDEX(@marker, c.Notes) > 0
      ORDER BY l.ID DESC
    `);

  if (result.recordset.length === 0) {
    return null;
  }

  const row = result.recordset[0];
  return {
    cashMoveId: Number(row.CashMoveID),
    ledgerEntryId: Number(row.LedgerEntryID),
  };
}

async function insertDuesSettlementAdvanceLedgerEntry(
  request: sql.Request,
  params: {
    empId: number;
    branchId: number;
    cashMoveId: number;
    entryDate: string;
    payrollMonth: string;
    amount: number;
    notes: string;
    createdByUserId?: number | null;
  },
): Promise<number> {
  const insertResult = await request
    .input('BranchID', sql.Int, params.branchId)
    .input('EmpID', sql.Int, params.empId)
    .input('EntryDate', sql.Date, params.entryDate)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_ADVANCE)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), params.payrollMonth)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('RefID', sql.Int, params.cashMoveId)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .input('Notes', sql.NVarChar(500), params.notes)
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

export async function executeEmployeeDuesSettlement(params: {
  empId: number;
  amount: number;
  expectedBalance: number;
  payrollMonth: string;
  paymentMethodId: number;
  payoutDate: string;
  idempotencyKey?: string | null;
  notes?: string | null;
  createdByUserId?: number | null;
  branchId: number;
  businessDayId: number | null;
}): Promise<EmpLedgerDuesSettlementResponse> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    throw new EmployeeLedgerDuesSettlementError(
      'ميزة صرف المستحقات تتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED=true',
    );
  }

  const payrollMonth = String(params.payrollMonth ?? '').trim();
  const monthError = validateLedgerMonth(payrollMonth);
  if (monthError) {
    throw new EmployeeLedgerDuesSettlementError(monthError);
  }

  if (!params.empId || params.empId <= 0) {
    throw new EmployeeLedgerDuesSettlementError('يجب اختيار الموظف');
  }
  if (!params.branchId || params.branchId <= 0) {
    throw new EmployeeLedgerDuesSettlementError('يجب تحديد فرع الجلسة النشط لصرف المستحقات');
  }
  if (!params.paymentMethodId || params.paymentMethodId <= 0) {
    throw new EmployeeLedgerDuesSettlementError('يجب اختيار طريقة الدفع');
  }
  if (!DATE_RE.test(params.payoutDate)) {
    throw new EmployeeLedgerDuesSettlementError('payoutDate يجب أن يكون بصيغة YYYY-MM-DD');
  }

  const amount = roundMoney(params.amount);
  const expectedBalance = roundMoney(params.expectedBalance);
  const idempotencyKey = params.idempotencyKey?.trim() ?? '';

  if (!amount || amount <= 0) {
    throw new EmployeeLedgerDuesSettlementError(
      'لا يوجد مستحقات موجبة لهذا الموظف في هذا الشهر — لا يمكن تنفيذ صرف مستحقات',
    );
  }
  if (amount !== expectedBalance) {
    throw new EmployeeLedgerDuesSettlementError(
      'تغيّر رصيد الشهر — حدّث الصفحة ثم أعد المحاولة',
    );
  }
  if (idempotencyKey && !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    throw new EmployeeLedgerDuesSettlementError('مفتاح idempotencyKey غير صالح');
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
    throw new EmployeeLedgerDuesSettlementError('الموظف غير موجود أو غير نشط');
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
    throw new EmployeeLedgerDuesSettlementError('طريقة الدفع غير موجودة');
  }

  const ledgerNote = buildDuesSettlementLedgerNote(payrollMonth);
  const cashNotes = buildDuesSettlementCashMoveNotes(employeeName, payrollMonth, idempotencyKey);
  const invTime = getCairoInvTimeDotStr();

  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    if (idempotencyKey) {
      const existing = await findExistingSettlementByIdempotencyKey(transaction, {
        empId: params.empId,
        branchId: params.branchId,
        payrollMonth,
        idempotencyKey,
      });
      if (existing) {
        const replayBalance = await getEmployeeMonthlyBranchBalance(
          params.empId,
          params.branchId,
          payrollMonth,
          transaction,
        );
        await transaction.commit();
        return {
          success: true,
          cashMoveId: existing.cashMoveId,
          ledgerEntryId: existing.ledgerEntryId,
          payrollMonth,
          branchId: params.branchId,
          previousMonthlyBalance: roundMoney(replayBalance + amount),
          settlementAmount: amount,
          newMonthlyBalance: replayBalance,
          ledgerDualWrite: true,
          idempotentReplay: true,
        };
      }
    }

    const previousMonthlyBalance = await getEmployeeMonthlyBranchBalance(
      params.empId,
      params.branchId,
      payrollMonth,
      transaction,
    );

    if (previousMonthlyBalance <= 0) {
      throw new EmployeeLedgerDuesSettlementError(
        'لا يوجد مستحقات موجبة لهذا الموظف في هذا الشهر — لا يمكن تنفيذ صرف مستحقات',
      );
    }
    if (amount !== previousMonthlyBalance) {
      throw new EmployeeLedgerDuesSettlementError(
        'تغيّر رصيد الشهر — حدّث الصفحة ثم أعد المحاولة',
      );
    }

    const { expINID } = await ensureEmployeeAdvanceMapping(
      transaction,
      tenantId,
      params.empId,
      employeeName,
    );

    const newInvID = await allocateInvID(transaction, 'TblCashMove', 'مصروفات', 5000);

    const cashReq = new sql.Request(transaction);
    cashReq
      .input('invID', sql.Int, newInvID)
      .input('invType', sql.NVarChar(20), N('مصروفات'))
      .input('invDate', sql.Date, params.payoutDate)
      .input('invTime', sql.NVarChar(50), invTime)
      .input('ClientID', sql.Int, null)
      .input('ExpINID', sql.Int, expINID)
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

    const ledgerEntryId = await insertDuesSettlementAdvanceLedgerEntry(
      new sql.Request(transaction),
      {
        empId: params.empId,
        branchId: params.branchId,
        cashMoveId,
        entryDate: params.payoutDate,
        payrollMonth,
        amount,
        notes: ledgerNote,
        createdByUserId: params.createdByUserId,
      },
    );

    const newMonthlyBalance = roundMoney(previousMonthlyBalance - amount);

    await transaction.commit();

    return {
      success: true,
      cashMoveId,
      ledgerEntryId,
      payrollMonth,
      branchId: params.branchId,
      previousMonthlyBalance,
      settlementAmount: amount,
      newMonthlyBalance,
      ledgerDualWrite: true,
    };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* already rolled back */
    }

    if (
      err instanceof EmployeeLedgerDuesSettlementError
      || err instanceof EmployeeLedgerDualWriteError
    ) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    if (isMissingLedgerTableError(message)) {
      throw new EmployeeLedgerDuesSettlementError(
        'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql ثم أعد المحاولة',
      );
    }

    throw new EmployeeLedgerDuesSettlementError(`فشل صرف مستحقات الموظف: ${message}`);
  }
}

function N(value: string): string {
  return value;
}
