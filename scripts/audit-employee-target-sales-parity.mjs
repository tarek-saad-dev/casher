#!/usr/bin/env npx tsx
/**
 * Read-only parity: shared daily-target sales core vs employee-services report metric.
 *
 * Usage:
 *   npx tsx scripts/audit-employee-target-sales-parity.mjs --date=2026-07-14
 *   npx tsx scripts/audit-employee-target-sales-parity.mjs --date=2026-07-14 --empId=22
 *
 * Compares actualInvoiceRevenue from:
 *   A) getEmployeesNetServiceSalesByDate (target core)
 *   B) allocateEmployeeInvoiceRevenue via the same filters as GET /api/reports/employee-services
 * No writes.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import Module from 'module';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env.local') });

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'server-only') return {};
  return originalLoad(request, parent, isMain);
};

function parseArgs(argv) {
  let date = null;
  let empId = null;
  for (const arg of argv) {
    if (arg.startsWith('--date=')) date = arg.slice('--date='.length);
    if (arg.startsWith('--empId=')) empId = Number(arg.slice('--empId='.length));
  }
  return { date, empId };
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

async function fetchReportParity(workDate, empId) {
  const { getPool, sql } = await import('../src/lib/db.ts');
  const { allocateEmployeeInvoiceRevenue } = await import(
    '../src/lib/services/employeeInvoiceAllocation.ts'
  );

  const LINE_TOTAL_SQL = `
    CASE
      WHEN ISNULL(d.SValue, 0) > 0
        THEN ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)
      ELSE (ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)) - ISNULL(d.DisVal, 0)
    END
  `;

  const db = await getPool();
  const headersResult = await db.request()
    .input('fromDate', sql.Date, workDate)
    .input('toDate', sql.Date, workDate)
    .query(`
      SELECT h.invID, h.invType, h.SubTotal, h.GrandTotal, h.DisVal
      FROM dbo.TblinvServHead h
      WHERE CAST(h.invDate AS date) >= @fromDate
        AND CAST(h.invDate AS date) <= @toDate
        AND h.invType = N'مبيعات'
    `);

  const detailsResult = await db.request()
    .input('fromDate', sql.Date, workDate)
    .input('toDate', sql.Date, workDate)
    .query(`
      SELECT
        d.ID AS detailId, d.invID, d.invType,
        d.EmpID AS empId, ISNULL(e.EmpName, N'') AS empName,
        d.ProID AS proId, d.Qty AS qty, d.SPrice AS unitPrice,
        d.DisVal AS discountValue, d.SValue AS sValue,
        (${LINE_TOTAL_SQL}) AS lineTotal
      FROM dbo.TblinvServDetail d
      INNER JOIN dbo.TblinvServHead h ON h.invID = d.invID AND h.invType = d.invType
      LEFT JOIN dbo.TblEmp e ON e.EmpID = d.EmpID
      WHERE CAST(h.invDate AS date) >= @fromDate
        AND CAST(h.invDate AS date) <= @toDate
        AND h.invType = N'مبيعات'
        AND d.EmpID IS NOT NULL
        AND d.ProID IS NOT NULL
    `);

  const headers = headersResult.recordset.map((row) => ({
    invID: Number(row.invID),
    invType: String(row.invType),
    subTotal: row.SubTotal != null ? Number(row.SubTotal) : null,
    grandTotal: row.GrandTotal != null ? Number(row.GrandTotal) : null,
    disVal: row.DisVal != null ? Number(row.DisVal) : null,
  }));

  const detailLines = detailsResult.recordset.map((row) => ({
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
  let rows = allocation.employeeTotals.map((e) => ({
    empId: e.employeeId,
    empName: e.employeeName,
    reportActual: roundMoney(e.actualInvoiceRevenue),
  }));
  if (empId != null && empId > 0) {
    rows = rows.filter((r) => r.empId === empId);
  }
  return rows;
}

async function main() {
  const { date, empId } = parseArgs(process.argv.slice(2));
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Usage: npx tsx scripts/audit-employee-target-sales-parity.mjs --date=YYYY-MM-DD [--empId=N]');
    process.exit(1);
  }

  const { getEmployeesNetServiceSalesByDate } = await import(
    '../src/lib/payroll/employee-target/employee-target-sales-service.ts'
  );

  const coreRows = await getEmployeesNetServiceSalesByDate(
    date,
    empId != null && empId > 0 ? [empId] : null,
  );
  const reportRows = await fetchReportParity(date, empId);

  const reportMap = new Map(reportRows.map((r) => [r.empId, r]));
  const coreMap = new Map(coreRows.map((r) => [r.empId, r]));
  const allIds = new Set([...reportMap.keys(), ...coreMap.keys()]);

  const lines = [];
  let fails = 0;
  for (const id of [...allIds].sort((a, b) => a - b)) {
    const core = coreMap.get(id);
    const report = reportMap.get(id);
    const coreAmt = core?.netSalesAfterDiscount ?? 0;
    const reportAmt = report?.reportActual ?? 0;
    const diff = roundMoney(coreAmt - reportAmt);
    const status = diff === 0 ? 'PASS' : 'FAIL';
    if (status === 'FAIL') fails += 1;
    lines.push({
      EmpID: id,
      EmpName: core?.empName ?? report?.empName ?? '',
      coreNetSales: coreAmt,
      reportActual: reportAmt,
      difference: diff,
      status,
    });
  }

  console.log(`\nParity date=${date}${empId ? ` empId=${empId}` : ''}`);
  console.table(lines);
  console.log(`\nResult: ${fails === 0 ? 'ALL PASS' : `${fails} FAIL(s)`} (${lines.length} employees)`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
