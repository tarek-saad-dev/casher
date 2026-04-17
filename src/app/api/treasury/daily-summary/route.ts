import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import sql from 'mssql';
import type { DailyTreasuryData, TreasurySummary, PaymentMethodBreakdown, TreasuryFilters } from '@/lib/types/treasury';

/**
 * GET /api/treasury/daily-summary
 * Get daily treasury summary with payment method breakdown
 * 
 * Query params:
 * - newDay: business day number
 * - dateFrom: start date (YYYY-MM-DD)
 * - dateTo: end date (YYYY-MM-DD)
 * - shiftMoveId: specific shift
 * - userId: filter by user
 */
export async function GET(request: NextRequest) {
  let db;
  
  try {
    db = await getPool();
    
    const searchParams = request.nextUrl.searchParams;
    const newDay = searchParams.get('newDay') ? parseInt(searchParams.get('newDay')!) : null;
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const shiftMoveId = searchParams.get('shiftMoveId') ? parseInt(searchParams.get('shiftMoveId')!) : null;
    const userId = searchParams.get('userId') ? parseInt(searchParams.get('userId')!) : null;
    
    // Build WHERE clause dynamically
    let whereConditions: string[] = ['1=1'];
    const params: any = {};
    
    if (newDay !== null) {
      whereConditions.push('sm.NewDay = @newDay');
      params.newDay = newDay;
    }
    
    if (dateFrom && dateTo) {
      whereConditions.push('cm.invDate >= @dateFrom AND cm.invDate <= @dateTo');
      params.dateFrom = dateFrom;
      params.dateTo = dateTo;
    } else if (dateFrom) {
      whereConditions.push('cm.invDate >= @dateFrom');
      params.dateFrom = dateFrom;
    } else if (dateTo) {
      whereConditions.push('cm.invDate <= @dateTo');
      params.dateTo = dateTo;
    }
    
    if (shiftMoveId !== null) {
      whereConditions.push('sm.ShiftMoveID = @shiftMoveId');
      params.shiftMoveId = shiftMoveId;
    }
    
    if (userId !== null) {
      whereConditions.push('sm.UserID = @userId');
      params.userId = userId;
    }
    
    const whereClause = whereConditions.join(' AND ');
    
    // Get payment method breakdown
    const breakdownQuery = `
      SELECT 
        pm.PaymentID,
        pm.PaymentMethod,
        SUM(CASE WHEN cm.inOut = N'in' THEN cm.GrandTolal ELSE 0 END) AS Inflow,
        SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END) AS Outflow,
        SUM(CASE WHEN cm.inOut = N'in' THEN cm.GrandTolal ELSE 0 END) - 
        SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END) AS Net,
        COUNT(cm.ID) AS TransactionCount,
        SUM(CASE WHEN cm.inOut = N'in' AND cm.invType = N'مبيعات' THEN cm.GrandTolal ELSE 0 END) AS SalesInflow,
        SUM(CASE WHEN cm.inOut = N'in' AND cm.invType = N'ايرادات' THEN cm.GrandTolal ELSE 0 END) AS IncomeInflow
      FROM [dbo].[TblCashMove] cm
      INNER JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
      INNER JOIN [dbo].[TblShiftMove] sm ON cm.ShiftMoveID = sm.ID
      WHERE ${whereClause}
      GROUP BY pm.PaymentID, pm.PaymentMethod
      ORDER BY Net DESC
    `;
    
    const breakdownRequest = db.request();
    Object.keys(params).forEach(key => {
      if (key === 'newDay' || key === 'shiftMoveId' || key === 'userId') {
        breakdownRequest.input(key, sql.Int, params[key]);
      } else {
        breakdownRequest.input(key, sql.Date, params[key]);
      }
    });
    
    const breakdownResult = await breakdownRequest.query(breakdownQuery);
    
    // Calculate totals
    let totalInflow = 0;
    let totalOutflow = 0;
    let grandNet = 0;
    let cashNet = 0;
    let transactionCount = 0;
    let topPaymentMethod: string | null = null;
    let maxNet = -Infinity;
    
    const paymentMethods: PaymentMethodBreakdown[] = breakdownResult.recordset.map((row: any) => {
      const inflow = row.Inflow || 0;
      const outflow = row.Outflow || 0;
      const net = row.Net || 0;
      const count = row.TransactionCount || 0;
      
      totalInflow += inflow;
      totalOutflow += outflow;
      grandNet += net;
      transactionCount += count;
      
      // Track cash net
      if (row.PaymentMethod && row.PaymentMethod.includes('نقد')) {
        cashNet = net;
      }
      
      // Track top payment method
      if (net > maxNet) {
        maxNet = net;
        topPaymentMethod = row.PaymentMethod;
      }
      
      return {
        paymentMethodId: row.PaymentID,
        paymentMethodName: row.PaymentMethod,
        inflow,
        outflow,
        net,
        transactionCount: count,
        percentageOfTotal: 0, // Will calculate after
        salesInflow: row.SalesInflow || 0,
        incomeInflow: row.IncomeInflow || 0
      };
    });
    
    // Calculate percentages
    paymentMethods.forEach(pm => {
      pm.percentageOfTotal = grandNet !== 0 ? (pm.net / grandNet) * 100 : 0;
    });
    
    const summary: TreasurySummary = {
      totalInflow,
      totalOutflow,
      grandNet,
      cashNet,
      transactionCount,
      topPaymentMethod
    };
    
    // Get filter context info
    let filterInfo: TreasuryFilters = {
      newDay,
      dayDate: null,
      dateFrom,
      dateTo,
      shiftMoveId,
      shiftName: null,
      userId,
      userName: null
    };
    
    if (newDay !== null) {
      const dayInfoResult = await db.request()
        .input('newDay', sql.Int, newDay)
        .query(`
          SELECT DayDate FROM [dbo].[TblNewDay] WHERE NewDay = @newDay
        `);
      
      if (dayInfoResult.recordset.length > 0) {
        filterInfo.dayDate = dayInfoResult.recordset[0].DayDate;
      }
    }
    
    if (shiftMoveId !== null) {
      const shiftInfoResult = await db.request()
        .input('shiftMoveId', sql.Int, shiftMoveId)
        .query(`
          SELECT s.ShiftName 
          FROM [dbo].[TblShiftMove] sm
          INNER JOIN [dbo].[TblShift] s ON sm.ShiftID = s.ShiftID
          WHERE sm.ShiftMoveID = @shiftMoveId
        `);
      
      if (shiftInfoResult.recordset.length > 0) {
        filterInfo.shiftName = shiftInfoResult.recordset[0].ShiftName;
      }
    }
    
    if (userId !== null) {
      const userInfoResult = await db.request()
        .input('userId', sql.Int, userId)
        .query(`
          SELECT UserName FROM [dbo].[TblUser] WHERE UserID = @userId
        `);
      
      if (userInfoResult.recordset.length > 0) {
        filterInfo.userName = userInfoResult.recordset[0].UserName;
      }
    }
    
    const response: DailyTreasuryData = {
      summary,
      paymentMethods,
      filters: filterInfo
    };
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('[api/treasury/daily-summary] GET error:', error);
    return NextResponse.json(
      { 
        error: 'فشل تحميل ملخص الخزنة اليومي',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
