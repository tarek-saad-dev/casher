/**
 * TreasurySummaryService - Shared service for financial calculations
 * 
 * This service provides a single source of truth for financial summary calculations
 * used across the application (Treasury Daily, Monthly Reports, etc.)
 * 
 * Data Source: TblCashMove (the authoritative source for all financial movements)
 * 
 * Calculation Logic:
 * - totalIncoming (الوارد): Sum of GrandTolal where inOut = 'in'
 * - totalOutgoing (الصادر): Sum of GrandTolal where inOut = 'out'
 * - netAmount (الصافي): totalIncoming - totalOutgoing
 */

import { getPool } from '@/lib/db';
import sql from 'mssql';

export interface FinancialSummaryParams {
  fromDate: string; // YYYY-MM-DD
  toDate: string;   // YYYY-MM-DD
  shiftMoveId?: number;
  userId?: number;
  newDay?: number;
}

export interface FinancialSummary {
  totalIncoming: number;      // الوارد = كل ما دخل للخزنة
  totalOutgoing: number;      // الصادر = كل ما خرج من الخزنة
  netAmount: number;          // الصافي = الوارد - الصادر
  transactionsCount: number;  // عدد الحركات
  salesIncoming: number;      // الوارد من المبيعات فقط
  incomeIncoming: number;     // الوارد من الإيرادات الأخرى
}

export interface DailyFinancialData {
  day: string; // YYYY-MM-DD
  incoming: number;
  outgoing: number;
  net: number;
}

/**
 * Get financial summary for a date range
 * This is the SINGLE SOURCE OF TRUTH for financial calculations
 */
export async function getFinancialSummary(params: FinancialSummaryParams): Promise<FinancialSummary> {
  const db = await getPool();
  
  const { fromDate, toDate, shiftMoveId, userId, newDay } = params;
  
  // Build WHERE clause dynamically
  let whereConditions: string[] = ['1=1'];
  const queryParams: any = {};
  
  if (newDay !== undefined) {
    whereConditions.push('sm.NewDay = @newDay');
    queryParams.newDay = newDay;
  }
  
  // Date range filter (primary filter)
  whereConditions.push('cm.invDate >= @dateFrom AND cm.invDate <= @dateTo');
  queryParams.dateFrom = fromDate;
  queryParams.dateTo = toDate;
  
  if (shiftMoveId !== undefined) {
    whereConditions.push('sm.ID = @shiftMoveId');
    queryParams.shiftMoveId = shiftMoveId;
  }
  
  if (userId !== undefined) {
    whereConditions.push('sm.UserID = @userId');
    queryParams.userId = userId;
  }
  
  const whereClause = whereConditions.join(' AND ');
  
  // Main summary query - THE SOURCE OF TRUTH
  const summaryQuery = `
    SELECT 
      -- Total Incoming (الوارد الكلي)
      ISNULL(SUM(CASE WHEN cm.inOut = N'in' THEN cm.GrandTolal ELSE 0 END), 0) AS TotalIncoming,
      
      -- Total Outgoing (الصادر الكلي)
      ISNULL(SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END), 0) AS TotalOutgoing,
      
      -- Sales Incoming only (المبيعات)
      ISNULL(SUM(CASE WHEN cm.inOut = N'in' AND cm.invType = N'مبيعات' THEN cm.GrandTolal ELSE 0 END), 0) AS SalesIncoming,
      
      -- Other Income Incoming (الإيرادات الأخرى)
      ISNULL(SUM(CASE WHEN cm.inOut = N'in' AND cm.invType = N'ايرادات' THEN cm.GrandTolal ELSE 0 END), 0) AS IncomeIncoming,
      
      -- Transaction Count
      COUNT(*) AS TransactionsCount
    FROM [dbo].[TblCashMove] cm
    LEFT JOIN [dbo].[TblShiftMove] sm ON cm.ShiftMoveID = sm.ID
    WHERE ${whereClause}
  `;
  
  const request = db.request();
  Object.keys(queryParams).forEach(key => {
    if (key === 'newDay' || key === 'shiftMoveId' || key === 'userId') {
      request.input(key, sql.Int, queryParams[key]);
    } else {
      request.input(key, sql.Date, queryParams[key]);
    }
  });
  
  const result = await request.query(summaryQuery);
  const row = result.recordset[0];
  
  const totalIncoming = row.TotalIncoming || 0;
  const totalOutgoing = row.TotalOutgoing || 0;
  
  return {
    totalIncoming,
    totalOutgoing,
    netAmount: totalIncoming - totalOutgoing,
    transactionsCount: row.TransactionsCount || 0,
    salesIncoming: row.SalesIncoming || 0,
    incomeIncoming: row.IncomeIncoming || 0,
  };
}

/**
 * Get daily financial breakdown for a date range
 * Used for charts and daily analysis
 */
export async function getDailyFinancialData(
  fromDate: string,
  toDate: string
): Promise<DailyFinancialData[]> {
  const db = await getPool();
  
  const query = `
    SELECT 
      CAST(cm.invDate AS DATE) AS Day,
      ISNULL(SUM(CASE WHEN cm.inOut = N'in' THEN cm.GrandTolal ELSE 0 END), 0) AS Incoming,
      ISNULL(SUM(CASE WHEN cm.inOut = N'out' THEN cm.GrandTolal ELSE 0 END), 0) AS Outgoing
    FROM [dbo].[TblCashMove] cm
    WHERE cm.invDate >= @dateFrom AND cm.invDate <= @dateTo
    GROUP BY CAST(cm.invDate AS DATE)
    ORDER BY Day ASC
  `;
  
  const result = await db.request()
    .input('dateFrom', sql.Date, fromDate)
    .input('dateTo', sql.Date, toDate)
    .query(query);
  
  return result.recordset.map((row: any) => ({
    day: new Date(row.Day).toISOString().split('T')[0],
    incoming: row.Incoming || 0,
    outgoing: row.Outgoing || 0,
    net: (row.Incoming || 0) - (row.Outgoing || 0),
  }));
}

/**
 * Get monthly financial summary
 * Convenience method for monthly reports
 */
export async function getMonthlyFinancialSummary(
  year: number,
  month: number
): Promise<FinancialSummary & { dailyData: DailyFinancialData[] }> {
  // Calculate date range for the month
  const daysInMonth = new Date(year, month, 0).getDate();
  const fromDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const toDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  
  // Get summary
  const summary = await getFinancialSummary({ fromDate, toDate });
  
  // Get daily breakdown
  const dailyData = await getDailyFinancialData(fromDate, toDate);
  
  // Fill in missing days with zeros
  const completeDailyData: DailyFinancialData[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const existingData = dailyData.find(d => d.day === dateStr);
    
    if (existingData) {
      completeDailyData.push(existingData);
    } else {
      completeDailyData.push({
        day: dateStr,
        incoming: 0,
        outgoing: 0,
        net: 0,
      });
    }
  }
  
  return {
    ...summary,
    dailyData: completeDailyData,
  };
}
