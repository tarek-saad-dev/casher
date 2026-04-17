import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { TodaySalesData, TodaySalesKPI, ShiftSales, PaymentMethodSales, BarberSales, ServiceSales, HourlySales, TodaySaleTransaction } from '@/lib/types/today-sales';

/**
 * GET /api/sales/today
 * Comprehensive daily sales analysis endpoint
 * 
 * Query params:
 * - date: YYYY-MM-DD (defaults to current open business day)
 * - shiftMoveId: filter by specific shift
 * - paymentMethodId: filter by payment method
 * - empId: filter by barber
 */
// Helper functions for consistent filter logic
const activeSalesCondition = (alias: string) => `ISNULL(${alias}.isActive, 'no') = 'no'`;
const dateFilter = (alias: string) => `CAST(${alias}.invDate AS DATE) = @targetDate`;

export async function GET(request: NextRequest) {
  let db;

  try {
    db = await getPool();
    const searchParams = request.nextUrl.searchParams;
    
    // Get target date
    let targetDate = searchParams.get('date');
    if (!targetDate) {
      // Default to current open business day
      const dayResult = await db.request().query(`
        SELECT TOP 1 NewDay FROM [dbo].[TblNewDay] 
        WHERE Status = 1 
        ORDER BY ID DESC
      `);
      if (dayResult.recordset.length > 0) {
        const dbDate = dayResult.recordset[0].NewDay;
        // Format date properly if it's a Date object
        targetDate = dbDate instanceof Date 
          ? dbDate.toISOString().split('T')[0] 
          : dbDate;
      } else {
        // Fallback to today
        targetDate = new Date().toISOString().split('T')[0];
      }
    }
    
    console.log('[api/sales/today] Target date:', targetDate);

    // Filters
    const shiftMoveIdFilter = searchParams.get('shiftMoveId') ? parseInt(searchParams.get('shiftMoveId')!) : null;
    const paymentMethodIdFilter = searchParams.get('paymentMethodId') ? parseInt(searchParams.get('paymentMethodId')!) : null;
    const empIdFilter = searchParams.get('empId') ? parseInt(searchParams.get('empId')!) : null;

    // Build WHERE clause (CRITICAL: Use CAST for date comparison)
    let whereConditions = [dateFilter('h'), `h.invType = N'مبيعات'`, activeSalesCondition('h')];
    if (shiftMoveIdFilter) whereConditions.push('h.ShiftMoveID = @shiftMoveId');
    if (paymentMethodIdFilter) whereConditions.push('h.PaymentMethodID = @paymentMethodId');
    
    const whereClause = whereConditions.join(' AND ');
    const detailWhereClause = empIdFilter 
      ? `${whereConditions.join(' AND ')} AND d.EmpID = @empId`
      : whereConditions.join(' AND ');

    // ═══════════════════════════════════════════════════════════
    // 1. KPI SUMMARY
    // ═══════════════════════════════════════════════════════════
    
    const kpiRequest = db.request();
    kpiRequest.input('targetDate', sql.Date, targetDate);
    if (shiftMoveIdFilter) kpiRequest.input('shiftMoveId', sql.Int, shiftMoveIdFilter);
    if (paymentMethodIdFilter) kpiRequest.input('paymentMethodId', sql.Int, paymentMethodIdFilter);

    const kpiResult = await kpiRequest.query(`
      SELECT 
        COUNT(*) AS invoiceCount,
        ISNULL(SUM(h.GrandTotal), 0) AS totalSales,
        COUNT(DISTINCT h.ClientID) AS customerCount
      FROM [dbo].[TblinvServHead] h
      WHERE ${whereClause}
    `);

    const kpiRow = kpiResult.recordset[0];
    const totalSales = kpiRow.totalSales;
    const invoiceCount = kpiRow.invoiceCount;
    const averageInvoice = invoiceCount > 0 ? totalSales / invoiceCount : 0;
    const customerCount = kpiRow.customerCount;

    // Top shift
    const topShiftReq = db.request();
    topShiftReq.input('targetDate', sql.Date, targetDate);
    const topShiftResult = await topShiftReq.query(`
      SELECT TOP 1 s.ShiftName
      FROM [dbo].[TblinvServHead] h
      INNER JOIN [dbo].[TblShiftMove] sm ON h.ShiftMoveID = sm.ID
      INNER JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
      WHERE ${dateFilter('h')} AND h.invType = N'مبيعات' AND ${activeSalesCondition('h')}
      GROUP BY s.ShiftName
      ORDER BY SUM(h.GrandTotal) DESC
    `);
    const topShift = topShiftResult.recordset.length > 0 ? topShiftResult.recordset[0].ShiftName : null;

    // Top payment method
    const topPaymentReq = db.request();
    topPaymentReq.input('targetDate', sql.Date, targetDate);
    const topPaymentResult = await topPaymentReq.query(`
      WITH HeadInvoices AS (
        SELECT
          h.invID,
          h.invType,
          h.PaymentMethodID,
          PayValue = COALESCE(NULLIF(h.Payment, 0), h.GrandTotal, 0)
        FROM [dbo].[TblinvServHead] h
        WHERE ${dateFilter('h')} AND h.invType = N'مبيعات' AND ${activeSalesCondition('h')}
      ),
      PaymentRows AS (
        SELECT
          p.invID,
          p.invType,
          p.PaymentMethodID,
          PayValue = ISNULL(p.PayValue, 0)
        FROM [dbo].[TblinvServPayment] p
        INNER JOIN HeadInvoices h
          ON h.invID = p.invID AND h.invType = p.invType
        WHERE ISNULL(p.PayValue, 0) > 0
      ),
      FallbackRows AS (
        SELECT
          h.invID,
          h.invType,
          h.PaymentMethodID,
          h.PayValue
        FROM HeadInvoices h
        WHERE h.PaymentMethodID IS NOT NULL
          AND h.PayValue > 0
          AND NOT EXISTS (
            SELECT 1 FROM [dbo].[TblinvServPayment] p
            WHERE p.invID = h.invID AND p.invType = h.invType AND ISNULL(p.PayValue, 0) > 0
          )
      ),
      NormalizedPayments AS (
        SELECT invID, invType, PaymentMethodID, PayValue FROM PaymentRows
        UNION ALL
        SELECT invID, invType, PaymentMethodID, PayValue FROM FallbackRows
      )
      SELECT TOP 1 pm.PaymentMethod
      FROM NormalizedPayments np
      INNER JOIN [dbo].[TblPaymentMethods] pm ON np.PaymentMethodID = pm.PaymentID
      GROUP BY pm.PaymentMethod
      ORDER BY SUM(np.PayValue) DESC
    `);
    const topPaymentMethod = topPaymentResult.recordset.length > 0 ? topPaymentResult.recordset[0].PaymentMethod : null;

    // Top barber
    const topBarberReq = db.request();
    topBarberReq.input('targetDate', sql.Date, targetDate);
    const topBarberResult = await topBarberReq.query(`
      SELECT TOP 1 e.EmpName
      FROM [dbo].[TblinvServHead] h
      INNER JOIN [dbo].[TblinvServDetail] d ON h.invID = d.invID AND h.invType = d.invType
      INNER JOIN [dbo].[TblEmp] e ON d.EmpID = e.EmpID
      WHERE ${dateFilter('h')} AND h.invType = N'مبيعات' AND ${activeSalesCondition('h')}
      GROUP BY e.EmpName
      ORDER BY SUM(d.SPriceAfterDis) DESC
    `);
    const topBarber = topBarberResult.recordset.length > 0 ? topBarberResult.recordset[0].EmpName : null;

    // Top service
    const topServiceReq = db.request();
    topServiceReq.input('targetDate', sql.Date, targetDate);
    const topServiceResult = await topServiceReq.query(`
      SELECT TOP 1 p.ProName
      FROM [dbo].[TblinvServHead] h
      INNER JOIN [dbo].[TblinvServDetail] d ON h.invID = d.invID AND h.invType = d.invType
      INNER JOIN [dbo].[TblPro] p ON d.ProID = p.ProID
      WHERE ${dateFilter('h')} AND h.invType = N'مبيعات' AND ${activeSalesCondition('h')}
      GROUP BY p.ProName
      ORDER BY SUM(d.SPriceAfterDis) DESC
    `);
    const topService = topServiceResult.recordset.length > 0 ? topServiceResult.recordset[0].ProName : null;

    const kpi: TodaySalesKPI = {
      totalSales,
      invoiceCount,
      averageInvoice,
      customerCount,
      topShift,
      topPaymentMethod,
      topBarber,
      topService
    };

    // ═══════════════════════════════════════════════════════════
    // 2. BY SHIFT
    // ═══════════════════════════════════════════════════════════

    const shiftReq = db.request();
    shiftReq.input('targetDate', sql.Date, targetDate);
    if (shiftMoveIdFilter) shiftReq.input('shiftMoveId', sql.Int, shiftMoveIdFilter);
    if (paymentMethodIdFilter) shiftReq.input('paymentMethodId', sql.Int, paymentMethodIdFilter);

    console.log('[api/sales/today] Fetching ALL shifts for date:', targetDate);
    
    const shiftResult = await shiftReq.query(`
      SELECT 
        sm.ID AS shiftMoveId,
        s.ShiftName,
        u.UserName,
        sm.Status,
        COUNT(h.invID) AS invoiceCount,
        ISNULL(SUM(h.GrandTotal), 0) AS totalSales
      FROM [dbo].[TblShiftMove] sm
      INNER JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
      INNER JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
      LEFT JOIN [dbo].[TblinvServHead] h ON h.ShiftMoveID = sm.ID 
        AND h.invType = N'مبيعات' 
        AND ${activeSalesCondition('h')}
        ${paymentMethodIdFilter ? 'AND h.PaymentMethodID = @paymentMethodId' : ''}
      WHERE CAST(sm.NewDay AS DATE) = @targetDate
        ${shiftMoveIdFilter ? 'AND sm.ID = @shiftMoveId' : ''}
      GROUP BY sm.ID, s.ShiftName, u.UserName, sm.Status
      ORDER BY sm.ID
    `);
    
    console.log(`[api/sales/today] Found ${shiftResult.recordset.length} shift(s) for ${targetDate}`);
    shiftResult.recordset.forEach((s: any) => {
      console.log(`  - Shift ${s.shiftMoveId}: ${s.ShiftName} (${s.UserName}) - Invoices: ${s.invoiceCount}, Total: ${s.totalSales}`);
    });
    
    // Get top barber and payment method for each shift separately
    for (const shift of shiftResult.recordset) {
      // Top barber for this shift
      const topBarberReq = db.request();
      topBarberReq.input('shiftMoveId', sql.Int, shift.shiftMoveId);
      topBarberReq.input('targetDate', sql.Date, targetDate);
      
      const topBarberResult = await topBarberReq.query(`
        SELECT TOP 1 e.EmpName
        FROM [dbo].[TblinvServHead] h3
        INNER JOIN [dbo].[TblinvServDetail] d3 ON h3.invID = d3.invID AND h3.invType = d3.invType
        INNER JOIN [dbo].[TblEmp] e ON d3.EmpID = e.EmpID
        WHERE h3.ShiftMoveID = @shiftMoveId 
          AND h3.invType = N'مبيعات'
          AND ${activeSalesCondition('h3')}
        GROUP BY e.EmpName
        ORDER BY SUM(d3.SPriceAfterDis) DESC
      `);
      shift.topBarber = topBarberResult.recordset.length > 0 ? topBarberResult.recordset[0].EmpName : null;
      
      // Top payment method for this shift
      const topPaymentReq = db.request();
      topPaymentReq.input('shiftMoveId', sql.Int, shift.shiftMoveId);
      topPaymentReq.input('targetDate', sql.Date, targetDate);
      
      const topPaymentResult = await topPaymentReq.query(`
        WITH HeadInvoices AS (
          SELECT
            h2.invID,
            h2.invType,
            h2.PaymentMethodID,
            PayValue = COALESCE(NULLIF(h2.Payment, 0), h2.GrandTotal, 0)
          FROM [dbo].[TblinvServHead] h2
          WHERE h2.ShiftMoveID = @shiftMoveId 
            AND h2.invType = N'مبيعات'
            AND ${activeSalesCondition('h2')}
        ),
        PaymentRows AS (
          SELECT
            p.invID,
            p.invType,
            p.PaymentMethodID,
            PayValue = ISNULL(p.PayValue, 0)
          FROM [dbo].[TblinvServPayment] p
          INNER JOIN HeadInvoices h ON h.invID = p.invID AND h.invType = p.invType
          WHERE ISNULL(p.PayValue, 0) > 0
            AND ISNULL(p.ShiftMoveID, @shiftMoveId) = @shiftMoveId
        ),
        FallbackRows AS (
          SELECT
            h.invID,
            h.invType,
            h.PaymentMethodID,
            h.PayValue
          FROM HeadInvoices h
          WHERE h.PaymentMethodID IS NOT NULL
            AND h.PayValue > 0
            AND NOT EXISTS (
              SELECT 1 FROM [dbo].[TblinvServPayment] p
              WHERE p.invID = h.invID AND p.invType = h.invType AND ISNULL(p.PayValue, 0) > 0
            )
        ),
        NormalizedPayments AS (
          SELECT invID, invType, PaymentMethodID, PayValue FROM PaymentRows
          UNION ALL
          SELECT invID, invType, PaymentMethodID, PayValue FROM FallbackRows
        )
        SELECT TOP 1 pm2.PaymentMethod
        FROM NormalizedPayments np
        INNER JOIN [dbo].[TblPaymentMethods] pm2 ON np.PaymentMethodID = pm2.PaymentID
        GROUP BY pm2.PaymentMethod
        ORDER BY SUM(np.PayValue) DESC
      `);
      shift.topPaymentMethod = topPaymentResult.recordset.length > 0 ? topPaymentResult.recordset[0].PaymentMethod : null;
    }

    const byShift: ShiftSales[] = shiftResult.recordset.map((row: any) => ({
      shiftMoveId: row.shiftMoveId,
      shiftName: row.ShiftName,
      userName: row.UserName,
      totalSales: row.totalSales,
      invoiceCount: row.invoiceCount,
      averageInvoice: row.invoiceCount > 0 ? row.totalSales / row.invoiceCount : 0,
      percentageOfTotal: totalSales > 0 ? (row.totalSales / totalSales) * 100 : 0,
      topBarber: row.topBarber,
      topPaymentMethod: row.topPaymentMethod
    }));

    // ═══════════════════════════════════════════════════════════
    // 3. BY PAYMENT METHOD
    // ═══════════════════════════════════════════════════════════

    const paymentReq = db.request();
    paymentReq.input('targetDate', sql.Date, targetDate);
    if (shiftMoveIdFilter) paymentReq.input('shiftMoveId', sql.Int, shiftMoveIdFilter);
    if (paymentMethodIdFilter) paymentReq.input('paymentMethodId', sql.Int, paymentMethodIdFilter);

    const paymentResult = await paymentReq.query(`
      -- Payment source hierarchy: use payment rows if exist, else header fallback
      WITH HeadInvoices AS (
        SELECT
          h.invID,
          h.invType,
          h.ShiftMoveID,
          h.PaymentMethodID,
          PayValue = COALESCE(NULLIF(h.Payment, 0), h.GrandTotal, 0)
        FROM [dbo].[TblinvServHead] h
        WHERE ${whereClause}
      ),
      PaymentRows AS (
        -- If system recorded actual payment rows / split payments
        SELECT
          p.invID,
          p.invType,
          p.PaymentMethodID,
          PayValue = ISNULL(p.PayValue, 0)
        FROM [dbo].[TblinvServPayment] p
        INNER JOIN HeadInvoices h
          ON h.invID = p.invID
          AND h.invType = p.invType
        WHERE ISNULL(p.PayValue, 0) > 0
          ${shiftMoveIdFilter ? 'AND ISNULL(p.ShiftMoveID, h.ShiftMoveID) = @shiftMoveId' : ''}
      ),
      FallbackRows AS (
        -- If no payment rows exist, fallback to header
        SELECT
          h.invID,
          h.invType,
          h.PaymentMethodID,
          h.PayValue
        FROM HeadInvoices h
        WHERE h.PaymentMethodID IS NOT NULL
          AND h.PayValue > 0
          AND NOT EXISTS (
            SELECT 1
            FROM [dbo].[TblinvServPayment] p
            WHERE p.invID = h.invID
              AND p.invType = h.invType
              AND ISNULL(p.PayValue, 0) > 0
          )
      ),
      NormalizedPayments AS (
        SELECT invID, invType, PaymentMethodID, PayValue
        FROM PaymentRows
        UNION ALL
        SELECT invID, invType, PaymentMethodID, PayValue
        FROM FallbackRows
      ),
      MethodInvoiceTotals AS (
        SELECT
          PaymentMethodID,
          invID,
          invType,
          SUM(PayValue) AS InvoiceAmount
        FROM NormalizedPayments
        GROUP BY PaymentMethodID, invID, invType
      )
      SELECT
        pm.PaymentID,
        pm.PaymentMethod,
        COUNT(*) AS invoiceCount,
        SUM(mit.InvoiceAmount) AS totalAmount
      FROM MethodInvoiceTotals mit
      INNER JOIN [dbo].[TblPaymentMethods] pm
        ON pm.PaymentID = mit.PaymentMethodID
      GROUP BY pm.PaymentID, pm.PaymentMethod
      ORDER BY totalAmount DESC, pm.PaymentMethod
    `);

    const byPaymentMethod: PaymentMethodSales[] = paymentResult.recordset.map((row: any) => ({
      paymentMethodId: row.PaymentID,
      paymentMethodName: row.PaymentMethod,
      totalAmount: row.totalAmount,
      invoiceCount: row.invoiceCount,
      percentageOfTotal: totalSales > 0 ? (row.totalAmount / totalSales) * 100 : 0,
      averageTransaction: row.invoiceCount > 0 ? row.totalAmount / row.invoiceCount : 0
    }));
    
    console.log('[api/sales/today] Payment breakdown:');
    byPaymentMethod.forEach(pm => {
      console.log(`  - ${pm.paymentMethodName}: ${pm.invoiceCount} invoices, ${pm.totalAmount} total`);
    });

    // ═══════════════════════════════════════════════════════════
    // 4. BY BARBER
    // ═══════════════════════════════════════════════════════════

    const barberReq = db.request();
    barberReq.input('targetDate', sql.Date, targetDate);
    if (shiftMoveIdFilter) barberReq.input('shiftMoveId', sql.Int, shiftMoveIdFilter);
    if (paymentMethodIdFilter) barberReq.input('paymentMethodId', sql.Int, paymentMethodIdFilter);
    if (empIdFilter) barberReq.input('empId', sql.Int, empIdFilter);

    const barberResult = await barberReq.query(`
      SELECT 
        e.EmpID,
        e.EmpName,
        COUNT(d.ProID) AS serviceCount,
        COUNT(DISTINCT h.invID) AS invoiceContribution,
        ISNULL(SUM(d.SPriceAfterDis), 0) AS totalSales
      FROM [dbo].[TblinvServHead] h
      INNER JOIN [dbo].[TblinvServDetail] d ON h.invID = d.invID AND h.invType = d.invType
      INNER JOIN [dbo].[TblEmp] e ON d.EmpID = e.EmpID
      WHERE ${detailWhereClause}
      GROUP BY e.EmpID, e.EmpName
      ORDER BY totalSales DESC
    `);
    
    // Get top service for each barber separately
    for (const barber of barberResult.recordset) {
      const topServiceReq = db.request();
      topServiceReq.input('empId', sql.Int, barber.EmpID);
      topServiceReq.input('targetDate', sql.Date, targetDate);
      
      const topServiceResult = await topServiceReq.query(`
        SELECT TOP 1 p.ProName
        FROM [dbo].[TblinvServHead] h4
        INNER JOIN [dbo].[TblinvServDetail] d4 ON h4.invID = d4.invID AND h4.invType = d4.invType
        INNER JOIN [dbo].[TblPro] p ON d4.ProID = p.ProID
        WHERE d4.EmpID = @empId
          AND ${dateFilter('h4')}
          AND h4.invType = N'مبيعات'
          AND ${activeSalesCondition('h4')}
        GROUP BY p.ProName
        ORDER BY SUM(d4.SPriceAfterDis) DESC
      `);
      barber.topService = topServiceResult.recordset.length > 0 ? topServiceResult.recordset[0].ProName : null;
    }

    const barberTotal = barberResult.recordset.reduce((sum: number, row: any) => sum + row.totalSales, 0);
    const byBarber: BarberSales[] = barberResult.recordset.map((row: any) => ({
      empId: row.EmpID,
      empName: row.EmpName,
      totalSales: row.totalSales,
      serviceCount: row.serviceCount,
      invoiceContribution: row.invoiceContribution,
      averageSale: row.serviceCount > 0 ? row.totalSales / row.serviceCount : 0,
      topService: row.topService,
      percentageOfTotal: barberTotal > 0 ? (row.totalSales / barberTotal) * 100 : 0
    }));

    // ═══════════════════════════════════════════════════════════
    // 5. BY SERVICE
    // ═══════════════════════════════════════════════════════════

    const serviceReq = db.request();
    serviceReq.input('targetDate', sql.Date, targetDate);
    if (shiftMoveIdFilter) serviceReq.input('shiftMoveId', sql.Int, shiftMoveIdFilter);
    if (paymentMethodIdFilter) serviceReq.input('paymentMethodId', sql.Int, paymentMethodIdFilter);
    if (empIdFilter) serviceReq.input('empId', sql.Int, empIdFilter);

    const serviceResult = await serviceReq.query(`
      SELECT 
        p.ProID,
        p.ProName,
        COUNT(*) AS timesSold,
        ISNULL(SUM(d.Qty), 0) AS quantitySold,
        ISNULL(SUM(d.SPriceAfterDis), 0) AS totalSales
      FROM [dbo].[TblinvServHead] h
      INNER JOIN [dbo].[TblinvServDetail] d ON h.invID = d.invID AND h.invType = d.invType
      INNER JOIN [dbo].[TblPro] p ON d.ProID = p.ProID
      WHERE ${detailWhereClause}
      GROUP BY p.ProID, p.ProName
      ORDER BY totalSales DESC
    `);

    const serviceTotal = serviceResult.recordset.reduce((sum: number, row: any) => sum + row.totalSales, 0);
    const byService: ServiceSales[] = serviceResult.recordset.map((row: any) => ({
      proId: row.ProID,
      proName: row.ProName,
      totalSales: row.totalSales,
      quantitySold: row.quantitySold,
      timesSold: row.timesSold,
      percentageOfTotal: serviceTotal > 0 ? (row.totalSales / serviceTotal) * 100 : 0,
      averagePrice: row.timesSold > 0 ? row.totalSales / row.timesSold : 0
    }));

    // ═══════════════════════════════════════════════════════════
    // 6. BY HOUR
    // ═══════════════════════════════════════════════════════════

    const hourReq = db.request();
    hourReq.input('targetDate', sql.Date, targetDate);
    if (shiftMoveIdFilter) hourReq.input('shiftMoveId', sql.Int, shiftMoveIdFilter);
    if (paymentMethodIdFilter) hourReq.input('paymentMethodId', sql.Int, paymentMethodIdFilter);
    if (empIdFilter) hourReq.input('empId', sql.Int, empIdFilter);

    const hourResult = await hourReq.query(`
      SELECT 
        h.invTime,
        h.invID,
        h.invType,
        h.GrandTotal,
        pm.PaymentMethod
      FROM [dbo].[TblinvServHead] h
      LEFT JOIN [dbo].[TblPaymentMethods] pm ON h.PaymentMethodID = pm.PaymentID
      WHERE ${whereClause}
      ORDER BY h.invTime
    `);
    
    // Get top barber for each invoice in one query (optimize N+1 query problem)
    const invoiceBarbers = new Map<number, string>();
    if (hourResult.recordset.length > 0) {
      const invIds = hourResult.recordset.map(r => r.invID).join(',');
      const barberBatchReq = db.request();
      barberBatchReq.input('targetDate', sql.Date, targetDate);
      
      const barberBatchResult = await barberBatchReq.query(`
        SELECT 
          h5.invID,
          (
            SELECT TOP 1 e.EmpName
            FROM [dbo].[TblinvServDetail] d5
            INNER JOIN [dbo].[TblEmp] e ON d5.EmpID = e.EmpID
            WHERE d5.invID = h5.invID AND d5.invType = h5.invType
            GROUP BY e.EmpName
            ORDER BY SUM(d5.SPriceAfterDis) DESC
          ) AS TopBarber
        FROM [dbo].[TblinvServHead] h5
        WHERE h5.invID IN (${invIds})
          AND CAST(h5.invDate AS DATE) = @targetDate
          AND h5.invType = N'مبيعات'
      `);
      
      barberBatchResult.recordset.forEach((row: any) => {
        if (row.TopBarber) {
          invoiceBarbers.set(row.invID, row.TopBarber);
        }
      });
    }

    // Group by hour
    const hourMap = new Map<string, any>();
    hourResult.recordset.forEach((row: any) => {
      const time = row.invTime || '';
      const hourStr = time.split('.')[0] || '00'; // Extract hour from "HH.mm" format
      const hour = hourStr.padStart(2, '0');
      
      if (!hourMap.has(hour)) {
        hourMap.set(hour, {
          hour: `${hour}:00`,
          totalSales: 0,
          invoiceCount: 0,
          payments: new Map<string, number>(),
          barbers: new Map<string, number>()
        });
      }
      
      const bucket = hourMap.get(hour);
      bucket.totalSales += row.GrandTotal;
      bucket.invoiceCount += 1;
      
      if (row.PaymentMethod) {
        bucket.payments.set(row.PaymentMethod, (bucket.payments.get(row.PaymentMethod) || 0) + 1);
      }
      
      // Use the pre-fetched barber from the Map
      const barberName = invoiceBarbers.get(row.invID);
      if (barberName) {
        bucket.barbers.set(barberName, (bucket.barbers.get(barberName) || 0) + 1);
      }
    });

    const byHour: HourlySales[] = Array.from(hourMap.entries()).map(([hour, data]) => {
      const paymentEntries = Array.from(data.payments.entries()) as [string, number][];
      const barberEntries = Array.from(data.barbers.entries()) as [string, number][];
      
      const topPayment = paymentEntries.sort((a, b) => b[1] - a[1])[0];
      const topBarber = barberEntries.sort((a, b) => b[1] - a[1])[0];
      
      return {
        hour: data.hour,
        totalSales: data.totalSales,
        invoiceCount: data.invoiceCount,
        topPaymentMethod: topPayment?.[0] ?? null,
        topBarber: topBarber?.[0] ?? null,
        percentageOfTotal: totalSales > 0 ? (data.totalSales / totalSales) * 100 : 0
      };
    }).sort((a, b) => a.hour.localeCompare(b.hour));

    // ═══════════════════════════════════════════════════════════
    // 7. DETAILED TRANSACTIONS
    // ═══════════════════════════════════════════════════════════

    const txnReq = db.request();
    txnReq.input('targetDate', sql.Date, targetDate);
    if (shiftMoveIdFilter) txnReq.input('shiftMoveId', sql.Int, shiftMoveIdFilter);
    if (paymentMethodIdFilter) txnReq.input('paymentMethodId', sql.Int, paymentMethodIdFilter);
    if (empIdFilter) txnReq.input('empId', sql.Int, empIdFilter);

    const txnResult = await txnReq.query(`
      SELECT 
        h.invID,
        h.invDate,
        h.invTime,
        c.[Name] AS clientName,
        h.GrandTotal,
        h.DisVal AS discount,
        pm.PaymentMethod,
        s.ShiftName,
        u.UserName,
        (
          SELECT STRING_AGG(e.EmpName, ', ')
          FROM [dbo].[TblinvServDetail] d
          INNER JOIN [dbo].[TblEmp] e ON d.EmpID = e.EmpID
          WHERE d.invID = h.invID AND d.invType = h.invType
        ) AS barbers,
        (
          SELECT STRING_AGG(p.ProName, ', ')
          FROM [dbo].[TblinvServDetail] d
          INNER JOIN [dbo].[TblPro] p ON d.ProID = p.ProID
          WHERE d.invID = h.invID AND d.invType = h.invType
        ) AS services
      FROM [dbo].[TblinvServHead] h
      LEFT JOIN [dbo].[TblClient] c ON h.ClientID = c.ClientID
      INNER JOIN [dbo].[TblPaymentMethods] pm ON h.PaymentMethodID = pm.PaymentID
      INNER JOIN [dbo].[TblShiftMove] sm ON h.ShiftMoveID = sm.ID
      INNER JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
      INNER JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
      WHERE ${whereClause}
      ORDER BY h.invTime DESC, h.invID DESC
    `);

    const transactions: TodaySaleTransaction[] = txnResult.recordset.map((row: any) => ({
      invId: row.invID,
      invDate: row.invDate,
      invTime: row.invTime || '',
      clientName: row.clientName,
      barbers: row.barbers || 'غير محدد',
      services: row.services || 'غير محدد',
      totalAmount: row.GrandTotal,
      paymentMethod: row.PaymentMethod,
      shiftName: row.ShiftName,
      userName: row.UserName,
      discount: row.discount || 0,
      isSplitPayment: false // Currently not supported
    }));

    // ═══════════════════════════════════════════════════════════
    // RESPONSE
    // ═══════════════════════════════════════════════════════════

    const response: TodaySalesData = {
      date: targetDate || new Date().toISOString().split('T')[0],
      kpi,
      byShift,
      byPaymentMethod,
      byBarber,
      byService,
      byHour,
      transactions
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error('[api/sales/today] ❌ ERROR:', error);
    
    // Enhanced error logging
    if (error && typeof error === 'object') {
      const err = error as any;
      console.error('[api/sales/today] Error details:', {
        message: err.message,
        code: err.code,
        number: err.number,
        state: err.state,
        class: err.class,
        lineNumber: err.lineNumber,
        serverName: err.serverName,
        procName: err.procName
      });
    }
    
    return NextResponse.json(
      { 
        error: 'فشل تحميل بيانات مبيعات اليوم',
        details: error instanceof Error ? error.message : 'Unknown error',
        sqlError: error && typeof error === 'object' ? (error as any).number : null
      },
      { status: 500 }
    );
  }
}
