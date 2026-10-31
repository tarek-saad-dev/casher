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
import type { EmpLedgerAdvanceRepaymentResponse } from '@/lib/types/employee-ledger';
import { getCairoInvTimeDotStr } from '@/lib/businessDate';
import { ensureTenantFinanceCategory } from '@/platform/masterData/financeCategories';
import { resolveLegacyBranchTenantId } from '@/platform/masterData/tenantScope';

/** Income category — treasury recovery, not sales (audit maps «رد سلف» → non_revenue_cash_in). */
export const ADVANCE_REPAYMENT_CATEGORY_NAME = 'رد سلفة';
export const EMP_LEDGER_REASON_ADVANCE_REPAYMENT = 'advance_repayment';
export const ADVANCE_REPAYMENT_LEDGER_NOTE = 'رد سلفة موظف للخزنة';
export const ADVANCE_REPAYMENT_IDEMPOTENCY_PREFIX = '[adv-repay-id:';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IDEMPOTENCY_KEY_RE = /^[\w-]{8,80}$/;

export class EmployeeLedgerAdvanceRepaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeLedgerAdvanceRepaymentError';
  }
}

function buildCashMoveNotes(
  employeeName: string,
  notes?: string | null,
  idempotencyKey?: string | null,
): string {
  const base = `رد سلفة: ${employeeName}`;
  const extra = notes?.trim();
  let text = extra ? `${base} — ${extra}` : base;
  const key = idempotencyKey?.trim();
  if (key && IDEMPOTENCY_KEY_RE.test(key)) {
    text = `${text} ${ADVANCE_REPAYMENT_IDEMPOTENCY_PREFIX}${key}]`;
  }
  return text;
}

function buildLedgerNotes(notes?: string | null): string {
  const extra = notes?.trim();
  return extra ? `${ADVANCE_REPAYMENT_LEDGER_NOTE} — ${extra}` : ADVANCE_REPAYMENT_LEDGER_NOTE;
}

export async function ensureAdvanceRepaymentIncomeCategory(
  transaction: sql.Transaction,
  tenantId: string,
): Promise<number> {
  return ensureTenantFinanceCategory(
    transaction,
    tenantId,
    ADVANCE_REPAYMENT_CATEGORY_NAME,
    'ايرادات',
  );
}

async function findExistingByIdempotencyKey(
  transaction: sql.Transaction,
  params: { empId: number; branchId: number; idempotencyKey: string },
): Promise<{ cashMoveId: number; ledgerEntryId: number; amount: number } | null> {
  const marker = `${ADVANCE_REPAYMENT_IDEMPOTENCY_PREFIX}${params.idempotencyKey}]`;
  const result = await new sql.Request(transaction)
    .input('empId', sql.Int, params.empId)
    .input('branchId', sql.Int, params.branchId)
    .input('marker', sql.NVarChar(200), marker)
    .input('entryReason', sql.NVarChar(40), EMP_LEDGER_REASON_ADVANCE_REPAYMENT)
    .query(`
      SELECT TOP 1
        l.ID AS LedgerEntryID,
        c.ID AS CashMoveID,
        CAST(l.Amount AS decimal(12,2)) AS Amount
      FROM dbo.TblCashMove c
      INNER JOIN dbo.TblEmpLedgerEntry l
        ON l.CashMoveID = c.ID
       AND l.EmpID = c.EmpID
       AND l.BranchID = c.BranchID
      WHERE c.EmpID = @empId
        AND c.BranchID = @branchId
        AND l.EntryReason = @entryReason
        AND l.IsVoided = 0
        AND CHARINDEX(@marker, c.Notes) > 0
      ORDER BY l.ID DESC
    `);

  if (result.recordset.length === 0) return null;
  const row = result.recordset[0];
  return {
    cashMoveId: Number(row.CashMoveID),
    ledgerEntryId: Number(row.LedgerEntryID),
    amount: roundMoney(Number(row.Amount)),
  };
}

export async function insertAdvanceRepaymentLedgerEntry(
  request: sql.Request,
  params: {
    empId: number;
    branchId: number;
    cashMoveId: number;
    entryDate: string;
    amount: number;
    notes?: string | null;
    createdByUserId?: number | null;
  },
): Promise<number> {
  const payrollMonth = payrollMonthFromWorkDate(params.entryDate);

  const insertResult = await request
    .input('BranchID', sql.Int, params.branchId)
    .input('EmpID', sql.Int, params.empId)
    .input('EntryDate', sql.Date, params.entryDate)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_ADVANCE_REPAYMENT)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_CASH_MOVE)
    .input('RefID', sql.Int, params.cashMoveId)
    .input('CashMoveID', sql.Int, params.cashMoveId)
    .input('Notes', sql.NVarChar(500), buildLedgerNotes(params.notes))
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

/**
 * Employee pays back an outstanding advance: Cash IN + ledger credit (advance_repayment).
 * Caps amount at −min(0, branch all-time balance) so prior months / settlements are respected.
 */
export async function executeAdvanceRepayment(params: {
  empId: number;
  amount: number;
  paymentMethodId: number;
  date: string;
  notes?: string | null;
  createdByUserId?: number | null;
  branchId: number;
  businessDayId: number | null;
  idempotencyKey?: string | null;
}): Promise<EmpLedgerAdvanceRepaymentResponse> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    throw new EmployeeLedgerAdvanceRepaymentError(
      'ميزة رد السلفة تتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED=true',
    );
  }

  if (!params.empId || params.empId <= 0) {
    throw new EmployeeLedgerAdvanceRepaymentError('يجب اختيار الموظف');
  }
  if (!params.amount || params.amount <= 0) {
    throw new EmployeeLedgerAdvanceRepaymentError('يجب إدخال مبلغ صحيح أكبر من صفر');
  }
  if (!params.paymentMethodId || params.paymentMethodId <= 0) {
    throw new EmployeeLedgerAdvanceRepaymentError('يجب اختيار طريقة الدفع');
  }
  if (!DATE_RE.test(params.date)) {
    throw new EmployeeLedgerAdvanceRepaymentError('date يجب أن يكون بصيغة YYYY-MM-DD');
  }
  if (
    params.idempotencyKey != null &&
    params.idempotencyKey.trim() !== '' &&
    !IDEMPOTENCY_KEY_RE.test(params.idempotencyKey.trim())
  ) {
    throw new EmployeeLedgerAdvanceRepaymentError('مفتاح منع التكرار غير صالح');
  }

  const amount = roundMoney(params.amount);
  const db = await getPool();
  const tenantId = await resolveLegacyBranchTenantId(params.branchId);

  const empResult = await db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT EmpID, EmpName
      FROM dbo.TblEmp
      WHERE EmpID = @empId AND TenantId = @tenantId AND ISNULL(isActive, 1) = 1
    `);
  if (empResult.recordset.length === 0) {
    throw new EmployeeLedgerAdvanceRepaymentError('الموظف غير موجود أو غير نشط');
  }
  const employeeName = String(empResult.recordset[0].EmpName);

  const pmResult = await db
    .request()
    .input('paymentMethodId', sql.Int, params.paymentMethodId)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT PaymentID
      FROM dbo.TblPaymentMethods
      WHERE PaymentID = @paymentMethodId AND TenantId = @tenantId
    `);
  if (pmResult.recordset.length === 0) {
    throw new EmployeeLedgerAdvanceRepaymentError('طريقة الدفع غير موجودة');
  }

  const invTime = getCairoInvTimeDotStr();
  const cashNotes = buildCashMoveNotes(employeeName, params.notes, params.idempotencyKey);

  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const idemKey = params.idempotencyKey?.trim() || null;
    if (idemKey) {
      const existing = await findExistingByIdempotencyKey(transaction, {
        empId: params.empId,
        branchId: params.branchId,
        idempotencyKey: idemKey,
      });
      if (existing) {
        const bal = await getEmployeeBranchBalance(
          params.empId,
          params.branchId,
          transaction,
        );
        await transaction.commit();
        return {
          success: true,
          cashMoveId: existing.cashMoveId,
          ledgerEntryId: existing.ledgerEntryId,
          employeeName,
          amount: existing.amount,
          previousBalance: roundMoney(bal - existing.amount),
          newBalance: bal,
          outstandingDebtBefore: roundMoney(Math.max(0, -(bal - existing.amount))),
          outstandingDebtAfter: roundMoney(Math.max(0, -bal)),
          ledgerDualWrite: true,
          idempotentReplay: true,
        };
      }
    }

    const previousBalance = await getEmployeeBranchBalance(
      params.empId,
      params.branchId,
      transaction,
    );
    const outstandingDebt = roundMoney(Math.max(0, -previousBalance));
    if (outstandingDebt <= 0) {
      throw new EmployeeLedgerAdvanceRepaymentError(
        'لا توجد مديونية سلفة على هذا الفرع للسداد',
      );
    }
    if (amount > outstandingDebt) {
      throw new EmployeeLedgerAdvanceRepaymentError(
        `المبلغ أكبر من المديونية (${outstandingDebt.toFixed(2)} ج.م)`,
      );
    }

    const expInId = await ensureAdvanceRepaymentIncomeCategory(transaction, tenantId);
    const newInvID = await allocateInvID(transaction, 'TblCashMove', 'ايرادات', 5000);

    const cashInsert = await new sql.Request(transaction)
      .input('invID', sql.Int, newInvID)
      .input('invType', sql.NVarChar(20), 'ايرادات')
      .input('invDate', sql.Date, params.date)
      .input('invTime', sql.NVarChar(50), invTime)
      .input('ClientID', sql.Int, null)
      .input('ExpINID', sql.Int, expInId)
      .input('GrandTolal', sql.Decimal(10, 2), amount)
      .input('inOut', sql.NVarChar(5), 'in')
      .input('Notes', sql.NVarChar(sql.MAX), cashNotes)
      .input('ShiftMoveID', sql.Int, null)
      .input('PaymentMethodID', sql.Int, params.paymentMethodId)
      .input('EmpID', sql.Int, params.empId)
      .input('BranchID', sql.Int, params.branchId)
      .input('BusinessDayID', sql.Int, params.businessDayId)
      .query(`
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

    const ledgerEntryId = await insertAdvanceRepaymentLedgerEntry(
      new sql.Request(transaction),
      {
        empId: params.empId,
        branchId: params.branchId,
        cashMoveId,
        entryDate: params.date,
        amount,
        notes: params.notes,
        createdByUserId: params.createdByUserId,
      },
    );

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
      outstandingDebtBefore: outstandingDebt,
      outstandingDebtAfter: roundMoney(Math.max(0, -newBalance)),
      ledgerDualWrite: true,
    };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* already rolled back */
    }

    if (
      err instanceof EmployeeLedgerAdvanceRepaymentError ||
      err instanceof EmployeeLedgerDualWriteError
    ) {
      throw err;
    }

    const message = err instanceof Error ? err.message : String(err);
    if (isMissingLedgerTableError(message)) {
      throw new EmployeeLedgerAdvanceRepaymentError(
        'جدول دفتر الموظفين غير موجود — شغّل ترحيل الدفتر ثم أعد المحاولة',
      );
    }

    throw new EmployeeLedgerAdvanceRepaymentError(`فشل تسجيل رد السلفة: ${message}`);
  }
}

/**
 * Void an advance repayment: void ledger credit + reverse Cash OUT (same category).
 */
export async function voidAdvanceRepayment(params: {
  ledgerEntryId: number;
  reason: string;
  createdByUserId?: number | null;
  businessDayId: number | null;
  branchId: number;
}): Promise<{ success: true; reverseCashMoveId: number }> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    throw new EmployeeLedgerAdvanceRepaymentError(
      'ميزة رد السلفة تتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED=true',
    );
  }
  const reason = params.reason.trim();
  if (!reason) {
    throw new EmployeeLedgerAdvanceRepaymentError('سبب الإلغاء مطلوب');
  }

  const db = await getPool();
  const tenantId = await resolveLegacyBranchTenantId(params.branchId);
  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const led = await new sql.Request(transaction)
      .input('id', sql.Int, params.ledgerEntryId)
      .input('reason', sql.NVarChar(40), EMP_LEDGER_REASON_ADVANCE_REPAYMENT)
      .query(`
        SELECT ID, EmpID, BranchID, CashMoveID, CAST(Amount AS decimal(12,2)) AS Amount,
               IsVoided, EntryDate
        FROM dbo.TblEmpLedgerEntry WITH (UPDLOCK, HOLDLOCK)
        WHERE ID = @id AND EntryReason = @reason
      `);
    const row = led.recordset[0] as
      | {
          ID: number;
          EmpID: number;
          BranchID: number;
          CashMoveID: number | null;
          Amount: number;
          IsVoided: boolean;
          EntryDate: Date;
        }
      | undefined;
    if (!row) {
      throw new EmployeeLedgerAdvanceRepaymentError('قيد رد السلفة غير موجود');
    }
    if (Number(row.BranchID) !== params.branchId) {
      throw new EmployeeLedgerAdvanceRepaymentError('الفرع لا يطابق قيد رد السلفة');
    }
    if (row.IsVoided) {
      throw new EmployeeLedgerAdvanceRepaymentError('القيد ملغى مسبقًا');
    }

    const amount = roundMoney(Number(row.Amount));
    const empId = Number(row.EmpID);
    const cashMoveId = row.CashMoveID != null ? Number(row.CashMoveID) : null;

    await new sql.Request(transaction)
      .input('id', sql.Int, params.ledgerEntryId)
      .input('voidReason', sql.NVarChar(400), reason)
      .query(`
        UPDATE dbo.TblEmpLedgerEntry
        SET IsVoided = 1, VoidReason = @voidReason, UpdatedAt = SYSDATETIME()
        WHERE ID = @id AND IsVoided = 0
      `);

    const expInId = await ensureAdvanceRepaymentIncomeCategory(transaction, tenantId);
    // Reverse treasury: same category, cash-out (not sales / not operating expense).
    const newInvID = await allocateInvID(transaction, 'TblCashMove', 'ايرادات', 5000);
    const invTime = getCairoInvTimeDotStr();
    const entryDate =
      row.EntryDate instanceof Date
        ? row.EntryDate.toISOString().slice(0, 10)
        : String(row.EntryDate).slice(0, 10);

    const reverseNotes = `عكس رد سلفة — إلغاء قيد #${params.ledgerEntryId}${
      cashMoveId ? ` / CashMove#${cashMoveId}` : ''
    }: ${reason}`;

    const cashInsert = await new sql.Request(transaction)
      .input('invID', sql.Int, newInvID)
      .input('invType', sql.NVarChar(20), 'ايرادات')
      .input('invDate', sql.Date, entryDate)
      .input('invTime', sql.NVarChar(50), invTime)
      .input('ClientID', sql.Int, null)
      .input('ExpINID', sql.Int, expInId)
      .input('GrandTolal', sql.Decimal(10, 2), amount)
      .input('inOut', sql.NVarChar(5), 'out')
      .input('Notes', sql.NVarChar(sql.MAX), reverseNotes)
      .input('ShiftMoveID', sql.Int, null)
      .input('PaymentMethodID', sql.Int, null)
      .input('EmpID', sql.Int, empId)
      .input('BranchID', sql.Int, params.branchId)
      .input('BusinessDayID', sql.Int, params.businessDayId)
      .query(`
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

    await transaction.commit();
    return { success: true, reverseCashMoveId: Number(cashInsert.recordset[0].ID) };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    if (err instanceof EmployeeLedgerAdvanceRepaymentError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new EmployeeLedgerAdvanceRepaymentError(`فشل إلغاء رد السلفة: ${message}`);
  }
}
