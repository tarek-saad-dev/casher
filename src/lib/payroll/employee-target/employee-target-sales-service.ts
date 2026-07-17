import 'server-only';

import { getPool, sql } from '@/lib/db';
import { roundMoney } from '@/lib/reportMonthUtils';
import {
  allocateEmployeeInvoiceRevenue,
  type DetailLineForAllocation,
  type InvoiceHeaderInput,
} from '@/lib/services/employeeInvoiceAllocation';
import { aggregateEmployeeServiceBreakdown } from '@/lib/services/employeeServiceBreakdown';
import { assertValidWorkDate } from './target.validation';

/** Same line expression as GET /api/reports/employee-services */
export const EMPLOYEE_TARGET_LINE_TOTAL_SQL = `
  CASE
    WHEN ISNULL(d.SValue, 0) > 0
      THEN ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)
    ELSE (ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)) - ISNULL(d.DisVal, 0)
  END
`;

export interface EmployeeNetServiceSalesRow {
  empId: number;
  empName: string;
  /** Official KPI: actualInvoiceRevenue after line + header discount allocation. */
  netSalesAfterDiscount: number;
  grossServiceRevenue: number;
  allocatedInvoiceDiscount: number;
  serviceCount: number;
  invoiceCount: number;
}

/**
 * Shared sales core for daily target — parity with /admin/reports/employee-services
 * for a single work date (inclusive).
 *
 * Uses allocateEmployeeInvoiceRevenue so NetSalesAfterDiscount === actualInvoiceRevenue.
 */
export async function getEmployeesNetServiceSalesByDate(
  workDate: string,
  empIds?: number[] | null,
): Promise<EmployeeNetServiceSalesRow[]> {
  assertValidWorkDate(workDate);

  const filterEmpIds =
    empIds != null && empIds.length > 0
      ? [...new Set(empIds.filter((id) => Number.isInteger(id) && id > 0))]
      : null;

  const db = await getPool();

  const headersResult = await db.request()
    .input('fromDate', sql.Date, workDate)
    .input('toDate', sql.Date, workDate)
    .query(`
      SELECT
        h.invID,
        h.invType,
        h.SubTotal,
        h.GrandTotal,
        h.DisVal
      FROM dbo.TblinvServHead h
      WHERE CAST(h.invDate AS date) >= @fromDate
        AND CAST(h.invDate AS date) <= @toDate
        AND h.invType = N'مبيعات'
    `);

  const headers: InvoiceHeaderInput[] = headersResult.recordset.map((row: Record<string, unknown>) => ({
    invID: Number(row.invID),
    invType: String(row.invType),
    subTotal: row.SubTotal != null ? Number(row.SubTotal) : null,
    grandTotal: row.GrandTotal != null ? Number(row.GrandTotal) : null,
    disVal: row.DisVal != null ? Number(row.DisVal) : null,
  }));

  if (headers.length === 0) {
    return [];
  }

  // Load all eligible lines for invoices in range (report loads all then filters employee).
  const detailsResult = await db.request()
    .input('fromDate', sql.Date, workDate)
    .input('toDate', sql.Date, workDate)
    .query(`
      SELECT
        d.ID AS detailId,
        d.invID,
        d.invType,
        d.EmpID AS empId,
        ISNULL(e.EmpName, N'') AS empName,
        d.ProID AS proId,
        d.Qty AS qty,
        d.SPrice AS unitPrice,
        d.DisVal AS discountValue,
        d.SValue AS sValue,
        (${EMPLOYEE_TARGET_LINE_TOTAL_SQL}) AS lineTotal
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID
       AND h.invType = d.invType
      LEFT JOIN dbo.TblEmp e ON e.EmpID = d.EmpID
      WHERE CAST(h.invDate AS date) >= @fromDate
        AND CAST(h.invDate AS date) <= @toDate
        AND h.invType = N'مبيعات'
        AND d.EmpID IS NOT NULL
        AND d.ProID IS NOT NULL
    `);

  const detailLines: DetailLineForAllocation[] = detailsResult.recordset.map((row: Record<string, unknown>) => ({
    detailId: Number(row.detailId),
    invID: Number(row.invID),
    invType: String(row.invType),
    empId: Number(row.empId),
    empName: String(row.empName ?? ''),
    proId: Number(row.proId),
    qty: row.qty != null ? Number(row.qty) : null,
    unitPrice: row.unitPrice != null ? Number(row.unitPrice) : null,
    discountValue: row.discountValue != null ? Number(row.discountValue) : null,
    sValue: row.sValue != null ? Number(row.sValue) : null,
    lineTotal: row.lineTotal != null ? Number(row.lineTotal) : null,
  }));

  const allocation = allocateEmployeeInvoiceRevenue(headers, detailLines);

  let rows = allocation.employeeTotals.map((emp) => ({
    empId: emp.employeeId,
    empName: emp.employeeName,
    netSalesAfterDiscount: roundMoney(emp.actualInvoiceRevenue),
    grossServiceRevenue: roundMoney(emp.grossServiceRevenue),
    allocatedInvoiceDiscount: roundMoney(emp.allocatedInvoiceDiscount),
    serviceCount: emp.serviceCount,
    invoiceCount: emp.invoiceCount,
  }));

  if (filterEmpIds) {
    const allow = new Set(filterEmpIds);
    rows = rows.filter((r) => allow.has(r.empId));
  }

  return rows.sort((a, b) => a.empName.localeCompare(b.empName, 'ar'));
}

export async function getEmployeeNetServiceSalesByDate(
  empId: number,
  workDate: string,
): Promise<EmployeeNetServiceSalesRow> {
  if (!Number.isInteger(empId) || empId <= 0) {
    throw new Error('empId غير صالح');
  }

  const rows = await getEmployeesNetServiceSalesByDate(workDate, [empId]);
  if (rows.length > 0) return rows[0];

  const db = await getPool();
  const nameRes = await db.request()
    .input('empId', sql.Int, empId)
    .query(`SELECT TOP 1 EmpName FROM dbo.TblEmp WHERE EmpID = @empId`);

  return {
    empId,
    empName: nameRes.recordset[0]?.EmpName != null ? String(nameRes.recordset[0].EmpName) : `Emp#${empId}`,
    netSalesAfterDiscount: 0,
    grossServiceRevenue: 0,
    allocatedInvoiceDiscount: 0,
    serviceCount: 0,
    invoiceCount: 0,
  };
}

export interface EmployeeDayServiceCounts {
  empId: number;
  empName: string;
  /** All service lines for the day. */
  totalCount: number;
  /** شعر + دقن + شعر ودقن (barber bucket). */
  basicCount: number;
  otherCount: number;
  hairCount: number;
  hairBeardCount: number;
  beardCount: number;
}

/**
 * Per-employee service line counts for a work date (barber vs other).
 * Same مبيعات scope as getEmployeesNetServiceSalesByDate.
 */
export async function getEmployeesServiceCountsByDate(
  workDate: string,
  empIds?: number[] | null,
): Promise<EmployeeDayServiceCounts[]> {
  assertValidWorkDate(workDate);

  const filterEmpIds =
    empIds != null && empIds.length > 0
      ? [...new Set(empIds.filter((id) => Number.isInteger(id) && id > 0))]
      : null;

  const db = await getPool();
  const detailsResult = await db.request()
    .input('fromDate', sql.Date, workDate)
    .input('toDate', sql.Date, workDate)
    .query(`
      SELECT
        d.EmpID AS empId,
        ISNULL(e.EmpName, N'') AS empName,
        d.ProID AS proId,
        ISNULL(p.ProName, N'') AS serviceName,
        ISNULL(p.ProNameAr, N'') AS serviceNameAr
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h
        ON h.invID = d.invID
       AND h.invType = d.invType
      LEFT JOIN dbo.TblEmp e ON e.EmpID = d.EmpID
      LEFT JOIN dbo.TblPro p ON p.ProID = d.ProID
      WHERE CAST(h.invDate AS date) >= @fromDate
        AND CAST(h.invDate AS date) <= @toDate
        AND h.invType = N'مبيعات'
        AND d.EmpID IS NOT NULL
        AND d.ProID IS NOT NULL
    `);

  let lines = detailsResult.recordset.map((row: Record<string, unknown>) => ({
    empId: Number(row.empId),
    empName: String(row.empName ?? ''),
    proId: Number(row.proId),
    serviceName: String(row.serviceName ?? ''),
    serviceNameAr: String(row.serviceNameAr ?? ''),
  }));

  if (filterEmpIds) {
    const allow = new Set(filterEmpIds);
    lines = lines.filter((l) => allow.has(l.empId));
  }

  return aggregateEmployeeServiceBreakdown(lines).map((row) => {
    const basicCount = row.hairCount + row.hairBeardCount + row.beardCount;
    return {
      empId: row.employeeId,
      empName: row.employeeName,
      totalCount: basicCount + row.otherCount,
      basicCount,
      otherCount: row.otherCount,
      hairCount: row.hairCount,
      hairBeardCount: row.hairBeardCount,
      beardCount: row.beardCount,
    };
  });
}
