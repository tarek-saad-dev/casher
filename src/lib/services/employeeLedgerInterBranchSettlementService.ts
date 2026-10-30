import 'server-only';

import { getPool, sql, allocateInvID } from '@/lib/db';
import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';
import { getCairoInvTimeDotStr } from '@/lib/businessDate';
import { roundMoney } from '@/lib/reportMonthUtils';
import {
  getEmployeeBranchBalance,
  getEmployeeMonthlyBranchBalance,
  validateLedgerMonth,
} from '@/lib/services/employeeLedgerService';
import { payrollMonthFromWorkDate } from '@/lib/services/employeeLedgerDualWrite';
import {
  assertValidSettlementAmount,
  computeMaxSettlementAmount,
  findSettleablePairs,
  projectBalancesAfterSettlement,
  roundSettlementMoney,
  type BranchBalanceSnapshot,
  type SettlementPair,
} from '@/lib/hr/interBranchSettlementMath';
import { listActiveBranches } from '@/lib/branch/repository';
import { resolveLegacyBranchTenantId } from '@/platform/masterData/tenantScope';

export const EMP_LEDGER_REASON_SETTLEMENT = 'settlement' as const;
export const EMP_LEDGER_REF_TYPE_BRANCH_SETTLEMENT = 'EmpBranchSettlement' as const;

export const SETTLEMENT_CASH_EXPENSE_CAT = 'تحويل تسوية مستحقات موظف';
export const SETTLEMENT_CASH_INCOME_CAT = 'تحويل تسوية مستحقات موظف';

export type SettlementType = 'cash_transfer' | 'ledger_only';

/** Matches employeeLedgerService transaction arg (avoids sql namespace typing issues). */
type LedgerTransaction = NonNullable<Parameters<typeof getEmployeeBranchBalance>[2]>;

export class EmployeeLedgerInterBranchSettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeLedgerInterBranchSettlementError';
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildSettlementLedgerNote(args: {
  settlementId: number;
  counterpartBranchCode: string;
  direction: 'source' | 'dest';
  settlementType: SettlementType;
}): string {
  const kind =
    args.settlementType === 'cash_transfer' ? 'تحويل نقدي' : 'تسوية دفترية';
  if (args.direction === 'source') {
    return `تسوية بين الفروع #${args.settlementId} — خصم من هذا الفرع لصالح ${args.counterpartBranchCode} (${kind})`;
  }
  return `تسوية بين الفروع #${args.settlementId} — إضافة لهذا الفرع من ${args.counterpartBranchCode} (${kind})`;
}

async function ensureSettlementCashCategories(
  transaction: LedgerTransaction,
  tenantId: string,
): Promise<{ expenseExpInId: number; incomeExpInId: number }> {
  const expFind = await new sql.Request(transaction)
    .input('name', sql.NVarChar(200), SETTLEMENT_CASH_EXPENSE_CAT)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT TOP 1 ExpINID FROM dbo.TblExpINCat
      WHERE TenantId = @tenantId AND CatName = @name AND ExpINType = N'مصروفات'
    `);
  let expenseExpInId = Number(expFind.recordset[0]?.ExpINID ?? 0);
  if (!expenseExpInId) {
    const ins = await new sql.Request(transaction)
      .input('name', sql.NVarChar(200), SETTLEMENT_CASH_EXPENSE_CAT)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        INSERT INTO dbo.TblExpINCat (TenantId, CatName, ExpINType)
        OUTPUT INSERTED.ExpINID
        VALUES (@tenantId, @name, N'مصروفات')
      `);
    expenseExpInId = Number(ins.recordset[0].ExpINID);
  }

  const incFind = await new sql.Request(transaction)
    .input('name', sql.NVarChar(200), SETTLEMENT_CASH_INCOME_CAT)
    .input('tenantId', sql.UniqueIdentifier, tenantId)
    .query(`
      SELECT TOP 1 ExpINID FROM dbo.TblExpINCat
      WHERE TenantId = @tenantId AND CatName = @name AND ExpINType = N'ايرادات'
    `);
  let incomeExpInId = Number(incFind.recordset[0]?.ExpINID ?? 0);
  if (!incomeExpInId) {
    const ins = await new sql.Request(transaction)
      .input('name', sql.NVarChar(200), SETTLEMENT_CASH_INCOME_CAT)
      .input('tenantId', sql.UniqueIdentifier, tenantId)
      .query(`
        INSERT INTO dbo.TblExpINCat (TenantId, CatName, ExpINType)
        OUTPUT INSERTED.ExpINID
        VALUES (@tenantId, @name, N'ايرادات')
      `);
    incomeExpInId = Number(ins.recordset[0].ExpINID);
  }

  return { expenseExpInId, incomeExpInId };
}

/**
 * Branch nets for settlement MUST match employee-ledger month scope
 * (PayrollMonth / EntryDate month), not lifetime all-time balances.
 */
export async function loadEmployeeBranchBalanceSnapshots(
  empId: number,
  payrollMonth: string,
  transaction?: LedgerTransaction,
): Promise<BranchBalanceSnapshot[]> {
  const monthError = validateLedgerMonth(payrollMonth);
  if (monthError) {
    throw new EmployeeLedgerInterBranchSettlementError(monthError);
  }

  const branches = await listActiveBranches();
  const preferred = branches.filter(
    (b) => b.branchCode === 'GLEEM' || b.branchCode === 'CAMP_CAESAR',
  );
  const list =
    preferred.length >= 2
      ? preferred
      : branches.filter((b) => b.lifecycleStatus !== 'SETUP').slice(0, 8);

  const out: BranchBalanceSnapshot[] = [];
  for (const b of list) {
    const balance = await getEmployeeMonthlyBranchBalance(
      empId,
      b.branchId,
      payrollMonth,
      transaction,
    );
    out.push({
      branchId: b.branchId,
      branchCode: b.branchCode,
      branchName: b.branchName,
      balance,
    });
  }
  return out;
}

export async function previewInterBranchSettlement(params: {
  empId: number;
  payrollMonth: string;
  sourceBranchId?: number | null;
  destBranchId?: number | null;
}): Promise<{
  empId: number;
  empName: string;
  payrollMonth: string;
  branches: BranchBalanceSnapshot[];
  pairs: SettlementPair[];
  selected: null | {
    source: BranchBalanceSnapshot;
    dest: BranchBalanceSnapshot;
    maxAmount: number;
    suggestedAmount: number;
    projection: ReturnType<typeof projectBalancesAfterSettlement>;
  };
}> {
  if (!params.empId || params.empId <= 0) {
    throw new EmployeeLedgerInterBranchSettlementError('يجب اختيار الموظف');
  }
  const monthError = validateLedgerMonth(params.payrollMonth);
  if (monthError) {
    throw new EmployeeLedgerInterBranchSettlementError(monthError);
  }

  const db = await getPool();
  const emp = await db
    .request()
    .input('empId', sql.Int, params.empId)
    .query(`
      SELECT EmpID, EmpName FROM dbo.TblEmp
      WHERE EmpID = @empId AND ISNULL(isActive, 1) = 1
    `);
  if (!emp.recordset[0]) {
    throw new EmployeeLedgerInterBranchSettlementError('الموظف غير موجود أو غير نشط');
  }

  const branches = await loadEmployeeBranchBalanceSnapshots(
    params.empId,
    params.payrollMonth,
  );
  const pairs = findSettleablePairs(branches);

  let selected: null | {
    source: BranchBalanceSnapshot;
    dest: BranchBalanceSnapshot;
    maxAmount: number;
    suggestedAmount: number;
    projection: ReturnType<typeof projectBalancesAfterSettlement>;
  } = null;

  if (params.sourceBranchId && params.destBranchId) {
    const source = branches.find((b) => b.branchId === params.sourceBranchId);
    const dest = branches.find((b) => b.branchId === params.destBranchId);
    if (!source || !dest) {
      throw new EmployeeLedgerInterBranchSettlementError('فرع المصدر أو الوجهة غير متاح');
    }
    const maxAmount = computeMaxSettlementAmount(source.balance, dest.balance);
    selected = {
      source,
      dest,
      maxAmount,
      suggestedAmount: maxAmount,
      projection: projectBalancesAfterSettlement({
        sourceBalance: source.balance,
        destBalance: dest.balance,
        amount: maxAmount,
      }),
    };
  } else if (pairs[0]) {
    const top = pairs[0];
    selected = {
      source: top.source,
      dest: top.dest,
      maxAmount: top.maxAmount,
      suggestedAmount: top.maxAmount,
      projection: projectBalancesAfterSettlement({
        sourceBalance: top.source.balance,
        destBalance: top.dest.balance,
        amount: top.maxAmount,
      }),
    };
  }

  return {
    empId: params.empId,
    empName: String(emp.recordset[0].EmpName),
    payrollMonth: params.payrollMonth,
    branches,
    pairs,
    selected,
  };
}

export async function executeInterBranchSettlement(params: {
  empId: number;
  sourceBranchId: number;
  destBranchId: number;
  amount: number;
  settlementDate: string;
  /** Same payroll month as employee-ledger UI (YYYY-MM). */
  payrollMonth: string;
  settlementType: SettlementType;
  paymentMethodId?: number | null;
  sourceBusinessDayId: number;
  destBusinessDayId: number;
  notes?: string | null;
  idempotencyKey?: string | null;
  createdByUserId: number;
}): Promise<{
  success: true;
  settlementId: number;
  amount: number;
  settlementType: SettlementType;
  payrollMonth: string;
  sourceBranchId: number;
  destBranchId: number;
  sourceCashMoveId: number | null;
  destCashMoveId: number | null;
  sourceLedgerEntryId: number;
  destLedgerEntryId: number;
  sourceBalanceAfter: number;
  destBalanceAfter: number;
  totalBefore: number;
  totalAfter: number;
  idempotentReplay?: boolean;
}> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    throw new EmployeeLedgerInterBranchSettlementError(
      'تسوية بين الفروع تتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED=true',
    );
  }
  if (!DATE_RE.test(params.settlementDate)) {
    throw new EmployeeLedgerInterBranchSettlementError('تاريخ التسوية غير صالح');
  }
  const monthError = validateLedgerMonth(params.payrollMonth);
  if (monthError) {
    throw new EmployeeLedgerInterBranchSettlementError(monthError);
  }
  if (params.sourceBranchId === params.destBranchId) {
    throw new EmployeeLedgerInterBranchSettlementError('لا يمكن التسوية مع نفس الفرع');
  }
  if (params.settlementType === 'cash_transfer') {
    if (!params.paymentMethodId || params.paymentMethodId <= 0) {
      throw new EmployeeLedgerInterBranchSettlementError(
        'تحويل النقدية يتطلب اختيار طريقة الدفع',
      );
    }
  }

  const amount = roundSettlementMoney(params.amount);
  if (!(amount > 0)) {
    throw new EmployeeLedgerInterBranchSettlementError('مبلغ التسوية يجب أن يكون أكبر من صفر');
  }

  const db = await getPool();

  if (params.idempotencyKey) {
    const existing = await db
      .request()
      .input('key', sql.NVarChar(80), params.idempotencyKey.trim())
      .query(`
        SELECT TOP 1 SettlementID, Amount, SettlementType,
               SourceBranchID, DestBranchID,
               SourceCashMoveID, DestCashMoveID,
               SourceLedgerEntryID, DestLedgerEntryID, IsVoided
        FROM dbo.TblEmpBranchSettlement
        WHERE IdempotencyKey = @key
      `);
    const row = existing.recordset[0] as
      | {
          SettlementID: number;
          Amount: number;
          SettlementType: SettlementType;
          SourceBranchID: number;
          DestBranchID: number;
          SourceCashMoveID: number | null;
          DestCashMoveID: number | null;
          SourceLedgerEntryID: number;
          DestLedgerEntryID: number;
          IsVoided: boolean;
        }
      | undefined;
    if (row && !row.IsVoided) {
      const sourceAfter = await getEmployeeMonthlyBranchBalance(
        params.empId,
        row.SourceBranchID,
        params.payrollMonth,
      );
      const destAfter = await getEmployeeMonthlyBranchBalance(
        params.empId,
        row.DestBranchID,
        params.payrollMonth,
      );
      return {
        success: true,
        settlementId: Number(row.SettlementID),
        amount: roundMoney(Number(row.Amount)),
        settlementType: row.SettlementType,
        payrollMonth: params.payrollMonth,
        sourceBranchId: Number(row.SourceBranchID),
        destBranchId: Number(row.DestBranchID),
        sourceCashMoveId: row.SourceCashMoveID != null ? Number(row.SourceCashMoveID) : null,
        destCashMoveId: row.DestCashMoveID != null ? Number(row.DestCashMoveID) : null,
        sourceLedgerEntryId: Number(row.SourceLedgerEntryID),
        destLedgerEntryId: Number(row.DestLedgerEntryID),
        sourceBalanceAfter: sourceAfter,
        destBalanceAfter: destAfter,
        totalBefore: roundMoney(sourceAfter + destAfter),
        totalAfter: roundMoney(sourceAfter + destAfter),
        idempotentReplay: true,
      };
    }
  }

  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    const sourceBal = await getEmployeeMonthlyBranchBalance(
      params.empId,
      params.sourceBranchId,
      params.payrollMonth,
      transaction,
    );
    const destBal = await getEmployeeMonthlyBranchBalance(
      params.empId,
      params.destBranchId,
      params.payrollMonth,
      transaction,
    );
    const maxAmount = computeMaxSettlementAmount(sourceBal, destBal);
    assertValidSettlementAmount({
      amount,
      maxAmount,
      sourceBranchId: params.sourceBranchId,
      destBranchId: params.destBranchId,
    });

    const projection = projectBalancesAfterSettlement({
      sourceBalance: sourceBal,
      destBalance: destBal,
      amount,
    });

    const branches = await listActiveBranches();
    const sourceMeta = branches.find((b) => b.branchId === params.sourceBranchId);
    const destMeta = branches.find((b) => b.branchId === params.destBranchId);
    if (!sourceMeta || !destMeta) {
      throw new EmployeeLedgerInterBranchSettlementError('فرع غير موجود');
    }

    const header = await new sql.Request(transaction)
      .input('EmpID', sql.Int, params.empId)
      .input('SourceBranchID', sql.Int, params.sourceBranchId)
      .input('DestBranchID', sql.Int, params.destBranchId)
      .input('Amount', sql.Decimal(12, 2), amount)
      .input('SettlementType', sql.NVarChar(40), params.settlementType)
      .input('SettlementDate', sql.Date, params.settlementDate)
      .input('Notes', sql.NVarChar(500), params.notes?.trim() || null)
      .input('SourceBusinessDayID', sql.Int, params.sourceBusinessDayId)
      .input('DestBusinessDayID', sql.Int, params.destBusinessDayId)
      .input('IdempotencyKey', sql.NVarChar(80), params.idempotencyKey?.trim() || null)
      .input('CreatedByUserID', sql.Int, params.createdByUserId)
      .query(`
        INSERT INTO dbo.TblEmpBranchSettlement (
          EmpID, SourceBranchID, DestBranchID, Amount, SettlementType, SettlementDate,
          Notes, SourceBusinessDayID, DestBusinessDayID, IdempotencyKey, CreatedByUserID
        )
        OUTPUT INSERTED.SettlementID
        VALUES (
          @EmpID, @SourceBranchID, @DestBranchID, @Amount, @SettlementType, @SettlementDate,
          @Notes, @SourceBusinessDayID, @DestBusinessDayID, @IdempotencyKey, @CreatedByUserID
        )
      `);
    const settlementId = Number(header.recordset[0].SettlementID);

    let sourceCashMoveId: number | null = null;
    let destCashMoveId: number | null = null;

    if (params.settlementType === 'cash_transfer') {
      const tenantId = await resolveLegacyBranchTenantId(params.sourceBranchId, transaction);
      if (!tenantId) {
        throw new EmployeeLedgerInterBranchSettlementError(
          'تعذر تحديد TenantId لفئات التحويل',
        );
      }
      const cats = await ensureSettlementCashCategories(transaction, tenantId);
      const invTime = getCairoInvTimeDotStr();

      const outInv = await allocateInvID(transaction, 'TblCashMove', 'مصروفات', 5000);
      const inInv = await allocateInvID(transaction, 'TblCashMove', 'ايرادات', 5000);

      const outNotes =
        `تحويل تسوية مستحقات موظف بين الفروع #${settlementId}: خروج من ${sourceMeta.branchCode} → ${destMeta.branchCode}` +
        (params.notes?.trim() ? ` — ${params.notes.trim()}` : '');
      const inNotes =
        `تحويل تسوية مستحقات موظف بين الفروع #${settlementId}: دخول إلى ${destMeta.branchCode} من ${sourceMeta.branchCode}` +
        (params.notes?.trim() ? ` — ${params.notes.trim()}` : '');

      const outIns = await new sql.Request(transaction)
        .input('invID', sql.Int, outInv)
        .input('invType', sql.NVarChar(20), 'مصروفات')
        .input('invDate', sql.Date, params.settlementDate)
        .input('invTime', sql.NVarChar(50), invTime)
        .input('ExpINID', sql.Int, cats.expenseExpInId)
        .input('amount', sql.Decimal(12, 2), amount)
        .input('notes', sql.NVarChar(sql.MAX), outNotes)
        .input('pm', sql.Int, params.paymentMethodId!)
        .input('empId', sql.Int, params.empId)
        .input('branchId', sql.Int, params.sourceBranchId)
        .input('bd', sql.Int, params.sourceBusinessDayId)
        .query(`
          INSERT INTO dbo.TblCashMove (
            invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut,
            Notes, ShiftMoveID, PaymentMethodID, EmpID, BranchID, BusinessDayID
          )
          OUTPUT INSERTED.ID
          VALUES (
            @invID, @invType, @invDate, @invTime, NULL, @ExpINID, @amount, N'out',
            @notes, NULL, @pm, @empId, @branchId, @bd
          )
        `);
      sourceCashMoveId = Number(outIns.recordset[0].ID);

      const inIns = await new sql.Request(transaction)
        .input('invID', sql.Int, inInv)
        .input('invType', sql.NVarChar(20), 'ايرادات')
        .input('invDate', sql.Date, params.settlementDate)
        .input('invTime', sql.NVarChar(50), invTime)
        .input('ExpINID', sql.Int, cats.incomeExpInId)
        .input('amount', sql.Decimal(12, 2), amount)
        .input('notes', sql.NVarChar(sql.MAX), inNotes)
        .input('pm', sql.Int, params.paymentMethodId!)
        .input('empId', sql.Int, params.empId)
        .input('branchId', sql.Int, params.destBranchId)
        .input('bd', sql.Int, params.destBusinessDayId)
        .query(`
          INSERT INTO dbo.TblCashMove (
            invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut,
            Notes, ShiftMoveID, PaymentMethodID, EmpID, BranchID, BusinessDayID
          )
          OUTPUT INSERTED.ID
          VALUES (
            @invID, @invType, @invDate, @invTime, NULL, @ExpINID, @amount, N'in',
            @notes, NULL, @pm, @empId, @branchId, @bd
          )
        `);
      destCashMoveId = Number(inIns.recordset[0].ID);
    }

    const payrollMonth = params.payrollMonth;

    const sourceLedger = await new sql.Request(transaction)
      .input('BranchID', sql.Int, params.sourceBranchId)
      .input('EmpID', sql.Int, params.empId)
      .input('EntryDate', sql.Date, params.settlementDate)
      .input('Amount', sql.Decimal(12, 2), amount)
      .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
      .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_BRANCH_SETTLEMENT)
      .input('RefID', sql.Int, settlementId)
      .input('CashMoveID', sql.Int, sourceCashMoveId)
      .input(
        'Notes',
        sql.NVarChar(500),
        buildSettlementLedgerNote({
          settlementId,
          counterpartBranchCode: destMeta.branchCode,
          direction: 'source',
          settlementType: params.settlementType,
        }),
      )
      .input('CreatedByUserID', sql.Int, params.createdByUserId)
      .query(`
        INSERT INTO dbo.TblEmpLedgerEntry (
          BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
          PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
          Notes, IsVoided, CreatedByUserID, CreatedAt
        )
        OUTPUT INSERTED.ID
        VALUES (
          @BranchID, @EmpID, @EntryDate, N'debit', N'settlement', @Amount,
          @PayrollMonth, @RefType, @RefID, @CashMoveID, NULL,
          @Notes, 0, @CreatedByUserID, SYSDATETIME()
        )
      `);
    const sourceLedgerEntryId = Number(sourceLedger.recordset[0].ID);

    const destLedger = await new sql.Request(transaction)
      .input('BranchID', sql.Int, params.destBranchId)
      .input('EmpID', sql.Int, params.empId)
      .input('EntryDate', sql.Date, params.settlementDate)
      .input('Amount', sql.Decimal(12, 2), amount)
      .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
      .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_BRANCH_SETTLEMENT)
      .input('RefID', sql.Int, settlementId)
      .input('CashMoveID', sql.Int, destCashMoveId)
      .input(
        'Notes',
        sql.NVarChar(500),
        buildSettlementLedgerNote({
          settlementId,
          counterpartBranchCode: sourceMeta.branchCode,
          direction: 'dest',
          settlementType: params.settlementType,
        }),
      )
      .input('CreatedByUserID', sql.Int, params.createdByUserId)
      .query(`
        INSERT INTO dbo.TblEmpLedgerEntry (
          BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
          PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
          Notes, IsVoided, CreatedByUserID, CreatedAt
        )
        OUTPUT INSERTED.ID
        VALUES (
          @BranchID, @EmpID, @EntryDate, N'credit', N'settlement', @Amount,
          @PayrollMonth, @RefType, @RefID, @CashMoveID, NULL,
          @Notes, 0, @CreatedByUserID, SYSDATETIME()
        )
      `);
    const destLedgerEntryId = Number(destLedger.recordset[0].ID);

    await new sql.Request(transaction)
      .input('id', sql.BigInt, settlementId)
      .input('srcCash', sql.Int, sourceCashMoveId)
      .input('dstCash', sql.Int, destCashMoveId)
      .input('srcLed', sql.Int, sourceLedgerEntryId)
      .input('dstLed', sql.Int, destLedgerEntryId)
      .query(`
        UPDATE dbo.TblEmpBranchSettlement
        SET SourceCashMoveID = @srcCash,
            DestCashMoveID = @dstCash,
            SourceLedgerEntryID = @srcLed,
            DestLedgerEntryID = @dstLed
        WHERE SettlementID = @id
      `);

    // Post-condition: month total across the two branches unchanged
    const sourceAfter = await getEmployeeMonthlyBranchBalance(
      params.empId,
      params.sourceBranchId,
      params.payrollMonth,
      transaction,
    );
    const destAfter = await getEmployeeMonthlyBranchBalance(
      params.empId,
      params.destBranchId,
      params.payrollMonth,
      transaction,
    );
    if (roundMoney(sourceAfter + destAfter) !== projection.totalBefore) {
      throw new EmployeeLedgerInterBranchSettlementError(
        'فشل التحقق: إجمالي مستحقات الموظف تغيّر بعد التسوية',
      );
    }

    await transaction.commit();

    return {
      success: true,
      settlementId,
      amount,
      settlementType: params.settlementType,
      payrollMonth: params.payrollMonth,
      sourceBranchId: params.sourceBranchId,
      destBranchId: params.destBranchId,
      sourceCashMoveId,
      destCashMoveId,
      sourceLedgerEntryId,
      destLedgerEntryId,
      sourceBalanceAfter: sourceAfter,
      destBalanceAfter: destAfter,
      totalBefore: projection.totalBefore,
      totalAfter: roundMoney(sourceAfter + destAfter),
    };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    if (err instanceof EmployeeLedgerInterBranchSettlementError) throw err;
    if (err instanceof Error && err.message.includes('لا يمكن')) {
      throw new EmployeeLedgerInterBranchSettlementError(err.message);
    }
    if (err instanceof Error && err.message.includes('مبلغ التسوية')) {
      throw new EmployeeLedgerInterBranchSettlementError(err.message);
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('TblEmpBranchSettlement') && message.toLowerCase().includes('invalid object')) {
      throw new EmployeeLedgerInterBranchSettlementError(
        'جدول التسوية غير موجود — شغّل db/migrations/create-emp-branch-settlement.sql',
      );
    }
    // Concurrent duplicate idempotency key → load winner once (no recursion)
    if (
      params.idempotencyKey &&
      (message.includes('UX_TblEmpBranchSettlement_Idempotency') ||
        message.includes('2627') ||
        message.includes('2601'))
    ) {
      const existing = await db
        .request()
        .input('key', sql.NVarChar(80), params.idempotencyKey.trim())
        .query(`
          SELECT TOP 1 SettlementID, Amount, SettlementType,
                 SourceBranchID, DestBranchID,
                 SourceCashMoveID, DestCashMoveID,
                 SourceLedgerEntryID, DestLedgerEntryID, IsVoided
          FROM dbo.TblEmpBranchSettlement
          WHERE IdempotencyKey = @key
        `);
      const row = existing.recordset[0];
      if (row && !row.IsVoided) {
        const sourceAfter = await getEmployeeMonthlyBranchBalance(
          params.empId,
          Number(row.SourceBranchID),
          params.payrollMonth,
        );
        const destAfter = await getEmployeeMonthlyBranchBalance(
          params.empId,
          Number(row.DestBranchID),
          params.payrollMonth,
        );
        return {
          success: true,
          settlementId: Number(row.SettlementID),
          amount: roundMoney(Number(row.Amount)),
          settlementType: row.SettlementType as SettlementType,
          payrollMonth: params.payrollMonth,
          sourceBranchId: Number(row.SourceBranchID),
          destBranchId: Number(row.DestBranchID),
          sourceCashMoveId: row.SourceCashMoveID != null ? Number(row.SourceCashMoveID) : null,
          destCashMoveId: row.DestCashMoveID != null ? Number(row.DestCashMoveID) : null,
          sourceLedgerEntryId: Number(row.SourceLedgerEntryID),
          destLedgerEntryId: Number(row.DestLedgerEntryID),
          sourceBalanceAfter: sourceAfter,
          destBalanceAfter: destAfter,
          totalBefore: roundMoney(sourceAfter + destAfter),
          totalAfter: roundMoney(sourceAfter + destAfter),
          idempotentReplay: true,
        };
      }
    }
    throw new EmployeeLedgerInterBranchSettlementError(`فشل تنفيذ التسوية: ${message}`);
  }
}

export async function listInterBranchSettlements(params: {
  empId: number;
  limit?: number;
}): Promise<
  Array<{
    settlementId: number;
    empId: number;
    sourceBranchId: number;
    sourceBranchCode: string;
    destBranchId: number;
    destBranchCode: string;
    amount: number;
    settlementType: SettlementType;
    settlementDate: string;
    notes: string | null;
    sourceCashMoveId: number | null;
    destCashMoveId: number | null;
    isVoided: boolean;
    createdAt: string;
    createdByUserId: number | null;
  }>
> {
  const db = await getPool();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const result = await db
    .request()
    .input('empId', sql.Int, params.empId)
    .input('limit', sql.Int, limit)
    .query(`
      SELECT TOP (@limit)
        s.SettlementID, s.EmpID, s.SourceBranchID, sb.BranchCode AS SourceBranchCode,
        s.DestBranchID, db.BranchCode AS DestBranchCode,
        s.Amount, s.SettlementType,
        CONVERT(varchar(10), s.SettlementDate, 23) AS SettlementDate,
        s.Notes, s.SourceCashMoveID, s.DestCashMoveID, s.IsVoided,
        CONVERT(varchar(19), s.CreatedAt, 126) AS CreatedAt,
        s.CreatedByUserID
      FROM dbo.TblEmpBranchSettlement s
      INNER JOIN dbo.TblBranch sb ON sb.BranchID = s.SourceBranchID
      INNER JOIN dbo.TblBranch db ON db.BranchID = s.DestBranchID
      WHERE s.EmpID = @empId
      ORDER BY s.SettlementID DESC
    `);

  return result.recordset.map((r: Record<string, unknown>) => ({
    settlementId: Number(r.SettlementID),
    empId: Number(r.EmpID),
    sourceBranchId: Number(r.SourceBranchID),
    sourceBranchCode: String(r.SourceBranchCode),
    destBranchId: Number(r.DestBranchID),
    destBranchCode: String(r.DestBranchCode),
    amount: roundMoney(Number(r.Amount)),
    settlementType: r.SettlementType as SettlementType,
    settlementDate: String(r.SettlementDate),
    notes: r.Notes != null ? String(r.Notes) : null,
    sourceCashMoveId: r.SourceCashMoveID != null ? Number(r.SourceCashMoveID) : null,
    destCashMoveId: r.DestCashMoveID != null ? Number(r.DestCashMoveID) : null,
    isVoided: Boolean(r.IsVoided),
    createdAt: String(r.CreatedAt),
    createdByUserId: r.CreatedByUserID != null ? Number(r.CreatedByUserID) : null,
  }));
}

/**
 * Void settlement via linked reversal (new settlement + reverse ledger/cash), not hard delete.
 * Does NOT require opposite-sign balances — reverses original debit/credit directly.
 */
export async function voidInterBranchSettlement(params: {
  settlementId: number;
  voidReason: string;
  voidedByUserId: number;
  sourceBusinessDayId: number;
  destBusinessDayId: number;
  paymentMethodId?: number | null;
}): Promise<{ success: true; reversalSettlementId: number }> {
  if (!params.voidReason?.trim()) {
    throw new EmployeeLedgerInterBranchSettlementError('سبب الإلغاء مطلوب');
  }
  if (!isEmployeeLedgerDualWriteEnabled()) {
    throw new EmployeeLedgerInterBranchSettlementError(
      'تسوية بين الفروع تتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED=true',
    );
  }

  const db = await getPool();
  const found = await db
    .request()
    .input('id', sql.BigInt, params.settlementId)
    .query(`
      SELECT SettlementID, EmpID, SourceBranchID, DestBranchID, Amount, SettlementType,
             SettlementDate, IsVoided, SourceCashMoveID, DestCashMoveID
      FROM dbo.TblEmpBranchSettlement
      WHERE SettlementID = @id
    `);
  const row = found.recordset[0] as
    | {
        SettlementID: number;
        EmpID: number;
        SourceBranchID: number;
        DestBranchID: number;
        Amount: number;
        SettlementType: SettlementType;
        SettlementDate: Date | string;
        IsVoided: boolean;
        SourceCashMoveID: number | null;
        DestCashMoveID: number | null;
      }
    | undefined;
  if (!row) throw new EmployeeLedgerInterBranchSettlementError('التسوية غير موجودة');
  if (row.IsVoided) throw new EmployeeLedgerInterBranchSettlementError('التسوية ملغاة مسبقًا');

  const settlementDate =
    row.SettlementDate instanceof Date
      ? row.SettlementDate.toISOString().slice(0, 10)
      : String(row.SettlementDate).slice(0, 10);
  const amount = roundMoney(Number(row.Amount));
  const empId = Number(row.EmpID);
  const originalSourceId = Number(row.SourceBranchID);
  const originalDestId = Number(row.DestBranchID);
  const idemKey = `void:${params.settlementId}`;

  const monthFromLedger = await db
    .request()
    .input('refType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_BRANCH_SETTLEMENT)
    .input('refId', sql.Int, params.settlementId)
    .query(`
      SELECT TOP 1 PayrollMonth
      FROM dbo.TblEmpLedgerEntry
      WHERE RefType = @refType AND RefID = @refId AND IsVoided = 0
      ORDER BY ID
    `);
  const payrollMonth =
    String(monthFromLedger.recordset[0]?.PayrollMonth ?? '').trim() ||
    payrollMonthFromWorkDate(settlementDate);

  const existingRev = await db
    .request()
    .input('key', sql.NVarChar(80), idemKey)
    .query(`
      SELECT TOP 1 SettlementID FROM dbo.TblEmpBranchSettlement WHERE IdempotencyKey = @key
    `);
  if (existingRev.recordset[0]) {
    return {
      success: true,
      reversalSettlementId: Number(existingRev.recordset[0].SettlementID),
    };
  }

  let paymentMethodId = params.paymentMethodId ?? null;
  if (row.SettlementType === 'cash_transfer' && !paymentMethodId && row.SourceCashMoveID) {
    const cash = await db
      .request()
      .input('cmId', sql.Int, row.SourceCashMoveID)
      .query(`SELECT PaymentMethodID FROM dbo.TblCashMove WHERE ID = @cmId`);
    paymentMethodId =
      cash.recordset[0]?.PaymentMethodID != null
        ? Number(cash.recordset[0].PaymentMethodID)
        : null;
  }
  if (row.SettlementType === 'cash_transfer' && (!paymentMethodId || paymentMethodId <= 0)) {
    throw new EmployeeLedgerInterBranchSettlementError(
      'إلغاء التحويل النقدي يتطلب طريقة دفع',
    );
  }

  const branches = await listActiveBranches();
  const sourceMeta = branches.find((b) => b.branchId === originalSourceId);
  const destMeta = branches.find((b) => b.branchId === originalDestId);
  if (!sourceMeta || !destMeta) {
    throw new EmployeeLedgerInterBranchSettlementError('فرع غير موجود');
  }

  const transaction = new sql.Transaction(db);
  await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);

  try {
    // Reversal header: cash/ledger flow is opposite (dest → source of original)
    const header = await new sql.Request(transaction)
      .input('EmpID', sql.Int, empId)
      .input('SourceBranchID', sql.Int, originalDestId)
      .input('DestBranchID', sql.Int, originalSourceId)
      .input('Amount', sql.Decimal(12, 2), amount)
      .input('SettlementType', sql.NVarChar(40), row.SettlementType)
      .input('SettlementDate', sql.Date, settlementDate)
      .input(
        'Notes',
        sql.NVarChar(500),
        `إلغاء تسوية #${params.settlementId}: ${params.voidReason.trim()}`,
      )
      .input('SourceBusinessDayID', sql.Int, params.destBusinessDayId)
      .input('DestBusinessDayID', sql.Int, params.sourceBusinessDayId)
      .input('IdempotencyKey', sql.NVarChar(80), idemKey)
      .input('CreatedByUserID', sql.Int, params.voidedByUserId)
      .input('ReversalOf', sql.BigInt, params.settlementId)
      .query(`
        INSERT INTO dbo.TblEmpBranchSettlement (
          EmpID, SourceBranchID, DestBranchID, Amount, SettlementType, SettlementDate,
          Notes, SourceBusinessDayID, DestBusinessDayID, IdempotencyKey, CreatedByUserID,
          ReversalOfSettlementID
        )
        OUTPUT INSERTED.SettlementID
        VALUES (
          @EmpID, @SourceBranchID, @DestBranchID, @Amount, @SettlementType, @SettlementDate,
          @Notes, @SourceBusinessDayID, @DestBusinessDayID, @IdempotencyKey, @CreatedByUserID,
          @ReversalOf
        )
      `);
    const reversalSettlementId = Number(header.recordset[0].SettlementID);

    let revSourceCashMoveId: number | null = null;
    let revDestCashMoveId: number | null = null;

    if (row.SettlementType === 'cash_transfer') {
      const tenantId = await resolveLegacyBranchTenantId(originalSourceId, transaction);
      if (!tenantId) {
        throw new EmployeeLedgerInterBranchSettlementError(
          'تعذر تحديد TenantId لفئات التحويل',
        );
      }
      const cats = await ensureSettlementCashCategories(transaction, tenantId);
      const invTime = getCairoInvTimeDotStr();
      const outInv = await allocateInvID(transaction, 'TblCashMove', 'مصروفات', 5000);
      const inInv = await allocateInvID(transaction, 'TblCashMove', 'ايرادات', 5000);

      const outNotes =
        `تحويل تسوية مستحقات موظف بين الفروع #${reversalSettlementId} (إلغاء #${params.settlementId}): خروج من ${destMeta.branchCode} → ${sourceMeta.branchCode}`;
      const inNotes =
        `تحويل تسوية مستحقات موظف بين الفروع #${reversalSettlementId} (إلغاء #${params.settlementId}): دخول إلى ${sourceMeta.branchCode} من ${destMeta.branchCode}`;

      const outIns = await new sql.Request(transaction)
        .input('invID', sql.Int, outInv)
        .input('invType', sql.NVarChar(20), 'مصروفات')
        .input('invDate', sql.Date, settlementDate)
        .input('invTime', sql.NVarChar(50), invTime)
        .input('ExpINID', sql.Int, cats.expenseExpInId)
        .input('amount', sql.Decimal(12, 2), amount)
        .input('notes', sql.NVarChar(sql.MAX), outNotes)
        .input('pm', sql.Int, paymentMethodId!)
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, originalDestId)
        .input('bd', sql.Int, params.destBusinessDayId)
        .query(`
          INSERT INTO dbo.TblCashMove (
            invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut,
            Notes, ShiftMoveID, PaymentMethodID, EmpID, BranchID, BusinessDayID
          )
          OUTPUT INSERTED.ID
          VALUES (
            @invID, @invType, @invDate, @invTime, NULL, @ExpINID, @amount, N'out',
            @notes, NULL, @pm, @empId, @branchId, @bd
          )
        `);
      revSourceCashMoveId = Number(outIns.recordset[0].ID);

      const inIns = await new sql.Request(transaction)
        .input('invID', sql.Int, inInv)
        .input('invType', sql.NVarChar(20), 'ايرادات')
        .input('invDate', sql.Date, settlementDate)
        .input('invTime', sql.NVarChar(50), invTime)
        .input('ExpINID', sql.Int, cats.incomeExpInId)
        .input('amount', sql.Decimal(12, 2), amount)
        .input('notes', sql.NVarChar(sql.MAX), inNotes)
        .input('pm', sql.Int, paymentMethodId!)
        .input('empId', sql.Int, empId)
        .input('branchId', sql.Int, originalSourceId)
        .input('bd', sql.Int, params.sourceBusinessDayId)
        .query(`
          INSERT INTO dbo.TblCashMove (
            invID, invType, invDate, invTime, ClientID, ExpINID, GrandTolal, inOut,
            Notes, ShiftMoveID, PaymentMethodID, EmpID, BranchID, BusinessDayID
          )
          OUTPUT INSERTED.ID
          VALUES (
            @invID, @invType, @invDate, @invTime, NULL, @ExpINID, @amount, N'in',
            @notes, NULL, @pm, @empId, @branchId, @bd
          )
        `);
      revDestCashMoveId = Number(inIns.recordset[0].ID);
    }

    // Reverse ledger: credit original source, debit original dest (same payroll month)
    const creditOriginalSource = await new sql.Request(transaction)
      .input('BranchID', sql.Int, originalSourceId)
      .input('EmpID', sql.Int, empId)
      .input('EntryDate', sql.Date, settlementDate)
      .input('Amount', sql.Decimal(12, 2), amount)
      .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
      .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_BRANCH_SETTLEMENT)
      .input('RefID', sql.Int, reversalSettlementId)
      .input('CashMoveID', sql.Int, revDestCashMoveId)
      .input(
        'Notes',
        sql.NVarChar(500),
        `إلغاء تسوية بين الفروع #${params.settlementId} — إعادة رصيد ${sourceMeta.branchCode}`,
      )
      .input('CreatedByUserID', sql.Int, params.voidedByUserId)
      .query(`
        INSERT INTO dbo.TblEmpLedgerEntry (
          BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
          PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
          Notes, IsVoided, CreatedByUserID, CreatedAt
        )
        OUTPUT INSERTED.ID
        VALUES (
          @BranchID, @EmpID, @EntryDate, N'credit', N'settlement', @Amount,
          @PayrollMonth, @RefType, @RefID, @CashMoveID, NULL,
          @Notes, 0, @CreatedByUserID, SYSDATETIME()
        )
      `);

    const debitOriginalDest = await new sql.Request(transaction)
      .input('BranchID', sql.Int, originalDestId)
      .input('EmpID', sql.Int, empId)
      .input('EntryDate', sql.Date, settlementDate)
      .input('Amount', sql.Decimal(12, 2), amount)
      .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
      .input('RefType', sql.NVarChar(80), EMP_LEDGER_REF_TYPE_BRANCH_SETTLEMENT)
      .input('RefID', sql.Int, reversalSettlementId)
      .input('CashMoveID', sql.Int, revSourceCashMoveId)
      .input(
        'Notes',
        sql.NVarChar(500),
        `إلغاء تسوية بين الفروع #${params.settlementId} — خصم من ${destMeta.branchCode}`,
      )
      .input('CreatedByUserID', sql.Int, params.voidedByUserId)
      .query(`
        INSERT INTO dbo.TblEmpLedgerEntry (
          BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
          PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
          Notes, IsVoided, CreatedByUserID, CreatedAt
        )
        OUTPUT INSERTED.ID
        VALUES (
          @BranchID, @EmpID, @EntryDate, N'debit', N'settlement', @Amount,
          @PayrollMonth, @RefType, @RefID, @CashMoveID, NULL,
          @Notes, 0, @CreatedByUserID, SYSDATETIME()
        )
      `);

    await new sql.Request(transaction)
      .input('id', sql.BigInt, reversalSettlementId)
      .input('srcCash', sql.Int, revSourceCashMoveId)
      .input('dstCash', sql.Int, revDestCashMoveId)
      .input('srcLed', sql.Int, Number(debitOriginalDest.recordset[0].ID))
      .input('dstLed', sql.Int, Number(creditOriginalSource.recordset[0].ID))
      .query(`
        UPDATE dbo.TblEmpBranchSettlement
        SET SourceCashMoveID = @srcCash,
            DestCashMoveID = @dstCash,
            SourceLedgerEntryID = @srcLed,
            DestLedgerEntryID = @dstLed
        WHERE SettlementID = @id
      `);

    await new sql.Request(transaction)
      .input('id', sql.BigInt, params.settlementId)
      .input('reason', sql.NVarChar(500), params.voidReason.trim())
      .input('userId', sql.Int, params.voidedByUserId)
      .input('rev', sql.BigInt, reversalSettlementId)
      .query(`
        UPDATE dbo.TblEmpBranchSettlement
        SET IsVoided = 1,
            VoidReason = @reason,
            VoidedAt = SYSDATETIME(),
            VoidedByUserID = @userId,
            ReversalOfSettlementID = @rev
        WHERE SettlementID = @id AND IsVoided = 0
      `);

    await transaction.commit();
    return { success: true, reversalSettlementId };
  } catch (err) {
    try {
      await transaction.rollback();
    } catch {
      /* ignore */
    }
    if (err instanceof EmployeeLedgerInterBranchSettlementError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new EmployeeLedgerInterBranchSettlementError(`فشل إلغاء التسوية: ${message}`);
  }
}
