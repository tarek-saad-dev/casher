import 'server-only';

import { getPool, sql } from '@/lib/db';
import {
  EMP_LEDGER_REASON_ADVANCE,
  EMP_LEDGER_REASON_HOURLY_WAGE,
  EMP_LEDGER_REF_TYPE_CASH_MOVE,
  EMP_LEDGER_REF_TYPE_DAILY_PAYROLL,
  EmployeeLedgerDualWriteError,
  isMissingLedgerTableError,
  payrollMonthFromWorkDate,
} from '@/lib/services/employeeLedgerDualWrite';
import { validateLedgerMonth } from '@/lib/services/employeeLedgerService';
import type {
  EmployeeLedgerSyncCounts,
  EmployeeLedgerSyncPreviewRow,
  EmployeeLedgerSyncResponse,
} from '@/lib/types/employee-ledger-sync';

const PAYROLL_SYNC_NOTE = 'مزامنة استحقاق يومية من البيانات السابقة';
const ADVANCE_SYNC_NOTE = 'مزامنة سلفة موظف من حركات الخزنة السابقة';

type ExistingLedgerRow = {
  id: number;
  empId: number;
  entryDate: string;
  amount: number;
  payrollMonth: string | null;
  attendanceId: number | null;
  cashMoveId: number | null;
  notes: string | null;
  isVoided: boolean;
};

type PayrollSourceRow = {
  payrollId: number;
  empId: number;
  branchId: number;
  empName: string | null;
  workDate: string;
  attendanceId: number | null;
  dailyWage: number;
};

type AdvanceSourceRow = {
  cashMoveId: number;
  empId: number;
  branchId: number;
  empName: string | null;
  invDate: string;
  amount: number;
};

function newCounts(): EmployeeLedgerSyncCounts {
  return {
    payrollCreditsToInsert: 0,
    payrollCreditsToUpdate: 0,
    payrollCreditsToVoid: 0,
    advanceDebitsToInsert: 0,
    advanceDebitsToUpdate: 0,
    skipped: 0,
    errors: 0,
  };
}

function fmtDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function sameNullable(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

export async function runEmployeeLedgerHistoricalSync(params: {
  month: string;
  empId?: number | null;
  dryRun?: boolean;
  syncPayrollCredits?: boolean;
  syncAdvanceDebits?: boolean;
  createdByUserId?: number | null;
}): Promise<EmployeeLedgerSyncResponse> {
  const monthError = validateLedgerMonth(params.month);
  if (monthError) {
    throw new Error(monthError);
  }

  const dryRun = params.dryRun !== false;
  const syncPayrollCredits = params.syncPayrollCredits !== false;
  const syncAdvanceDebits = params.syncAdvanceDebits !== false;
  const empId = params.empId && params.empId > 0 ? params.empId : null;

  const [yearStr, monthStr] = params.month.split('-');
  const monthStart = `${params.month}-01`;
  const lastDay = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10), 0).getDate();
  const monthEnd = `${params.month}-${String(lastDay).padStart(2, '0')}`;

  const db = await getPool();
  const counts = newCounts();
  const previewRows: EmployeeLedgerSyncPreviewRow[] = [];
  const errors: string[] = [];

  const transaction = new sql.Transaction(db);
  if (!dryRun) {
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
  }

  const reqBase = () => (dryRun ? db.request() : new sql.Request(transaction));

  try {
    if (syncPayrollCredits) {
      const payrollRows = await fetchPayrollRows(reqBase(), monthStart, monthEnd, empId);
      const existing = await fetchExistingByRef(
        reqBase(),
        EMP_LEDGER_REF_TYPE_DAILY_PAYROLL,
        EMP_LEDGER_REASON_HOURLY_WAGE,
        payrollRows.map((r) => r.payrollId),
      );

      for (const row of payrollRows) {
        const ex = existing.get(row.payrollId);
        const payrollMonth = payrollMonthFromWorkDate(row.workDate);

        if (row.dailyWage <= 0) {
          if (ex && !ex.isVoided) {
            counts.payrollCreditsToVoid++;
            previewRows.push({
              source: 'payroll',
              refId: row.payrollId,
              empId: row.empId,
              empName: row.empName,
              entryDate: row.workDate,
              amount: row.dailyWage,
              action: 'void',
              reason: 'daily_wage_non_positive',
            });
            if (!dryRun) {
              await voidActiveEntry(reqBase(), EMP_LEDGER_REF_TYPE_DAILY_PAYROLL, row.payrollId, EMP_LEDGER_REASON_HOURLY_WAGE);
            }
          } else {
            counts.skipped++;
          }
          continue;
        }

        if (!ex) {
          counts.payrollCreditsToInsert++;
          previewRows.push({
            source: 'payroll',
            refId: row.payrollId,
            empId: row.empId,
            empName: row.empName,
            entryDate: row.workDate,
            amount: row.dailyWage,
            action: 'insert',
            reason: 'missing_active_entry',
          });
          if (!dryRun) {
            await insertPayrollCredit(reqBase(), row, payrollMonth, params.createdByUserId ?? null);
          }
          continue;
        }

        const changed =
          ex.empId !== row.empId ||
          ex.entryDate !== row.workDate ||
          Number(ex.amount) !== Number(row.dailyWage) ||
          ex.payrollMonth !== payrollMonth ||
          !sameNullable(ex.attendanceId, row.attendanceId) ||
          ex.notes !== PAYROLL_SYNC_NOTE;

        if (!changed) {
          counts.skipped++;
          continue;
        }

        counts.payrollCreditsToUpdate++;
        previewRows.push({
          source: 'payroll',
          refId: row.payrollId,
          empId: row.empId,
          empName: row.empName,
          entryDate: row.workDate,
          amount: row.dailyWage,
          action: 'update',
          reason: 'value_diff',
        });
        if (!dryRun) {
          await updatePayrollCredit(reqBase(), row, payrollMonth, params.createdByUserId ?? null);
        }
      }
    }

    if (syncAdvanceDebits) {
      const advanceRows = await fetchAdvanceRows(reqBase(), monthStart, monthEnd, empId);
      const existing = await fetchExistingByRef(
        reqBase(),
        EMP_LEDGER_REF_TYPE_CASH_MOVE,
        EMP_LEDGER_REASON_ADVANCE,
        advanceRows.map((r) => r.cashMoveId),
      );

      for (const row of advanceRows) {
        if (row.amount <= 0) {
          counts.skipped++;
          continue;
        }

        const payrollMonth = payrollMonthFromWorkDate(row.invDate);
        const ex = existing.get(row.cashMoveId);
        if (!ex) {
          counts.advanceDebitsToInsert++;
          previewRows.push({
            source: 'advance',
            refId: row.cashMoveId,
            empId: row.empId,
            empName: row.empName,
            entryDate: row.invDate,
            amount: row.amount,
            action: 'insert',
            reason: 'missing_active_entry',
          });
          if (!dryRun) {
            await insertAdvanceDebit(reqBase(), row, payrollMonth, params.createdByUserId ?? null);
          }
          continue;
        }

        const changed =
          ex.empId !== row.empId ||
          ex.entryDate !== row.invDate ||
          Number(ex.amount) !== Number(row.amount) ||
          ex.payrollMonth !== payrollMonth ||
          !sameNullable(ex.cashMoveId, row.cashMoveId) ||
          ex.notes !== ADVANCE_SYNC_NOTE;

        if (!changed) {
          counts.skipped++;
          continue;
        }

        counts.advanceDebitsToUpdate++;
        previewRows.push({
          source: 'advance',
          refId: row.cashMoveId,
          empId: row.empId,
          empName: row.empName,
          entryDate: row.invDate,
          amount: row.amount,
          action: 'update',
          reason: 'value_diff',
        });
        if (!dryRun) {
          await updateAdvanceDebit(reqBase(), row, payrollMonth, params.createdByUserId ?? null);
        }
      }
    }

    if (!dryRun) {
      await transaction.commit();
    }
  } catch (error) {
    if (!dryRun) {
      try {
        await transaction.rollback();
      } catch {
        // ignore
      }
    }

    const message = error instanceof Error ? error.message : String(error);
    counts.errors++;
    errors.push(message);
    if (isMissingLedgerTableError(message)) {
      throw new EmployeeLedgerDualWriteError(
        'جدول دفتر الموظفين غير موجود — شغّل db/migrations/create-tbl-emp-ledger-entry.sql ثم أعد المحاولة',
      );
    }
    throw error;
  }

  return {
    success: true,
    dryRun,
    month: params.month,
    empId,
    syncPayrollCredits,
    syncAdvanceDebits,
    counts,
    previewRows,
    errors,
  };
}

async function fetchPayrollRows(
  req: sql.Request,
  monthStart: string,
  monthEnd: string,
  empId: number | null,
): Promise<PayrollSourceRow[]> {
  req.input('monthStart', sql.Date, monthStart).input('monthEnd', sql.Date, monthEnd);
  if (empId) req.input('empId', sql.Int, empId);
  const whereEmp = empId ? 'AND p.EmpID = @empId' : '';
  const result = await req.query(`
    SELECT p.ID AS payrollId, p.EmpID AS empId, p.BranchID AS branchId, e.EmpName AS empName, p.WorkDate AS workDate,
           p.AttendanceID AS attendanceId, p.DailyWage AS dailyWage
    FROM dbo.TblEmpDailyPayroll p
    INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    WHERE p.WorkDate >= @monthStart
      AND p.WorkDate <= @monthEnd
      AND p.Status = N'Generated'
      ${whereEmp}
  `);
  return result.recordset.map((r: Record<string, unknown>) => ({
    payrollId: Number(r.payrollId),
    empId: Number(r.empId),
    branchId: Number(r.branchId),
    empName: r.empName != null ? String(r.empName) : null,
    workDate: fmtDate(r.workDate),
    attendanceId: r.attendanceId != null ? Number(r.attendanceId) : null,
    dailyWage: Number(r.dailyWage ?? 0),
  }));
}

async function fetchAdvanceRows(
  req: sql.Request,
  monthStart: string,
  monthEnd: string,
  empId: number | null,
): Promise<AdvanceSourceRow[]> {
  req.input('monthStart', sql.Date, monthStart).input('monthEnd', sql.Date, monthEnd);
  if (empId) req.input('empId', sql.Int, empId);
  const whereEmp = empId ? 'AND m.EmpID = @empId' : '';
  const result = await req.query(`
    SELECT cm.ID AS cashMoveId, m.EmpID AS empId, cm.BranchID AS branchId, e.EmpName AS empName,
           cm.invDate AS invDate, cm.GrandTolal AS amount
    FROM dbo.TblCashMove cm
    INNER JOIN dbo.TblExpCatEmpMap m
      ON m.ExpINID = cm.ExpINID
     AND m.TxnKind = N'advance'
     AND m.IsActive = 1
    INNER JOIN dbo.TblEmp e ON e.EmpID = m.EmpID
    WHERE cm.invType = N'مصروفات'
      AND cm.inOut = N'out'
      AND cm.invDate >= @monthStart
      AND cm.invDate <= @monthEnd
      AND cm.GrandTolal > 0
      ${whereEmp}
  `);
  return result.recordset.map((r: Record<string, unknown>) => ({
    cashMoveId: Number(r.cashMoveId),
    empId: Number(r.empId),
    branchId: Number(r.branchId),
    empName: r.empName != null ? String(r.empName) : null,
    invDate: fmtDate(r.invDate),
    amount: Number(r.amount ?? 0),
  }));
}

async function fetchExistingByRef(
  req: sql.Request,
  refType: string,
  entryReason: string,
  refIds: number[],
): Promise<Map<number, ExistingLedgerRow>> {
  const map = new Map<number, ExistingLedgerRow>();
  if (refIds.length === 0) return map;
  const inList = refIds.join(',');
  req.input('refType', sql.NVarChar(80), refType).input('entryReason', sql.NVarChar(40), entryReason);
  const result = await req.query(`
    SELECT ID, EmpID, EntryDate, Amount, PayrollMonth, AttendanceID, CashMoveID, Notes, IsVoided, RefID
    FROM dbo.TblEmpLedgerEntry
    WHERE RefType = @refType
      AND EntryReason = @entryReason
      AND RefID IN (${inList})
      AND IsVoided = 0
  `);
  for (const r of result.recordset as Array<Record<string, unknown>>) {
    map.set(Number(r.RefID), {
      id: Number(r.ID),
      empId: Number(r.EmpID),
      entryDate: fmtDate(r.EntryDate),
      amount: Number(r.Amount ?? 0),
      payrollMonth: r.PayrollMonth != null ? String(r.PayrollMonth) : null,
      attendanceId: r.AttendanceID != null ? Number(r.AttendanceID) : null,
      cashMoveId: r.CashMoveID != null ? Number(r.CashMoveID) : null,
      notes: r.Notes != null ? String(r.Notes) : null,
      isVoided: Boolean(r.IsVoided),
    });
  }
  return map;
}

async function voidActiveEntry(req: sql.Request, refType: string, refId: number, reason: string): Promise<void> {
  await req
    .input('RefType', sql.NVarChar(80), refType)
    .input('RefID', sql.Int, refId)
    .input('EntryReason', sql.NVarChar(40), reason)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET IsVoided = 1,
          VoidReason = N'مزامنة: قيمة غير موجبة',
          UpdatedAt = SYSDATETIME()
      WHERE RefType = @RefType AND RefID = @RefID AND EntryReason = @EntryReason AND IsVoided = 0
    `);
}

async function insertPayrollCredit(req: sql.Request, row: PayrollSourceRow, payrollMonth: string, createdByUserId: number | null) {
  await req
    .input('BranchID', sql.Int, row.branchId)
    .input('EmpID', sql.Int, row.empId)
    .input('EntryDate', sql.Date, row.workDate)
    .input('Amount', sql.Decimal(12, 2), row.dailyWage)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('AttendanceID', sql.Int, row.attendanceId)
    .input('RefID', sql.Int, row.payrollId)
    .input('CreatedByUserID', sql.Int, createdByUserId)
    .query(`
      INSERT INTO dbo.TblEmpLedgerEntry (
        BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount, PayrollMonth,
        RefType, RefID, CashMoveID, AttendanceID, Notes, IsVoided, CreatedByUserID, CreatedAt
      )
      VALUES (
        @BranchID, @EmpID, @EntryDate, N'credit', N'hourly_wage', @Amount, @PayrollMonth,
        N'TblEmpDailyPayroll', @RefID, NULL, @AttendanceID, N'${PAYROLL_SYNC_NOTE}', 0, @CreatedByUserID, SYSDATETIME()
      )
    `);
}

async function updatePayrollCredit(req: sql.Request, row: PayrollSourceRow, payrollMonth: string, createdByUserId: number | null) {
  await req
    .input('EmpID', sql.Int, row.empId)
    .input('EntryDate', sql.Date, row.workDate)
    .input('Amount', sql.Decimal(12, 2), row.dailyWage)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('AttendanceID', sql.Int, row.attendanceId)
    .input('RefID', sql.Int, row.payrollId)
    .input('CreatedByUserID', sql.Int, createdByUserId)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET EmpID=@EmpID, EntryDate=@EntryDate, Amount=@Amount, PayrollMonth=@PayrollMonth,
          AttendanceID=@AttendanceID, Notes=N'${PAYROLL_SYNC_NOTE}',
          CreatedByUserID=COALESCE(@CreatedByUserID, CreatedByUserID),
          UpdatedAt=SYSDATETIME()
      WHERE RefType=N'TblEmpDailyPayroll' AND RefID=@RefID AND EntryReason=N'hourly_wage' AND IsVoided=0
    `);
}

async function insertAdvanceDebit(req: sql.Request, row: AdvanceSourceRow, payrollMonth: string, createdByUserId: number | null) {
  await req
    .input('BranchID', sql.Int, row.branchId)
    .input('EmpID', sql.Int, row.empId)
    .input('EntryDate', sql.Date, row.invDate)
    .input('Amount', sql.Decimal(12, 2), row.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('RefID', sql.Int, row.cashMoveId)
    .input('CashMoveID', sql.Int, row.cashMoveId)
    .input('CreatedByUserID', sql.Int, createdByUserId)
    .query(`
      INSERT INTO dbo.TblEmpLedgerEntry (
        BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount, PayrollMonth,
        RefType, RefID, CashMoveID, AttendanceID, Notes, IsVoided, CreatedByUserID, CreatedAt
      )
      VALUES (
        @BranchID, @EmpID, @EntryDate, N'debit', N'advance', @Amount, @PayrollMonth,
        N'TblCashMove', @RefID, @CashMoveID, NULL, N'${ADVANCE_SYNC_NOTE}', 0, @CreatedByUserID, SYSDATETIME()
      )
    `);
}

async function updateAdvanceDebit(req: sql.Request, row: AdvanceSourceRow, payrollMonth: string, createdByUserId: number | null) {
  await req
    .input('EmpID', sql.Int, row.empId)
    .input('EntryDate', sql.Date, row.invDate)
    .input('Amount', sql.Decimal(12, 2), row.amount)
    .input('PayrollMonth', sql.NVarChar(7), payrollMonth)
    .input('RefID', sql.Int, row.cashMoveId)
    .input('CashMoveID', sql.Int, row.cashMoveId)
    .input('CreatedByUserID', sql.Int, createdByUserId)
    .query(`
      UPDATE dbo.TblEmpLedgerEntry
      SET EmpID=@EmpID, EntryDate=@EntryDate, Amount=@Amount, PayrollMonth=@PayrollMonth,
          CashMoveID=@CashMoveID, Notes=N'${ADVANCE_SYNC_NOTE}',
          CreatedByUserID=COALESCE(@CreatedByUserID, CreatedByUserID),
          UpdatedAt=SYSDATETIME()
      WHERE RefType=N'TblCashMove' AND RefID=@RefID AND EntryReason=N'advance' AND IsVoided=0
    `);
}
