/**
 * Phase 5C — Read-only legacy employee income mirror review helpers.
 * No writes. Does not change classification formulas or report totals.
 */

import { normalizeForMatch } from '@/lib/accounting/cashMoveClassification';
import {
  classifyCashMoveForFinancialAudit,
  type CashMoveAuditInput,
} from '@/lib/accounting/financialReportClassificationAudit';

export const LEGACY_MIRROR_REVIEW_READ_ONLY_GUARD = Object.freeze({
  allowWrites: false,
  allowCashMoveUpdates: false,
  allowLedgerUpdates: false,
});

export type LegacyMirrorConfidence = 'high' | 'medium' | 'low';

export interface LegacyMirrorRowInput {
  cashMoveId: number;
  date: string;
  amount: number;
  invType: string;
  inOut: string;
  categoryId: number | null;
  categoryName: string | null;
  paymentMethod: string | null;
  notes: string | null;
  empId: number | null;
  empName: string | null;
  mappedEmpId: number | null;
  mappedEmpName: string | null;
  txnKind: string | null;
  isEmployeePayrollIncome: boolean;
  isPayrollDeduction: boolean;
}

export interface LegacyMirrorReviewedRow extends LegacyMirrorRowInput {
  resolvedEmpId: number | null;
  resolvedEmpName: string | null;
  classificationBucket: 'legacyEmployeeIncomeMirror';
  confidence: LegacyMirrorConfidence;
  reason: string;
  includedInCleanProfit: false;
  includedInLegacyRevenue: boolean;
}

export interface LegacyMirrorSummary {
  totalAmount: number;
  rowCount: number;
  byEmployee: Array<{ empId: number | null; empName: string; total: number; count: number }>;
  byCategory: Array<{ categoryId: number | null; categoryName: string; total: number; count: number }>;
  byDate: Array<{ date: string; total: number; count: number }>;
  confidence: { high: number; medium: number; low: number };
}

export interface LegacyMirrorReviewResult {
  month: string;
  rows: LegacyMirrorReviewedRow[];
  summary: LegacyMirrorSummary;
  includedInCleanProfit: false;
  historicalRowsUnchanged: true;
  readOnly: true;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function norm(text: string | null | undefined): string {
  return normalizeForMatch(text);
}

function employeeLikeName(categoryName: string | null): boolean {
  const n = norm(categoryName);
  if (!n) return false;
  return (
    n.includes(norm('إيراد'))
    || n.includes(norm('ايراد'))
    || n.includes(norm('موظف'))
    || n.includes(norm('دخل'))
    || n.includes('income')
    || n.includes('emp')
  );
}

export function isLegacyEmployeeIncomeMirrorCandidate(row: LegacyMirrorRowInput): boolean {
  const audit = classifyCashMoveForFinancialAudit({
    invType: row.invType,
    inOut: row.inOut,
    categoryName: row.categoryName,
    isPayrollDeduction: row.isPayrollDeduction,
    isEmployeePayrollIncome: row.isEmployeePayrollIncome,
    txnKind: row.txnKind,
    empIdFromMap: row.mappedEmpId,
    empId: row.empId,
  } satisfies CashMoveAuditInput);

  return audit.revenueClass === 'legacy_employee_income_mirror';
}

export function classifyLegacyMirrorConfidence(
  row: LegacyMirrorRowInput,
): { confidence: LegacyMirrorConfidence; reason: string } {
  const isIncomeIn =
    row.inOut === 'in'
    && (row.invType === 'ايرادات' || row.invType === 'إيرادات');

  if (!isIncomeIn) {
    return {
      confidence: 'low',
      reason: 'Not an income/in cash move; suspicious for employee income mirror',
    };
  }

  const hasMapping =
    row.txnKind === 'revenue'
    && (row.mappedEmpId != null || row.empId != null);
  const hasPayrollIncomeFlag = row.isEmployeePayrollIncome;
  const nameLooksEmployee = employeeLikeName(row.categoryName);

  if (hasPayrollIncomeFlag || hasMapping) {
    return {
      confidence: 'high',
      reason: hasPayrollIncomeFlag
        ? 'IsEmployeePayrollIncome=1 (legacy payroll income mirror flag)'
        : 'Income category mapped to employee with TxnKind=revenue',
    };
  }

  if (nameLooksEmployee) {
    return {
      confidence: 'medium',
      reason: 'Employee-like income category name but mapping incomplete',
    };
  }

  return {
    confidence: 'low',
    reason: 'Suspicious income row without payroll flag or employee revenue mapping',
  };
}

export function enrichLegacyMirrorRow(row: LegacyMirrorRowInput): LegacyMirrorReviewedRow | null {
  if (!isLegacyEmployeeIncomeMirrorCandidate(row)) {
    return null;
  }

  const { confidence, reason } = classifyLegacyMirrorConfidence(row);
  const resolvedEmpId = row.mappedEmpId ?? row.empId;
  const resolvedEmpName = row.mappedEmpName ?? row.empName ?? (resolvedEmpId != null ? `Emp#${resolvedEmpId}` : 'غير محدد');

  return {
    ...row,
    resolvedEmpId,
    resolvedEmpName,
    classificationBucket: 'legacyEmployeeIncomeMirror',
    confidence,
    reason,
    includedInCleanProfit: false,
    includedInLegacyRevenue: row.inOut === 'in',
  };
}

export function summarizeLegacyEmployeeMirrorRows(
  rows: LegacyMirrorReviewedRow[],
): LegacyMirrorSummary {
  const byEmployeeMap = new Map<string, { empId: number | null; empName: string; total: number; count: number }>();
  const byCategoryMap = new Map<string, { categoryId: number | null; categoryName: string; total: number; count: number }>();
  const byDateMap = new Map<string, { date: string; total: number; count: number }>();
  const confidence = { high: 0, medium: 0, low: 0 };

  let totalAmount = 0;

  for (const row of rows) {
    totalAmount += row.amount;
    confidence[row.confidence] += 1;

    const empKey = String(row.resolvedEmpId ?? `name:${row.resolvedEmpName}`);
    const emp = byEmployeeMap.get(empKey) ?? {
      empId: row.resolvedEmpId,
      empName: row.resolvedEmpName ?? 'غير محدد',
      total: 0,
      count: 0,
    };
    emp.total += row.amount;
    emp.count += 1;
    byEmployeeMap.set(empKey, emp);

    const catKey = String(row.categoryId ?? row.categoryName ?? 'unknown');
    const cat = byCategoryMap.get(catKey) ?? {
      categoryId: row.categoryId,
      categoryName: row.categoryName ?? 'غير مصنف',
      total: 0,
      count: 0,
    };
    cat.total += row.amount;
    cat.count += 1;
    byCategoryMap.set(catKey, cat);

    const dateKey = row.date.slice(0, 10);
    const day = byDateMap.get(dateKey) ?? { date: dateKey, total: 0, count: 0 };
    day.total += row.amount;
    day.count += 1;
    byDateMap.set(dateKey, day);
  }

  const sortByTotal = <T extends { total: number }>(arr: T[]) =>
    arr.sort((a, b) => b.total - a.total);

  return {
    totalAmount: roundMoney(totalAmount),
    rowCount: rows.length,
    byEmployee: sortByTotal([...byEmployeeMap.values()].map((r) => ({ ...r, total: roundMoney(r.total) }))),
    byCategory: sortByTotal([...byCategoryMap.values()].map((r) => ({ ...r, total: roundMoney(r.total) }))),
    byDate: sortByTotal([...byDateMap.values()].map((r) => ({ ...r, total: roundMoney(r.total) }))),
    confidence,
  };
}

export function buildLegacyEmployeeMirrorReviewFromRows(params: {
  month: string;
  rows: LegacyMirrorRowInput[];
}): LegacyMirrorReviewResult {
  const reviewed = params.rows
    .map(enrichLegacyMirrorRow)
    .filter((row): row is LegacyMirrorReviewedRow => row != null)
    .sort((a, b) => b.amount - a.amount || a.cashMoveId - b.cashMoveId);

  return {
    month: params.month,
    rows: reviewed,
    summary: summarizeLegacyEmployeeMirrorRows(reviewed),
    includedInCleanProfit: false,
    historicalRowsUnchanged: true,
    readOnly: true,
  };
}

/** Alias matching Phase 5C naming for in-memory builds. */
export function buildLegacyEmployeeMirrorReview(params: {
  month: string;
  rows: LegacyMirrorRowInput[];
  empId?: number | null;
}): LegacyMirrorReviewResult {
  const filtered =
    params.empId != null && params.empId > 0
      ? params.rows.filter(
          (row) => row.empId === params.empId || row.mappedEmpId === params.empId,
        )
      : params.rows;

  return buildLegacyEmployeeMirrorReviewFromRows({
    month: params.month,
    rows: filtered,
  });
}

/**
 * Maps a DB-shaped record into LegacyMirrorRowInput (SELECT-only consumers).
 */
export function mapDbRowToLegacyMirrorInput(row: Record<string, unknown>): LegacyMirrorRowInput {
  const dateRaw = row.invDate ?? row.date;
  const date =
    dateRaw instanceof Date
      ? dateRaw.toISOString().slice(0, 10)
      : String(dateRaw ?? '').slice(0, 10);

  return {
    cashMoveId: Number(row.cashMoveId ?? row.ID ?? row.id),
    date,
    amount: Number(row.amount ?? row.GrandTolal ?? 0),
    invType: String(row.invType ?? ''),
    inOut: String(row.inOut ?? ''),
    categoryId: row.categoryId != null || row.ExpINID != null
      ? Number(row.categoryId ?? row.ExpINID)
      : null,
    categoryName: row.categoryName != null || row.CatName != null
      ? String(row.categoryName ?? row.CatName)
      : null,
    paymentMethod: row.paymentMethod != null || row.PaymentMethod != null
      ? String(row.paymentMethod ?? row.PaymentMethod)
      : null,
    notes: row.notes != null || row.Notes != null
      ? String(row.notes ?? row.Notes)
      : null,
    empId: row.empId != null || row.EmpID != null ? Number(row.empId ?? row.EmpID) : null,
    empName: row.empName != null ? String(row.empName) : null,
    mappedEmpId: row.mappedEmpId != null || row.EmpIdFromMap != null
      ? Number(row.mappedEmpId ?? row.EmpIdFromMap)
      : null,
    mappedEmpName: row.mappedEmpName != null ? String(row.mappedEmpName) : null,
    txnKind: row.txnKind != null || row.TxnKind != null
      ? String(row.txnKind ?? row.TxnKind)
      : null,
    isEmployeePayrollIncome:
      row.isEmployeePayrollIncome === true
      || row.isEmployeePayrollIncome === 1
      || row.IsEmployeePayrollIncome === 1
      || row.IsEmployeePayrollIncome === true,
    isPayrollDeduction:
      row.isPayrollDeduction === true
      || row.isPayrollDeduction === 1
      || row.IsPayrollDeduction === 1
      || row.IsPayrollDeduction === true,
  };
}

export const LEGACY_MIRROR_CANDIDATE_SELECT_SQL = `
  SELECT
    cm.ID AS cashMoveId,
    cm.invDate,
    cm.GrandTolal AS amount,
    cm.invType,
    cm.inOut,
    cm.ExpINID AS categoryId,
    ISNULL(cat.CatName, N'') AS categoryName,
    ISNULL(pm.PaymentMethod, N'') AS paymentMethod,
    cm.Notes AS notes,
    cm.EmpID AS empId,
    eDirect.EmpName AS empName,
    map.EmpID AS mappedEmpId,
    eMap.EmpName AS mappedEmpName,
    map.TxnKind AS txnKind,
    ISNULL(cm.IsEmployeePayrollIncome, 0) AS isEmployeePayrollIncome,
    ISNULL(cm.IsPayrollDeduction, 0) AS isPayrollDeduction
  FROM dbo.TblCashMove cm
  LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
  LEFT JOIN dbo.TblPaymentMethods pm ON pm.PaymentID = cm.PaymentMethodID
  LEFT JOIN dbo.TblEmp eDirect ON eDirect.EmpID = cm.EmpID
  OUTER APPLY (
    SELECT TOP 1 m.TxnKind, m.EmpID
    FROM dbo.TblExpCatEmpMap m
    WHERE m.ExpINID = cm.ExpINID AND m.IsActive = 1
    ORDER BY m.ID DESC
  ) map
  LEFT JOIN dbo.TblEmp eMap ON eMap.EmpID = map.EmpID
  WHERE cm.invDate >= @startDate
    AND cm.invDate <= @endDate
    AND cm.inOut = N'in'
    AND cm.invType IN (N'ايرادات', N'إيرادات')
    AND (
      ISNULL(cm.IsEmployeePayrollIncome, 0) = 1
      OR map.TxnKind = N'revenue'
    )
`;

export async function fetchLegacyEmployeeIncomeMirrorRows(params: {
  month: string;
  empId?: number | null;
  /** Injected query for tests / scripts; defaults to app getPool SELECT. */
  executor?: {
    query: (
      text: string,
      binds: { startDate: string; endDate: string; empId: number | null },
    ) => Promise<Record<string, unknown>[]>;
  };
}): Promise<LegacyMirrorRowInput[]> {
  if (!/^\d{4}-\d{2}$/.test(params.month)) {
    throw new Error('month must be YYYY-MM');
  }

  const [yearStr, monthStr] = params.month.split('-');
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monthStr, 10);
  const startDate = `${params.month}-01`;
  const endDate = new Date(year, monthNum, 0).toISOString().slice(0, 10);
  const empId = params.empId != null && params.empId > 0 ? params.empId : null;

  const sqlText = `
    ${LEGACY_MIRROR_CANDIDATE_SELECT_SQL}
    ${empId != null ? 'AND (cm.EmpID = @empId OR map.EmpID = @empId)' : ''}
    ORDER BY cm.invDate DESC, cm.ID DESC
  `;

  let rows: Record<string, unknown>[];
  if (params.executor) {
    rows = await params.executor.query(sqlText, { startDate, endDate, empId });
  } else {
    const { getPool, sql } = await import('@/lib/db');
    const db = await getPool();
    const req = db
      .request()
      .input('startDate', sql.Date, startDate)
      .input('endDate', sql.Date, endDate);
    if (empId != null) req.input('empId', sql.Int, empId);
    const result = await req.query(sqlText);
    rows = result.recordset as Record<string, unknown>[];
  }

  return rows.map(mapDbRowToLegacyMirrorInput);
}

export async function buildLegacyEmployeeMirrorReviewAsync(params: {
  month: string;
  empId?: number | null;
  executor?: Parameters<typeof fetchLegacyEmployeeIncomeMirrorRows>[0]['executor'];
}): Promise<LegacyMirrorReviewResult> {
  const rows = await fetchLegacyEmployeeIncomeMirrorRows(params);
  return buildLegacyEmployeeMirrorReviewFromRows({ month: params.month, rows });
}
