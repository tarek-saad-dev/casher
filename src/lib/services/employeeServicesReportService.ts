import 'server-only';

import { getPool, sql } from '@/lib/db';
import { getMonthDateRange, roundMoney } from '@/lib/reportMonthUtils';

/** Line revenue expression — matches /api/reports/employee-services */
const LINE_TOTAL_SQL = `
  CASE
    WHEN ISNULL(d.SValue, 0) > 0
      THEN ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)
    ELSE (ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)) - ISNULL(d.DisVal, 0)
  END
`;

const BASE_WHERE = `
  CAST(h.invDate AS date) >= @fromDate
  AND CAST(h.invDate AS date) <= @toDate
  AND h.invType = N'مبيعات'
  AND d.EmpID IS NOT NULL
  AND d.ProID IS NOT NULL
`;

export interface EmployeeRevenueDetail {
  employeeId: number;
  employeeName: string;
  serviceRevenue: number;
  totalRevenue: number;
  transactionCount: number;
  invoiceCount: number;
}

/**
 * Total monthly revenue from employee services (TblinvServDetail).
 * Same source as /admin/reports/employee-services and /api/reports/monthly.
 */
export async function getEmployeeServicesRevenue(year: number, month: number): Promise<number> {
  const { startDate, endDate } = getMonthDateRange(year, month);
  const db = await getPool();

  const result = await db.request()
    .input('fromDate', sql.Date, startDate)
    .input('toDate', sql.Date, endDate)
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
  month: number
): Promise<EmployeeRevenueDetail[]> {
  const { startDate, endDate } = getMonthDateRange(year, month);
  const db = await getPool();

  const result = await db.request()
    .input('fromDate', sql.Date, startDate)
    .input('toDate', sql.Date, endDate)
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
