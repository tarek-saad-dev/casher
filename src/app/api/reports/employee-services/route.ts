import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import {
  aggregateEmployeeServiceBreakdown,
  calculateServiceLineTotal,
  classifyServiceLines,
} from '@/lib/services/employeeServiceBreakdown';
import {
  allocateEmployeeInvoiceRevenue,
  type AllocatedDetailLine,
} from '@/lib/services/employeeInvoiceAllocation';
import { roundMoney } from '@/lib/reportMonthUtils';
import { isAuthResult, requirePageAccess } from '@/lib/api-auth';
import {
  isReportBranchScope,
  parseReportScopeQuery,
  reportScopeMetadata,
  resolveReportBranchScope,
} from '@/lib/branch';

const PAGE = '/admin/reports/employee-services';

// GET /api/reports/employee-services?fromDate=&toDate=&employeeId=&branchId=&scope=all
// Phase 1E: branch-scoped. `branchId`/`scope=all` are hidden query params — no
// branch switcher UI is exposed. Default = caller's active branch.
export async function GET(req: NextRequest) {
  try {
    const auth = await requirePageAccess(PAGE);
    if (!isAuthResult(auth)) return auth;

    const { searchParams } = new URL(req.url);

    const today = new Date().toISOString().split('T')[0];
    const fromDate = searchParams.get('fromDate') || today;
    const toDate   = searchParams.get('toDate')   || today;
    const empIdParam = searchParams.get('employeeId');
    const employeeId = empIdParam ? parseInt(empIdParam) : null;

    // Validate dates
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate) || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)) {
      return NextResponse.json({ error: 'صيغة التاريخ غير صحيحة، استخدم YYYY-MM-DD' }, { status: 400 });
    }

    const { requestedBranchId, requestedAllBranches } = parseReportScopeQuery(searchParams);
    const scope = await resolveReportBranchScope({
      requestedBranchId,
      requestedAllBranches,
      allowAllBranchesIfPermitted: true,
    });
    if (!isReportBranchScope(scope)) return scope;
    const branchIds = scope.mode === 'single' ? [scope.branchId] : scope.branchIds;

    const db = await getPool();

    const branchFilterSql = `h.BranchID IN (${branchIds.map((_, i) => `@branchId${i}`).join(',')})`;
    function bindBranchIds(request: ReturnType<typeof db.request>): ReturnType<typeof db.request> {
      branchIds.forEach((id, i) => request.input(`branchId${i}`, sql.Int, id));
      return request;
    }

    // ── Step 1: Discover actual column names from schema ──────────────────────
    const schemaResult = await db.request().query(`
      SELECT TABLE_NAME, COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME IN ('TblEmp','TblPro','TblClient','TblinvServHead','TblinvServDetail')
      ORDER BY TABLE_NAME, ORDINAL_POSITION
    `);

    const schema: Record<string, string[]> = {};
    for (const row of schemaResult.recordset) {
      if (!schema[row.TABLE_NAME]) schema[row.TABLE_NAME] = [];
      schema[row.TABLE_NAME].push(row.COLUMN_NAME);
    }

    // Resolve TblEmp name column
    const empCols = schema['TblEmp'] || [];
    const empNameCol = empCols.find(c => /^EmpName$/i.test(c))
      || empCols.find(c => /name/i.test(c) && !/id/i.test(c))
      || 'EmpName';

    // Resolve TblPro name column
    const proCols = schema['TblPro'] || [];
    const proNameCol = proCols.find(c => /^ProName$/i.test(c))
      || proCols.find(c => /^(ItemName|ServiceName|Name|ProName)/i.test(c))
      || proCols.find(c => /name/i.test(c) && !/id/i.test(c))
      || 'ProName';
    const proNameArCol = proCols.find(c => /^ProNameAr$/i.test(c)) ?? null;

    // Resolve TblClient name column
    const clientCols = schema['TblClient'] || [];
    const clientNameCol = clientCols.find(c => /^ClientName$/i.test(c))
      || clientCols.find(c => /name/i.test(c) && !/id/i.test(c))
      || 'ClientName';

    // Check if TblinvServHead has isActive column
    const headCols = schema['TblinvServHead'] || [];
    const hasIsActive = headCols.some(c => /^isActive$/i.test(c));

    // Check if TblClient has ClientID
    const hasClientTable = clientCols.length > 0;
    const headHasClientID = headCols.some(c => /^ClientID$/i.test(c));

    // Discover distinct invType values for reference
    const invTypeResult = await db.request().query(`
      SELECT DISTINCT TOP 20 invType FROM dbo.TblinvServHead WHERE invType IS NOT NULL ORDER BY invType
    `);
    const invTypes: string[] = invTypeResult.recordset.map((r: any) => r.invType);

    // ── isActive: NOT used as a filter ─────────────────────────────────────
    // Data shows: مبيعات invoices have isActive='no' (5551 rows) which are the REAL sales.
    // Filtering by isActive='yes' would exclude all real sales. Filter is disabled.
    const isActiveFilterApplied = false;

    // Build client join
    const clientJoin = (hasClientTable && headHasClientID)
      ? `LEFT JOIN dbo.TblClient c ON c.ClientID = h.ClientID`
      : '';
    const clientNameExpr = (hasClientTable && headHasClientID)
      ? `ISNULL(c.${clientNameCol}, N'')`
      : `N''`;

    // ── Step 2: Debug queries — count heads/details in range ─────────────────
    const debugRequest = bindBranchIds(db.request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate',   sql.Date, toDate));

    const headCountRes = await debugRequest.query(`
      SELECT COUNT(*) AS SalesHeadsCount
      FROM dbo.TblinvServHead h
      WHERE CAST(h.invDate AS date) >= @fromDate
        AND CAST(h.invDate AS date) <= @toDate
        AND h.invType = N'مبيعات'
        AND ${branchFilterSql}
    `);
    const salesHeadsCount: number = headCountRes.recordset[0]?.SalesHeadsCount ?? 0;

    const detailCountRes = await bindBranchIds(db.request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate',   sql.Date, toDate))
      .query(`
        SELECT COUNT(*) AS SalesDetailsCount
        FROM dbo.TblinvServDetail d
        INNER JOIN dbo.TblinvServHead h
          ON h.invID   = d.invID
         AND h.invType = d.invType
        WHERE CAST(h.invDate AS date) >= @fromDate
          AND CAST(h.invDate AS date) <= @toDate
          AND h.invType = N'مبيعات'
          AND ${branchFilterSql}
      `);
    const salesDetailsCount: number = detailCountRes.recordset[0]?.SalesDetailsCount ?? 0;

    const sampleRes = await bindBranchIds(db.request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate',   sql.Date, toDate))
      .query(`
        SELECT TOP 20
          h.invID, h.invType, CAST(h.invDate AS date) AS invDate,
          CONVERT(VARCHAR(8), h.invTime, 108) AS invTime,
          CONVERT(NVARCHAR(20), h.isActive) AS isActive,
          d.EmpID, d.ProID, d.Qty, d.SPrice, d.SValue
        FROM dbo.TblinvServHead h
        INNER JOIN dbo.TblinvServDetail d
          ON h.invID   = d.invID
         AND h.invType = d.invType
        WHERE CAST(h.invDate AS date) >= @fromDate
          AND CAST(h.invDate AS date) <= @toDate
          AND h.invType = N'مبيعات'
          AND ${branchFilterSql}
        ORDER BY h.invDate DESC, h.invTime DESC
      `);
    const sampleRows = sampleRes.recordset;

    const distinctInvTypesForRange = await bindBranchIds(db.request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate',   sql.Date, toDate))
      .query(`
        SELECT DISTINCT h.invType, COUNT(*) AS cnt
        FROM dbo.TblinvServHead h
        WHERE CAST(h.invDate AS date) >= @fromDate
          AND CAST(h.invDate AS date) <= @toDate
          AND ${branchFilterSql}
        GROUP BY h.invType
        ORDER BY cnt DESC
      `);

    console.log(`[employee-services] debug salesHeadsCount=${salesHeadsCount} salesDetailsCount=${salesDetailsCount} fromDate=${fromDate} toDate=${toDate}`);
    if (sampleRows.length > 0) {
      console.log('[employee-services] sample row[0]:', JSON.stringify(sampleRows[0]));
    }

    // ── Step 3: Build & run the main query ───────────────────────────────────
    const request = bindBranchIds(db.request()
      .input('fromDate',   sql.Date, fromDate)
      .input('toDate',     sql.Date, toDate)
      .input('employeeId', sql.Int,  employeeId));

    const serviceNameArExpr = proNameArCol
      ? `ISNULL(p.${proNameArCol}, N'')`
      : `N''`;

    const lineTotalExpr = `
      CASE
        WHEN ISNULL(d.SValue, 0) > 0
          THEN ISNULL(d.SValue, 0) - ISNULL(d.DisVal, 0)
        ELSE (ISNULL(d.Qty, 1) * ISNULL(d.SPrice, 0)) - ISNULL(d.DisVal, 0)
      END
    `;

    const baseDateWhere = `
      CAST(h.invDate AS date) >= @fromDate
      AND CAST(h.invDate AS date) <= @toDate
      AND h.invType = N'مبيعات'
      AND ${branchFilterSql}
    `;

    const headersResult = await bindBranchIds(db.request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate', sql.Date, toDate))
      .query(`
        SELECT
          h.invID,
          h.invType,
          ISNULL(h.SubTotal, 0)    AS SubTotal,
          ISNULL(h.GrandTotal, 0)  AS GrandTotal,
          ISNULL(h.DisVal, 0)      AS DisVal
        FROM dbo.TblinvServHead h
        WHERE ${baseDateWhere}
      `);

    const allocationLinesResult = await bindBranchIds(db.request()
      .input('fromDate', sql.Date, fromDate)
      .input('toDate', sql.Date, toDate))
      .query(`
        SELECT
          d.ID                                                        AS DetailID,
          d.EmpID,
          e.${empNameCol}                                             AS EmpName,
          h.invID,
          h.invType,
          d.ProID,
          ISNULL(d.Qty, 1)                                            AS Qty,
          ISNULL(d.SValue, 0)                                         AS SValue,
          ISNULL(d.SPrice, 0)                                         AS UnitPrice,
          ISNULL(d.DisVal, 0)                                         AS DiscountValue,
          ${lineTotalExpr}                                            AS LineTotal
        FROM dbo.TblinvServDetail d
        INNER JOIN dbo.TblinvServHead h
          ON h.invID = d.invID AND h.invType = d.invType
        LEFT JOIN dbo.TblEmp e ON e.EmpID = d.EmpID
        WHERE ${baseDateWhere}
          AND d.EmpID IS NOT NULL
          AND d.ProID IS NOT NULL
      `);

    const allocation = allocateEmployeeInvoiceRevenue(
      headersResult.recordset.map((h: any) => ({
        invID: h.invID,
        invType: h.invType,
        subTotal: h.SubTotal,
        grandTotal: h.GrandTotal,
        disVal: h.DisVal,
      })),
      allocationLinesResult.recordset.map((r: any) => ({
        detailId: r.DetailID,
        invID: r.invID,
        invType: r.invType,
        empId: r.EmpID,
        empName: r.EmpName ?? '',
        proId: r.ProID,
        qty: r.Qty,
        unitPrice: r.UnitPrice,
        discountValue: r.DiscountValue,
        sValue: r.SValue,
        lineTotal: r.LineTotal,
      }))
    );

    const allocationByDetailId = new Map<number, AllocatedDetailLine>(
      allocation.allocatedLines.map((line) => [line.detailId, line])
    );

    const mainQuery = `
      WITH ServiceLines AS (
        SELECT
          d.ID                                                        AS DetailID,
          d.EmpID,
          e.${empNameCol}                                           AS EmpName,
          h.invID,
          h.invType,
          CAST(h.invDate AS date)                                    AS OperationDate,
          CONVERT(VARCHAR(8), h.invTime, 108)                        AS OperationTime,
          d.ProID,
          p.${proNameCol}                                            AS ServiceName,
          ${serviceNameArExpr}                                       AS ServiceNameAr,
          ISNULL(d.Qty,    1)                                        AS Qty,
          ISNULL(d.SValue, 0)                                        AS SValue,
          ISNULL(d.SPrice, 0)                                        AS UnitPrice,
          ISNULL(d.DisVal, 0)                                        AS DiscountValue,
          ${lineTotalExpr}                                            AS LineTotal,
          ISNULL(h.SubTotal, 0)                                      AS InvoiceSubTotal,
          ISNULL(h.GrandTotal, 0)                                    AS InvoiceGrandTotal,
          ${clientNameExpr}                                           AS ClientName,
          ISNULL(d.Notes, N'')                                        AS Notes
        FROM dbo.TblinvServDetail d
        INNER JOIN dbo.TblinvServHead h
          ON h.invID   = d.invID
         AND h.invType = d.invType
        LEFT JOIN dbo.TblEmp e  ON e.EmpID = d.EmpID
        LEFT JOIN dbo.TblPro p  ON p.ProID = d.ProID
        ${clientJoin}
        WHERE
          ${baseDateWhere}
          AND (@employeeId IS NULL OR d.EmpID = @employeeId)
          AND d.EmpID IS NOT NULL
          AND d.ProID IS NOT NULL
      )
      SELECT * FROM ServiceLines
      ORDER BY OperationDate DESC, OperationTime DESC, EmpName ASC;
    `;

    const rawResult = await request.query(mainQuery);
    const rows: any[] = rawResult.recordset;

    // ── Step 3: Build summary + employee aggregates in JS ────────────────────
    const empMap: Record<number, {
      empId: number; empName: string;
      servicesCount: number; invoicesCount: number;
      totalAmount: number; lastOperationDate: string;
      invoiceSet: Set<string>;
    }> = {};

    let totalAmount   = 0;
    let totalServices = 0;
    const invoiceSet  = new Set<string>();

    for (const r of rows) {
      const lineTotal = calculateServiceLineTotal({
        qty: r.Qty,
        unitPrice: r.UnitPrice,
        discountValue: r.DiscountValue,
        sValue: r.SValue,
      });
      r.LineTotal = lineTotal;

      totalAmount   += lineTotal;
      totalServices += 1;
      invoiceSet.add(`${r.invType}-${r.invID}`);

      if (!empMap[r.EmpID]) {
        empMap[r.EmpID] = {
          empId: r.EmpID,
          empName: r.EmpName ?? '',
          servicesCount: 0,
          invoicesCount: 0,
          totalAmount: 0,
          lastOperationDate: '',
          invoiceSet: new Set(),
        };
      }
      const emp = empMap[r.EmpID];
      emp.servicesCount   += 1;
      emp.totalAmount     += lineTotal;
      emp.invoiceSet.add(`${r.invType}-${r.invID}`);
      if (!emp.lastOperationDate || r.OperationDate > emp.lastOperationDate) {
        emp.lastOperationDate = r.OperationDate ?? '';
      }
    }

    const revenueByEmployee = new Map(
      allocation.employeeTotals.map((row) => [row.employeeId, row])
    );

    const filteredEmployeeTotals = employeeId != null
      ? allocation.employeeTotals.filter((row) => row.employeeId === employeeId)
      : allocation.employeeTotals;

    const filteredRevenueTotals = employeeId != null
      ? {
          totalGrossServiceRevenue: roundMoney(
            filteredEmployeeTotals.reduce((sum, row) => sum + row.grossServiceRevenue, 0)
          ),
          totalAllocatedInvoiceDiscount: roundMoney(
            filteredEmployeeTotals.reduce((sum, row) => sum + row.allocatedInvoiceDiscount, 0)
          ),
          totalActualInvoiceRevenue: roundMoney(
            filteredEmployeeTotals.reduce((sum, row) => sum + row.actualInvoiceRevenue, 0)
          ),
          unattributedInvoiceRevenue: allocation.reportTotals.unattributedInvoiceRevenue,
          treasuryComparableRevenue: allocation.reportTotals.treasuryComparableRevenue,
        }
      : allocation.reportTotals;

    const employees = Object.values(empMap).map(emp => {
      const revenue = revenueByEmployee.get(emp.empId);
      const grossServiceRevenue = revenue?.grossServiceRevenue ?? roundMoney(emp.totalAmount);
      const allocatedInvoiceDiscount = revenue?.allocatedInvoiceDiscount ?? 0;
      const actualInvoiceRevenue = revenue?.actualInvoiceRevenue ?? grossServiceRevenue;

      return {
        empId:             emp.empId,
        empName:           emp.empName,
        employeeId:        emp.empId,
        employeeName:      emp.empName,
        servicesCount:     emp.servicesCount,
        invoicesCount:     emp.invoiceSet.size,
        serviceCount:      emp.servicesCount,
        invoiceCount:      emp.invoiceSet.size,
        totalAmount:       roundMoney(emp.totalAmount),
        grossServiceRevenue,
        allocatedInvoiceDiscount,
        actualInvoiceRevenue,
        avgServiceValue:   emp.servicesCount > 0
          ? roundMoney(emp.totalAmount / emp.servicesCount)
          : 0,
        lastOperationDate: emp.lastOperationDate,
      };
    }).sort((a, b) => b.grossServiceRevenue - a.grossServiceRevenue);

    const topByAmount   = employees[0] ?? null;
    const topByServices = [...employees].sort((a, b) => b.servicesCount - a.servicesCount)[0] ?? null;

    const summary = {
      totalAmount:    roundMoney(totalAmount),
      totalGrossServiceRevenue: filteredRevenueTotals.totalGrossServiceRevenue,
      totalAllocatedInvoiceDiscount: filteredRevenueTotals.totalAllocatedInvoiceDiscount,
      totalActualInvoiceRevenue: filteredRevenueTotals.totalActualInvoiceRevenue,
      unattributedInvoiceRevenue: filteredRevenueTotals.unattributedInvoiceRevenue,
      treasuryComparableRevenue: filteredRevenueTotals.treasuryComparableRevenue,
      totalServices,
      totalInvoices:  invoiceSet.size,
      activeEmployees: employees.length,
      topEmployeeByAmount: topByAmount ? {
        empId: topByAmount.empId,
        empName: topByAmount.empName,
        totalAmount: topByAmount.totalAmount,
      } : null,
      topEmployeeByServices: topByServices ? {
        empId: topByServices.empId,
        empName: topByServices.empName,
        totalServices: topByServices.servicesCount,
      } : null,
    };

    const breakdownLines = rows.map(r => ({
      empId: r.EmpID,
      empName: r.EmpName ?? '',
      proId: r.ProID,
      serviceName: r.ServiceName ?? '',
      serviceNameAr: r.ServiceNameAr ?? '',
      qty: r.Qty,
      unitPrice: r.UnitPrice,
      discountValue: r.DiscountValue,
      sValue: r.SValue,
      lineTotal: r.LineTotal,
    }));

    const serviceBreakdown = aggregateEmployeeServiceBreakdown(breakdownLines).map((row) => {
      const revenue = revenueByEmployee.get(row.employeeId);
      return {
        ...row,
        grossServiceRevenue: revenue?.grossServiceRevenue ?? row.totalRevenue,
        allocatedInvoiceDiscount: revenue?.allocatedInvoiceDiscount ?? 0,
        actualInvoiceRevenue: revenue?.actualInvoiceRevenue ?? row.totalRevenue,
        invoiceCount: revenue?.invoiceCount ?? 0,
        serviceCount: revenue?.serviceCount ?? 0,
      };
    });
    const classifiedLines = classifyServiceLines(breakdownLines);

    const details = rows.map((r, index) => {
      const classified = classifiedLines[index];
      const allocated = allocationByDetailId.get(r.DetailID);
      return {
        empId:           r.EmpID,
        empName:         r.EmpName ?? '',
        detailId:        r.DetailID,
        invoiceId:       r.invID,
        invoiceType:     r.invType ?? '',
        operationDate:   r.OperationDate,
        operationTime:   r.OperationTime ?? '',
        serviceId:       r.ProID,
        serviceName:     r.ServiceName ?? '',
        serviceNameAr:   r.ServiceNameAr ?? '',
        qty:             r.Qty,
        unitPrice:       r.UnitPrice,
        discountValue:   r.DiscountValue,
        lineTotal:       classified.lineTotal,
        grossServiceValue: allocated?.grossServiceValue ?? classified.lineTotal,
        allocatedInvoiceDiscount: allocated?.allocatedInvoiceDiscount ?? 0,
        actualInvoiceRevenue: allocated?.actualInvoiceRevenue ?? classified.lineTotal,
        invoiceGrandTotal: allocated?.invoiceGrandTotal ?? r.InvoiceGrandTotal ?? 0,
        invoiceSubTotal: allocated?.invoiceSubTotal ?? r.InvoiceSubTotal ?? 0,
        otherEmployeesOnInvoice: allocated?.otherEmployeesOnInvoice ?? [],
        clientName:      r.ClientName ?? '',
        notes:           r.Notes ?? '',
        serviceCategory: classified.serviceCategory,
      };
    });

    return NextResponse.json({
      summary,
      employees,
      serviceBreakdown,
      revenueTotals: filteredRevenueTotals,
      details,
      scope: reportScopeMetadata(scope),
      _meta: {
        fromDate,
        toDate,
        resolvedColumns: { empNameCol, proNameCol, proNameArCol, clientNameCol },
        hasIsActiveColumn: hasIsActive,
        isActiveFilterApplied,
        invTypesFound: invTypes,
        salesHeadsCount,
        salesDetailsCount,
        distinctInvTypesForRange: distinctInvTypesForRange.recordset,
        sampleRows,
      },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/reports/employee-services] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
