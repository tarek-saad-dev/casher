import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';
import {
  allocateEmployeeInvoiceRevenue,
  type DetailLineForAllocation,
  type InvoiceHeaderInput,
} from '@/lib/services/employeeInvoiceAllocation';

/** Line revenue expression — matches /api/reports/employee-services */
const LINE_TOTAL_SQL = `
  CASE
    WHEN ISNULL(d.SValue, 0) > 0
      THEN ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)
    ELSE (ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)) - ISNULL(d.DisVal, 0)
  END
`;

// Phase 1E: branch-scoped — every query below filters h.BranchID = @branchId.
const BASE_WHERE = `
  CAST(h.invDate AS date) >= @fromDate
  AND CAST(h.invDate AS date) <= @toDate
  AND h.invType = N'مبيعات'
  AND h.BranchID = @branchId
  AND d.EmpID IS NOT NULL
  AND d.ProID IS NOT NULL
`;

const BASE_HEAD_WHERE = `
  CAST(h.invDate AS date) >= @fromDate
  AND CAST(h.invDate AS date) <= @toDate
  AND h.invType = N'مبيعات'
  AND h.BranchID = @branchId
`;

export interface EmployeeRevenueDetail {
  employeeId: number;
  employeeName: string;
  serviceRevenue: number;
  totalRevenue: number;
  transactionCount: number;
  invoiceCount: number;
}

export interface EmployeeActualRevenueDetail {
  employeeId: number;
  employeeName: string;
  grossServiceRevenue: number;
  actualInvoiceRevenue: number;
}

/** Matches booking/POS barber and assistant roles. */
export function isBarberOrServiceWorker(job: string | null | undefined): boolean {
  const normalized = (job ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('حلاق') ||
    normalized.includes('مساعد') ||
    normalized.includes('barber') ||
    normalized.includes('صنايع')
  );
}

/**
 * Total monthly revenue from employee services (TblinvServDetail).
 * Same source as /admin/reports/employee-services and /api/reports/monthly.
 */
export async function getEmployeeServicesRevenue(
  year: number,
  month: number,
  branchId: number,
): Promise<number> {
  const { startDate, endDate } = getMonthDateRange(year, month);
  const db = await getPool();

  const result = await db.request()
    .input('fromDate', sql.Date, startDate)
    .input('toDate', sql.Date, endDate)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT ISNULL(SUM(${LINE_TOTAL_SQL}), 0) AS TotalRevenue
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID
        AND h.invType = d.invType
      WHERE ${BASE_WHERE}
    `);

  return roundMoney(result.recordset[0]?.TotalRevenue ?? 0);
}

/**
 * Per-employee revenue breakdown for the selected calendar month.
 */
export async function getEmployeeServicesRevenueByEmployee(
  year: number,
  month: number,
  branchId: number,
): Promise<EmployeeRevenueDetail[]> {
  const { startDate, endDate } = getMonthDateRange(year, month);
  const db = await getPool();

  const result = await db.request()
    .input('fromDate', sql.Date, startDate)
    .input('toDate', sql.Date, endDate)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT
        d.EmpID AS employeeId,
        ISNULL(e.EmpName, N'غير محدد') AS employeeName,
        ISNULL(SUM(${LINE_TOTAL_SQL}), 0) AS totalRevenue,
        COUNT(*) AS transactionCount,
        COUNT(DISTINCT h.invID) AS invoiceCount
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID
        AND h.invType = d.invType
      LEFT JOIN dbo.TblEmp e ON e.EmpID = d.EmpID
      WHERE ${BASE_WHERE}
      GROUP BY d.EmpID, e.EmpName
      ORDER BY totalRevenue DESC
    `);

  return result.recordset.map((row: {
    employeeId: number;
    employeeName: string;
    totalRevenue: number;
    transactionCount: number;
    invoiceCount: number;
  }) => ({
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    serviceRevenue: roundMoney(row.totalRevenue),
    totalRevenue: roundMoney(row.totalRevenue),
    transactionCount: row.transactionCount,
    invoiceCount: row.invoiceCount,
  }));
}

/**
 * Per-employee actual invoice revenue after header discounts.
 * Uses the same allocation as GET /api/reports/employee-services.
 */
export async function getEmployeeActualInvoiceRevenueByEmployee(
  year: number,
  month: number,
  branchId: number,
): Promise<EmployeeActualRevenueDetail[]> {
  const { startDate, endDate } = getMonthDateRange(year, month);
  const db = await getPool();

  const headersResult = await db.request()
    .input('fromDate', sql.Date, startDate)
    .input('toDate', sql.Date, endDate)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT
        h.invID,
        h.invType,
        ISNULL(h.SubTotal, 0)   AS SubTotal,
        ISNULL(h.GrandTotal, 0) AS GrandTotal,
        ISNULL(h.DisVal, 0)     AS DisVal
      FROM dbo.TblinvServHead h
      WHERE ${BASE_HEAD_WHERE}
    `);

  const linesResult = await db.request()
    .input('fromDate', sql.Date, startDate)
    .input('toDate', sql.Date, endDate)
    .input('branchId', sql.Int, branchId)
    .query(`
      SELECT
        d.ID AS DetailID,
        d.EmpID,
        ISNULL(e.EmpName, N'غير محدد') AS EmpName,
        h.invID,
        h.invType,
        d.ProID,
        ISNULL(d.Qty, 1)     AS Qty,
        ISNULL(d.SValue, 0)  AS SValue,
        ISNULL(d.SPrice, 0)  AS UnitPrice,
        ISNULL(d.DisVal, 0)  AS DiscountValue,
        ${LINE_TOTAL_SQL}    AS LineTotal
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID AND h.invType = d.invType
      LEFT JOIN dbo.TblEmp e ON e.EmpID = d.EmpID
      WHERE ${BASE_WHERE}
    `);

  const headers: InvoiceHeaderInput[] = headersResult.recordset.map((h: {
    invID: number;
    invType: string;
    SubTotal: number;
    GrandTotal: number;
    DisVal: number;
  }) => ({
    invID: h.invID,
    invType: h.invType,
    subTotal: h.SubTotal,
    grandTotal: h.GrandTotal,
    disVal: h.DisVal,
  }));

  const detailLines: DetailLineForAllocation[] = linesResult.recordset.map((r: {
    DetailID: number;
    EmpID: number;
    EmpName: string;
    invID: number;
    invType: string;
    ProID: number;
    Qty: number;
    SValue: number;
    UnitPrice: number;
    DiscountValue: number;
    LineTotal: number;
  }) => ({
    detailId: r.DetailID,
    invID: r.invID,
    invType: r.invType,
    empId: r.EmpID,
    empName: r.EmpName,
    proId: r.ProID,
    qty: r.Qty,
    unitPrice: r.UnitPrice,
    discountValue: r.DiscountValue,
    sValue: r.SValue,
    lineTotal: r.LineTotal,
  }));

  const allocation = allocateEmployeeInvoiceRevenue(headers, detailLines);

  return allocation.employeeTotals.map((row) => ({
    employeeId: row.employeeId,
    employeeName: row.employeeName,
    grossServiceRevenue: row.grossServiceRevenue,
    actualInvoiceRevenue: row.actualInvoiceRevenue,
  }));
}

export async function getEmployeeJobById(): Promise<Map<number, string>> {
  const db = await getPool();
  const result = await db.request().query(`
    SELECT EmpID, ISNULL(Job, N'') AS Job
    FROM dbo.TblEmp
  `);

  const map = new Map<number, string>();
  for (const row of result.recordset as { EmpID: number; Job: string }[]) {
    map.set(row.EmpID, row.Job ?? '');
  }
  return map;
}

export async function getEmployeeNamesById(): Promise<Map<number, string>> {
  const db = await getPool();
  const result = await db.request().query(`
    SELECT EmpID, ISNULL(EmpName, N'غير محدد') AS EmpName
    FROM dbo.TblEmp
  `);

  const map = new Map<number, string>();
  for (const row of result.recordset as { EmpID: number; EmpName: string }[]) {
    map.set(row.EmpID, row.EmpName ?? 'غير محدد');
  }
  return map;
}
