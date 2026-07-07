/**
 * Read-only audit: fetch TblCashMove rows and classify for accounting restructuring preview.
 */

import type { ConnectionPool } from 'mssql';
import { getPool, sql } from '@/lib/db';
import {
  classifyCashMove,
  summarizeClassifications,
  type CashMoveClassification,
  type CashMoveClassificationInput,
  type ClassificationAuditSummary,
  type LinkedPayrollTxn,
} from '@/lib/accounting/cashMoveClassification';
import { loadClassificationSettings } from '@/lib/accounting/accountingSettingsService';

const SUMMARY_BATCH_SIZE = 2000;
const NEEDS_REVIEW_ROWS_CAP = 25000;

export interface CashMoveClassificationAuditParams {
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
  /** When true, include all matching needsReview rows (capped) in the response. */
  includeNeedsReviewRows?: boolean;
}

export interface CashMoveClassificationAuditMeta {
  totalMatchingRows: number;
  returnedRows: number;
  limit: number;
  offset: number;
  summaryScope: 'all_matching_rows';
  rowsScope: 'paginated';
  hasTblEmpPayrollTxn: boolean;
  adminSettingsLoaded?: boolean;
  needsReviewRowsReturned?: number;
  needsReviewRowsCapped?: boolean;
  readOnly: true;
}

export interface CashMoveClassificationAuditResult {
  params: Required<Pick<CashMoveClassificationAuditParams, 'limit' | 'offset'>> &
    Pick<CashMoveClassificationAuditParams, 'dateFrom' | 'dateTo' | 'includeNeedsReviewRows'>;
  totalMatchingRows: number;
  rows: CashMoveClassification[];
  summary: ClassificationAuditSummary;
  needsReviewRows?: CashMoveClassification[];
  meta: CashMoveClassificationAuditMeta;
}

interface RawCashMoveRow {
  CashMoveID: number;
  invDate: Date | string;
  amount: number;
  inOut: string;
  invType: string;
  ExpINID: number | null;
  categoryName: string | null;
  notes: string | null;
  EmpID: number | null;
  IsPayrollDeduction: boolean | number | null;
  IsEmployeePayrollIncome: boolean | number | null;
  payrollTxnSource: string | null;
  payrollTxnId: number | null;
  payrollTxnEmpId: number | null;
  payrollTxnEmpName: string | null;
  payrollTxnType: string | null;
  payrollTxnLinkRole: string | null;
  empIdFromCategoryMap: number | null;
}

interface AuditQueryContext {
  pool: ConnectionPool;
  whereClause: string;
  dateFrom?: string;
  dateTo?: string;
  payrollJoin: string;
  selectList: string;
}

async function tableExists(pool: ConnectionPool, tableName: string): Promise<boolean> {
  const result = await pool.request()
    .input('tableName', sql.NVarChar(128), tableName)
    .query(`
      SELECT 1 AS found
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = N'dbo' AND TABLE_NAME = @tableName
    `);
  return result.recordset.length > 0;
}

function toIsoDate(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

function asBool(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

function mapLinkedPayrollTxn(row: RawCashMoveRow): LinkedPayrollTxn | null {
  if (!row.payrollTxnSource || row.payrollTxnId == null || row.payrollTxnEmpId == null) {
    return null;
  }
  return {
    source: row.payrollTxnSource as LinkedPayrollTxn['source'],
    id: row.payrollTxnId,
    empId: row.payrollTxnEmpId,
    empName: row.payrollTxnEmpName,
    txnType: row.payrollTxnType,
    linkRole: row.payrollTxnLinkRole as LinkedPayrollTxn['linkRole'] | undefined,
  };
}

function mapRawRow(row: RawCashMoveRow): CashMoveClassificationInput {
  return {
    cashMoveId: row.CashMoveID,
    invDate: toIsoDate(row.invDate),
    amount: Number(row.amount) || 0,
    inOut: row.inOut,
    invType: row.invType,
    expInId: row.ExpINID,
    categoryName: row.categoryName,
    notes: row.notes,
    empId: row.EmpID,
    isPayrollDeduction: asBool(row.IsPayrollDeduction),
    isEmployeePayrollIncome: asBool(row.IsEmployeePayrollIncome),
    linkedPayrollTxn: mapLinkedPayrollTxn(row),
    empIdFromCategoryMap: row.empIdFromCategoryMap,
  };
}

function classifyRawRows(rows: RawCashMoveRow[], settings: Awaited<ReturnType<typeof loadClassificationSettings>>): CashMoveClassification[] {
  return rows.map((row) => classifyCashMove(mapRawRow(row), settings));
}

function buildPayrollJoin(hasEmpPayrollTxn: boolean): string {
  const dailyPayrollSelect = `
    SELECT
      N'TblEmpDailyPayroll' AS payrollTxnSource,
      dp.ID AS payrollTxnId,
      dp.EmpID AS payrollTxnEmpId,
      e.EmpName AS payrollTxnEmpName,
      CAST(NULL AS NVARCHAR(50)) AS payrollTxnType,
      CASE WHEN dp.CashMoveID = cm.ID THEN N'expense' ELSE N'income' END AS payrollTxnLinkRole
    FROM dbo.TblEmpDailyPayroll dp
    INNER JOIN dbo.TblEmp e ON e.EmpID = dp.EmpID
    WHERE dp.CashMoveID = cm.ID OR dp.EmployeeIncomeCashMoveID = cm.ID
  `;

  if (!hasEmpPayrollTxn) {
    return `
      OUTER APPLY (
        SELECT TOP 1 *
        FROM (${dailyPayrollSelect}) daily_links
        ORDER BY payrollTxnId DESC
      ) payroll_link
    `;
  }

  return `
    OUTER APPLY (
      SELECT TOP 1 *
      FROM (
        SELECT
          N'TblEmpPayrollTxn' AS payrollTxnSource,
          pt.ID AS payrollTxnId,
          pt.EmpID AS payrollTxnEmpId,
          e_pt.EmpName AS payrollTxnEmpName,
          pt.TxnType AS payrollTxnType,
          CAST(NULL AS NVARCHAR(20)) AS payrollTxnLinkRole
        FROM dbo.TblEmpPayrollTxn pt
        INNER JOIN dbo.TblEmp e_pt ON e_pt.EmpID = pt.EmpID
        WHERE pt.CashMoveID = cm.ID

        UNION ALL

        ${dailyPayrollSelect}
      ) links
      ORDER BY
        CASE WHEN payrollTxnSource = N'TblEmpPayrollTxn' THEN 0 ELSE 1 END,
        payrollTxnId DESC
    ) payroll_link
  `;
}

function buildSelectList(): string {
  const prefix = 'payroll_link';
  return `
    cm.ID AS CashMoveID,
    cm.invDate,
    cm.GrandTolal AS amount,
    cm.inOut,
    cm.invType,
    cm.ExpINID,
    cat.CatName AS categoryName,
    cm.Notes AS notes,
    cm.EmpID,
    ISNULL(cm.IsPayrollDeduction, 0) AS IsPayrollDeduction,
    ISNULL(cm.IsEmployeePayrollIncome, 0) AS IsEmployeePayrollIncome,
    ${prefix}.payrollTxnSource,
    ${prefix}.payrollTxnId,
    ${prefix}.payrollTxnEmpId,
    ${prefix}.payrollTxnEmpName,
    ${prefix}.payrollTxnType,
    ${prefix}.payrollTxnLinkRole,
    cat_map.EmpID AS empIdFromCategoryMap
  `;
}

function buildFromClause(payrollJoin: string): string {
  return `
    FROM dbo.TblCashMove cm
    LEFT JOIN dbo.TblExpINCat cat ON cat.ExpINID = cm.ExpINID
    OUTER APPLY (
      SELECT TOP 1 m.EmpID
      FROM dbo.TblExpCatEmpMap m
      WHERE m.ExpINID = cm.ExpINID
        AND m.IsActive = 1
        AND m.TxnKind IN (N'advance', N'revenue', N'deduction')
      ORDER BY m.ID DESC
    ) cat_map
    ${payrollJoin}
  `;
}

function buildWhereClause(dateFrom?: string, dateTo?: string): string {
  const parts: string[] = [];
  if (dateFrom) parts.push('cm.invDate >= @dateFrom');
  if (dateTo) parts.push('cm.invDate <= @dateTo');
  return parts.length ? `WHERE ${parts.join(' AND ')}` : '';
}

function bindDateParams(
  request: ReturnType<ConnectionPool['request']>,
  dateFrom?: string,
  dateTo?: string,
) {
  if (dateFrom) request.input('dateFrom', sql.Date, dateFrom);
  if (dateTo) request.input('dateTo', sql.Date, dateTo);
}

async function countMatchingRows(ctx: AuditQueryContext): Promise<number> {
  const countRequest = ctx.pool.request();
  bindDateParams(countRequest, ctx.dateFrom, ctx.dateTo);
  const countResult = await countRequest.query(`
    SELECT COUNT(*) AS total
    FROM dbo.TblCashMove cm
    ${ctx.whereClause}
  `);
  return Number(countResult.recordset[0]?.total ?? 0);
}

async function fetchClassifiedPage(
  ctx: AuditQueryContext,
  offset: number,
  limit: number,
  settings: Awaited<ReturnType<typeof loadClassificationSettings>>,
): Promise<CashMoveClassification[]> {
  const dataRequest = ctx.pool.request();
  bindDateParams(dataRequest, ctx.dateFrom, ctx.dateTo);
  dataRequest.input('offset', sql.Int, offset);
  dataRequest.input('limit', sql.Int, limit);

  const dataResult = await dataRequest.query(`
    SELECT ${ctx.selectList}
    ${buildFromClause(ctx.payrollJoin)}
    ${ctx.whereClause}
    ORDER BY cm.invDate DESC, cm.ID DESC
    OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
  `);

  return classifyRawRows(dataResult.recordset as RawCashMoveRow[], settings);
}

async function buildFullSummaryScan(
  ctx: AuditQueryContext,
  totalMatchingRows: number,
  includeNeedsReviewRows: boolean,
  settings: Awaited<ReturnType<typeof loadClassificationSettings>>,
): Promise<{
  summary: ClassificationAuditSummary;
  needsReviewRows: CashMoveClassification[];
  needsReviewRowsCapped: boolean;
}> {
  const allClassified: CashMoveClassification[] = [];
  const needsReviewRows: CashMoveClassification[] = [];
  let needsReviewRowsCapped = false;

  for (let offset = 0; offset < totalMatchingRows; offset += SUMMARY_BATCH_SIZE) {
    const batchLimit = Math.min(SUMMARY_BATCH_SIZE, totalMatchingRows - offset);
    const batch = await fetchClassifiedPage(ctx, offset, batchLimit, settings);
    allClassified.push(...batch);

    if (includeNeedsReviewRows) {
      for (const row of batch) {
        if (!row.needsReview) continue;
        if (needsReviewRows.length >= NEEDS_REVIEW_ROWS_CAP) {
          needsReviewRowsCapped = true;
          break;
        }
        needsReviewRows.push(row);
      }
      if (needsReviewRowsCapped) break;
    }
  }

  return {
    summary: summarizeClassifications(allClassified),
    needsReviewRows,
    needsReviewRowsCapped,
  };
}

export async function runCashMoveClassificationAudit(
  params: CashMoveClassificationAuditParams = {},
): Promise<CashMoveClassificationAuditResult> {
  const pool = await getPool();
  const hasTblEmpPayrollTxn = await tableExists(pool, 'TblEmpPayrollTxn');
  const limit = Math.min(Math.max(params.limit ?? 500, 1), 5000);
  const offset = Math.max(params.offset ?? 0, 0);
  const includeNeedsReviewRows = params.includeNeedsReviewRows === true;

  const ctx: AuditQueryContext = {
    pool,
    whereClause: buildWhereClause(params.dateFrom, params.dateTo),
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    payrollJoin: buildPayrollJoin(hasTblEmpPayrollTxn),
    selectList: buildSelectList(),
  };

  const settings = await loadClassificationSettings();
  const totalMatchingRows = await countMatchingRows(ctx);

  const [summaryScan, rows] = await Promise.all([
    buildFullSummaryScan(ctx, totalMatchingRows, includeNeedsReviewRows, settings),
    fetchClassifiedPage(ctx, offset, limit, settings),
  ]);

  const meta: CashMoveClassificationAuditMeta = {
    totalMatchingRows,
    returnedRows: rows.length,
    limit,
    offset,
    summaryScope: 'all_matching_rows',
    rowsScope: 'paginated',
    hasTblEmpPayrollTxn,
    adminSettingsLoaded: settings.loaded,
    readOnly: true,
  };

  if (includeNeedsReviewRows) {
    meta.needsReviewRowsReturned = summaryScan.needsReviewRows.length;
    meta.needsReviewRowsCapped = summaryScan.needsReviewRowsCapped;
  }

  return {
    params: {
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      limit,
      offset,
      includeNeedsReviewRows: includeNeedsReviewRows || undefined,
    },
    totalMatchingRows,
    rows,
    summary: summaryScan.summary,
    needsReviewRows: includeNeedsReviewRows ? summaryScan.needsReviewRows : undefined,
    meta,
  };
}
