import 'server-only';
import { getPool, sql } from '@/lib/db';

/** SQL expression for net service-line revenue — matches employee-services report. */
export const SERVICE_LINE_TOTAL_EXPR = `
  CASE
    WHEN ISNULL(d.SValue, 0) > 0
      THEN ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)
    ELSE (ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)) - ISNULL(d.DisVal, 0)
  END
`;

export const EMPLOYEE_SERVICES_INVOICE_FILTER = `
  h.invType = N'مبيعات'
  AND d.EmpID IS NOT NULL
  AND d.ProID IS NOT NULL
`;

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface DailyEmployeeRevenueRow {
  operationDate: string;
  revenue: number;
  serviceCount: number;
  invoiceCount: number;
}

export interface EmployeeRevenueLineRow {
  operationDate: string;
  lineTotal: number;
  invId: number;
  invType: string;
}

/**
 * Aggregate employee service revenue by invoice date (half-open range).
 * Uses the same business rules as /admin/reports/employee-services.
 */
export async function getEmployeeRevenueByDate(
  employeeId: number,
  startDate: string,
  endDateExclusive: string,
): Promise<Map<string, DailyEmployeeRevenueRow>> {
  const db = await getPool();

  const result = await db
    .request()
    .input('employeeId', sql.Int, employeeId)
    .input('startDate', sql.Date, startDate)
    .input('endDateExclusive', sql.Date, endDateExclusive)
    .query(`
      SELECT
        CONVERT(VARCHAR(10), CAST(h.invDate AS date), 120) AS OperationDate,
        ISNULL(SUM(${SERVICE_LINE_TOTAL_EXPR}), 0) AS Revenue,
        COUNT(*) AS ServiceCount,
        COUNT(DISTINCT CONCAT(h.invType, N'-', CAST(h.invID AS NVARCHAR(20)))) AS InvoiceCount
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID
       AND h.invType = d.invType
      WHERE CAST(h.invDate AS date) >= @startDate
        AND CAST(h.invDate AS date) < @endDateExclusive
        AND ${EMPLOYEE_SERVICES_INVOICE_FILTER}
        AND d.EmpID = @employeeId
      GROUP BY CAST(h.invDate AS date)
    `);

  const map = new Map<string, DailyEmployeeRevenueRow>();
  for (const row of result.recordset) {
    const date = String(row.OperationDate).slice(0, 10);
    map.set(date, {
      operationDate: date,
      revenue: roundMoney(Number(row.Revenue) || 0),
      serviceCount: Number(row.ServiceCount) || 0,
      invoiceCount: Number(row.InvoiceCount) || 0,
    });
  }
  return map;
}

/**
 * Sum employee revenue for a date range (inclusive start, exclusive end).
 */
export async function getEmployeeRevenueTotal(
  employeeId: number,
  startDate: string,
  endDateExclusive: string,
): Promise<number> {
  const byDate = await getEmployeeRevenueByDate(employeeId, startDate, endDateExclusive);
  let total = 0;
  for (const row of byDate.values()) total += row.revenue;
  return roundMoney(total);
}

/**
 * Sum all employee revenue in range (no employee filter) — used by monthly report.
 * Phase 1E: optional branchId filters h.BranchID when provided; existing callers
 * that pre-date branch ownership keep working unfiltered.
 */
export async function getAllEmployeesRevenueTotal(
  startDate: string,
  endDateExclusive: string,
  branchId?: number,
): Promise<number> {
  const db = await getPool();

  const request = db
    .request()
    .input('startDate', sql.Date, startDate)
    .input('endDateExclusive', sql.Date, endDateExclusive);
  if (branchId !== undefined) {
    request.input('branchId', sql.Int, branchId);
  }

  const result = await request.query(`
      SELECT ISNULL(SUM(${SERVICE_LINE_TOTAL_EXPR}), 0) AS TotalRevenue
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID
       AND h.invType = d.invType
      WHERE CAST(h.invDate AS date) >= @startDate
        AND CAST(h.invDate AS date) < @endDateExclusive
        AND ${EMPLOYEE_SERVICES_INVOICE_FILTER}
        ${branchId !== undefined ? 'AND h.BranchID = @branchId' : ''}
    `);

  return roundMoney(Number(result.recordset[0]?.TotalRevenue) || 0);
}
