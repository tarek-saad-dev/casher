import 'server-only';

import { getPool, sql } from '@/lib/db';
import { isEmployeeLedgerDualWriteEnabled } from '@/lib/employeeLedgerConfig';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import { validateLedgerMonth } from '@/lib/services/employeeLedgerService';

export const EMP_LEDGER_REASON_MONTHLY_SALARY = 'monthly_salary';
export const EMP_LEDGER_REF_TYPE_MONTHLY_SALARY_PREFIX = 'MonthlySalary:';

export type MonthlySalaryRowStatus =
  | 'new'
  | 'alreadyPosted'
  | 'willUpdate'
  | 'skipped'
  | 'error';

export interface MonthlySalaryEmployeeRow {
  empId: number;
  empName: string;
  baseSalary: number;
  payrollMethod: string;
  employmentType: string | null;
  skipReason?: string;
}

export interface MonthlySalaryPreviewRow {
  empId: number;
  empName: string;
  amount: number;
  status: MonthlySalaryRowStatus;
  existingLedgerEntryId: number | null;
  existingAmount: number | null;
  notes: string;
  error?: string;
}

export interface MonthlySalaryPostCounts {
  eligible: number;
  inserted: number;
  updated: number;
  alreadyPosted: number;
  skipped: number;
  errors: number;
}

export interface MonthlySalaryPostResult {
  success: true;
  dryRun: boolean;
  month: string;
  postingDate: string;
  totalAmount: number;
  counts: MonthlySalaryPostCounts;
  rows: MonthlySalaryPreviewRow[];
}

export class EmployeeLedgerMonthlySalaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeLedgerMonthlySalaryError';
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildMonthlySalaryRefType(month: string): string {
  return `${EMP_LEDGER_REF_TYPE_MONTHLY_SALARY_PREFIX}${month}`;
}

export function buildMonthlySalaryNote(month: string): string {
  return `استحقاق راتب شهري عن شهر ${month}`;
}

export function resolveMonthlySalaryPostingDate(month: string, postingDate?: string | null): string {
  if (postingDate && DATE_RE.test(postingDate)) {
    if (!postingDate.startsWith(month)) {
      throw new EmployeeLedgerMonthlySalaryError('postingDate يجب أن يكون داخل شهر month');
    }
    return postingDate;
  }
  const [yearStr, monthStr] = month.split('-');
  const { endDate } = getMonthDateRange(parseInt(yearStr, 10), parseInt(monthStr, 10));
  return endDate;
}

export function classifyMonthlySalaryRow(
  amount: number,
  existing: { id: number; amount: number; entryDate: string; notes: string | null } | null,
  postingDate: string,
  notes: string,
): MonthlySalaryRowStatus {
  if (!existing) return 'new';
  const sameAmount = roundMoney(existing.amount) === roundMoney(amount);
  const sameDate = existing.entryDate.slice(0, 10) === postingDate;
  const sameNotes = (existing.notes ?? '') === notes;
  if (sameAmount && sameDate && sameNotes) return 'alreadyPosted';
  return 'willUpdate';
}

function ledgerRequest(
  pool: { request: () => sql.Request },
  transaction?: sql.Transaction,
): sql.Request {
  return transaction ? new sql.Request(transaction) : pool.request();
}

function formatDateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

async function fetchEligibleMonthlyEmployees(
  pool: { request: () => sql.Request },
  branchId: number,
  empId?: number | null,
  transaction?: sql.Transaction,
): Promise<MonthlySalaryEmployeeRow[]> {
  if (!Number.isInteger(branchId) || branchId <= 0) {
    throw new EmployeeLedgerMonthlySalaryError('branchId مطلوب لترحيل الراتب الشهري (Phase 1L)');
  }

  const req = ledgerRequest(pool, transaction).input('BranchID', sql.Int, branchId);
  if (empId != null && empId > 0) req.input('EmpID', sql.Int, empId);

  // Prefer branch payroll plan; no GLEEM fallback for other branches.
  const result = await req.query(`
    SELECT
      e.EmpID AS empId,
      e.EmpName AS empName,
      CAST(p.MonthlySalary AS DECIMAL(12,2)) AS baseSalary,
      p.PayType AS payrollMethod,
      e.EmploymentType AS employmentType
    FROM dbo.TblEmpBranchPayrollPlan p
    INNER JOIN dbo.TblEmp e ON e.EmpID = p.EmpID
    WHERE p.BranchID = @BranchID
      AND p.IsActive = 1
      AND p.PayType = N'monthly'
      AND ISNULL(p.MonthlySalary, 0) > 0
      AND (p.EffectiveTo IS NULL OR p.EffectiveTo >= CAST(GETDATE() AS date))
      AND p.EffectiveFrom <= CAST(GETDATE() AS date)
      AND ISNULL(e.isActive, 1) = 1
      AND ISNULL(e.IsPayrollEnabled, 1) = 1
      AND ISNULL(e.EmploymentType, N'full_time') <> N'freelance'
      ${empId != null && empId > 0 ? 'AND e.EmpID = @EmpID' : ''}
    ORDER BY e.EmpName
  `);

  return result.recordset.map((row: Record<string, unknown>) => ({
    empId: Number(row.empId),
    empName: String(row.empName),
    baseSalary: roundMoney(Number(row.baseSalary ?? 0)),
    payrollMethod: String(row.payrollMethod),
    employmentType: row.employmentType != null ? String(row.employmentType) : null,
  }));
}

async function fetchActiveMonthlySalaryEntry(
  pool: { request: () => sql.Request },
  month: string,
  empId: number,
  branchId: number,
  transaction?: sql.Transaction,
): Promise<{ id: number; amount: number; entryDate: string; notes: string | null } | null> {
  const refType = buildMonthlySalaryRefType(month);
  const result = await ledgerRequest(pool, transaction)
    .input('RefType', sql.NVarChar(80), refType)
    .input('RefID', sql.Int, empId)
    .input('BranchID', sql.Int, branchId)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_MONTHLY_SALARY)
    .query(`
      SELECT TOP 1 ID, Amount, EntryDate, Notes
      FROM dbo.TblEmpLedgerEntry
      WHERE RefType = @RefType
        AND RefID = @RefID
        AND BranchID = @BranchID
        AND EntryReason = @EntryReason
        AND IsVoided = 0
    `);

  if (result.recordset.length === 0) return null;
  const row = result.recordset[0];
  return {
    id: Number(row.ID),
    amount: roundMoney(Number(row.Amount ?? 0)),
    entryDate: formatDateValue(row.EntryDate),
    notes: row.Notes != null ? String(row.Notes) : null,
  };
}

async function upsertMonthlySalaryLedgerEntry(
  pool: { request: () => sql.Request },
  params: {
    month: string;
    empId: number;
    branchId: number;
    amount: number;
    postingDate: string;
    notes: string;
    createdByUserId?: number | null;
  },
  transaction: sql.Transaction,
): Promise<'inserted' | 'updated' | 'alreadyPosted'> {
  const refType = buildMonthlySalaryRefType(params.month);
  const existing = await fetchActiveMonthlySalaryEntry(
    pool,
    params.month,
    params.empId,
    params.branchId,
    transaction,
  );
  const status = classifyMonthlySalaryRow(
    params.amount,
    existing,
    params.postingDate,
    params.notes,
  );

  if (status === 'alreadyPosted') return 'alreadyPosted';

  if (status === 'willUpdate' && existing) {
    await ledgerRequest(pool, transaction)
      .input('ID', sql.Int, existing.id)
      .input('EntryDate', sql.Date, params.postingDate)
      .input('Amount', sql.Decimal(12, 2), params.amount)
      .input('PayrollMonth', sql.NVarChar(7), params.month)
      .input('Notes', sql.NVarChar(500), params.notes)
      .query(`
        UPDATE dbo.TblEmpLedgerEntry
        SET EntryDate = @EntryDate,
            Amount = @Amount,
            PayrollMonth = @PayrollMonth,
            Notes = @Notes,
            UpdatedAt = SYSDATETIME()
        WHERE ID = @ID AND IsVoided = 0
      `);
    return 'updated';
  }

  await ledgerRequest(pool, transaction)
    .input('BranchID', sql.Int, params.branchId)
    .input('EmpID', sql.Int, params.empId)
    .input('EntryDate', sql.Date, params.postingDate)
    .input('EntryReason', sql.NVarChar(40), EMP_LEDGER_REASON_MONTHLY_SALARY)
    .input('Amount', sql.Decimal(12, 2), params.amount)
    .input('PayrollMonth', sql.NVarChar(7), params.month)
    .input('Notes', sql.NVarChar(500), params.notes)
    .input('RefType', sql.NVarChar(80), refType)
    .input('RefID', sql.Int, params.empId)
    .input('CreatedByUserID', sql.Int, params.createdByUserId ?? null)
    .query(`
      INSERT INTO dbo.TblEmpLedgerEntry (
        BranchID, EmpID, EntryDate, EntryDirection, EntryReason, Amount,
        PayrollMonth, RefType, RefID, CashMoveID, AttendanceID,
        Notes, IsVoided, CreatedByUserID, CreatedAt
      )
      VALUES (
        @BranchID, @EmpID, @EntryDate, N'credit', @EntryReason, @Amount,
        @PayrollMonth, @RefType, @RefID, NULL, NULL,
        @Notes, 0, @CreatedByUserID, SYSDATETIME()
      )
    `);

  return 'inserted';
}

export async function postMonthlySalaryEntitlements(params: {
  month: string;
  branchId: number;
  postingDate?: string | null;
  empId?: number | null;
  dryRun?: boolean;
  createdByUserId?: number | null;
}): Promise<MonthlySalaryPostResult> {
  if (!isEmployeeLedgerDualWriteEnabled()) {
    throw new EmployeeLedgerMonthlySalaryError(
      'ترحيل الرواتب الشهرية يتطلب تفعيل EMP_LEDGER_DUAL_WRITE_ENABLED=true',
    );
  }

  const monthError = validateLedgerMonth(params.month);
  if (monthError) {
    throw new EmployeeLedgerMonthlySalaryError(monthError);
  }

  const postingDate = resolveMonthlySalaryPostingDate(params.month, params.postingDate);
  const dryRun = params.dryRun !== false;
  const pool = await getPool();
  const branchId = params.branchId;

  const employees = await fetchEligibleMonthlyEmployees(pool, branchId, params.empId);
  const rows: MonthlySalaryPreviewRow[] = [];
  const counts: MonthlySalaryPostCounts = {
    eligible: 0,
    inserted: 0,
    updated: 0,
    alreadyPosted: 0,
    skipped: 0,
    errors: 0,
  };

  let totalAmount = 0;

  for (const emp of employees) {
    counts.eligible++;
    const notes = buildMonthlySalaryNote(params.month);
    const existing = await fetchActiveMonthlySalaryEntry(pool, params.month, emp.empId, branchId);
    const status = classifyMonthlySalaryRow(emp.baseSalary, existing, postingDate, notes);

    const previewRow: MonthlySalaryPreviewRow = {
      empId: emp.empId,
      empName: emp.empName,
      amount: emp.baseSalary,
      status,
      existingLedgerEntryId: existing?.id ?? null,
      existingAmount: existing?.amount ?? null,
      notes,
    };

    if (status === 'new' || status === 'willUpdate') {
      totalAmount += emp.baseSalary;
    }

    rows.push(previewRow);
  }

  if (dryRun) {
    for (const row of rows) {
      if (row.status === 'new') counts.inserted++;
      else if (row.status === 'willUpdate') counts.updated++;
      else if (row.status === 'alreadyPosted') counts.alreadyPosted++;
    }
    return {
      success: true,
      dryRun: true,
      month: params.month,
      postingDate,
      totalAmount: roundMoney(totalAmount),
      counts,
      rows,
    };
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    for (const emp of employees) {
      const notes = buildMonthlySalaryNote(params.month);
      try {
        const outcome = await upsertMonthlySalaryLedgerEntry(
          pool,
          {
            month: params.month,
            empId: emp.empId,
            branchId,
            amount: emp.baseSalary,
            postingDate,
            notes,
            createdByUserId: params.createdByUserId,
          },
          transaction,
        );

        const row = rows.find((r) => r.empId === emp.empId);
        if (row) {
          if (outcome === 'inserted') {
            row.status = 'new';
            counts.inserted++;
          } else if (outcome === 'updated') {
            row.status = 'willUpdate';
            counts.updated++;
          } else {
            row.status = 'alreadyPosted';
            counts.alreadyPosted++;
          }
        }
      } catch (err: unknown) {
        counts.errors++;
        const row = rows.find((r) => r.empId === emp.empId);
        if (row) {
          row.status = 'error';
          row.error = err instanceof Error ? err.message : 'Unknown error';
        }
      }
    }

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  return {
    success: true,
    dryRun: false,
    month: params.month,
    postingDate,
    totalAmount: roundMoney(totalAmount),
    counts,
    rows,
  };
}
