import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { MonthlyExpensesReport, CategoryBreakdown, DailyTrend } from '@/lib/types';

// GET /api/reports/expenses/monthly — Monthly expenses report with full breakdown
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const yearParam = url.searchParams.get('year');
    const monthParam = url.searchParams.get('month');

    // Default to current month/year if not provided
    const now = new Date();
    const year = yearParam ? parseInt(yearParam) : now.getFullYear();
    const month = monthParam ? parseInt(monthParam) : now.getMonth() + 1;

    // Validate inputs
    if (isNaN(year) || year < 2020 || year > now.getFullYear() + 1) {
      return NextResponse.json({ error: 'سنة غير صالحة' }, { status: 400 });
    }
    if (isNaN(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'شهر غير صالح' }, { status: 400 });
    }

    const db = await getPool();

    // Calculate days in month
    const daysInMonth = new Date(year, month, 0).getDate();

    // ═══════ 1. Summary Calculations ═══════
    const summaryResult = await db.request()
      .input('year', sql.Int, year)
      .input('month', sql.Int, month)
      .query(`
        SELECT 
          ISNULL(SUM(GrandTolal), 0) AS TotalExpenses,
          COUNT(*) AS TransactionCount,
          ISNULL(AVG(GrandTolal), 0) AS AvgTransaction
        FROM [dbo].[TblCashMove]
        WHERE invType = N'مصروفات' 
          AND inOut = N'out'
          AND YEAR(invDate) = @year
          AND MONTH(invDate) = @month
      `);

    const summaryData = summaryResult.recordset[0];
    const totalExpenses = summaryData.TotalExpenses;
    const transactionCount = summaryData.TransactionCount;
    const avgTransaction = summaryData.AvgTransaction;
    const avgDailyExpense = daysInMonth > 0 ? totalExpenses / daysInMonth : 0;

    // ═══════ 1.1. Uncategorized Expenses Count ═══════
    // Flag specific categories that need proper categorization
    const uncategorizedResult = await db.request()
      .input('year', sql.Int, year)
      .input('month', sql.Int, month)
      .query(`
        SELECT 
          COUNT(*) AS UncategorizedCount,
          ISNULL(SUM(GrandTolal), 0) AS UncategorizedAmount
        FROM [dbo].[TblCashMove] cm
        LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
        WHERE cm.invType = N'مصروفات' 
          AND cm.inOut = N'out'
          AND YEAR(cm.invDate) = @year
          AND MONTH(cm.invDate) = @month
          AND (
            cat.CatName = N'تحويلات'
            OR cat.CatName = N'سلف'
            OR cat.CatName = N'مرتبات الصنايعية'
            OR cat.CatName = N'اقساط'
          )
      `);

    const uncategorizedCount = uncategorizedResult.recordset[0].UncategorizedCount;
    const uncategorizedAmount = uncategorizedResult.recordset[0].UncategorizedAmount;

    // ═══════ 2. Top Category ═══════
    const topCategoryResult = await db.request()
      .input('year', sql.Int, year)
      .input('month', sql.Int, month)
      .query(`
        SELECT TOP 1
          cm.ExpINID,
          ISNULL(cat.CatName, N'غير مصنف') AS CatName,
          SUM(cm.GrandTolal) AS Amount,
          COUNT(*) AS Count
        FROM [dbo].[TblCashMove] cm
        LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
        WHERE cm.invType = N'مصروفات' 
          AND cm.inOut = N'out'
          AND YEAR(cm.invDate) = @year
          AND MONTH(cm.invDate) = @month
        GROUP BY cm.ExpINID, cat.CatName
        ORDER BY SUM(cm.GrandTolal) DESC
      `);

    const topCategory = topCategoryResult.recordset.length > 0
      ? {
          ExpINID: topCategoryResult.recordset[0].ExpINID,
          CatName: topCategoryResult.recordset[0].CatName,
          Amount: topCategoryResult.recordset[0].Amount,
          Percentage: totalExpenses > 0 ? (topCategoryResult.recordset[0].Amount / totalExpenses) * 100 : 0,
        }
      : null;

    // ═══════ 3. Highest Spend Day ═══════
    const highestDayResult = await db.request()
      .input('year', sql.Int, year)
      .input('month', sql.Int, month)
      .query(`
        SELECT TOP 1
          invDate,
          SUM(GrandTolal) AS Amount,
          COUNT(*) AS Count
        FROM [dbo].[TblCashMove]
        WHERE invType = N'مصروفات' 
          AND inOut = N'out'
          AND YEAR(invDate) = @year
          AND MONTH(invDate) = @month
        GROUP BY invDate
        ORDER BY SUM(GrandTolal) DESC
      `);

    const highestSpendDay = highestDayResult.recordset.length > 0
      ? {
          invDate: highestDayResult.recordset[0].invDate,
          Amount: highestDayResult.recordset[0].Amount,
          Count: highestDayResult.recordset[0].Count,
        }
      : null;

    // ═══════ 4. Top Payment Method ═══════
    const topPaymentResult = await db.request()
      .input('year', sql.Int, year)
      .input('month', sql.Int, month)
      .query(`
        SELECT TOP 1
          cm.PaymentMethodID,
          ISNULL(pm.PaymentMethod, N'غير محدد') AS PaymentMethod,
          SUM(cm.GrandTolal) AS Amount,
          COUNT(*) AS Count
        FROM [dbo].[TblCashMove] cm
        LEFT JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
        WHERE cm.invType = N'مصروفات' 
          AND cm.inOut = N'out'
          AND YEAR(cm.invDate) = @year
          AND MONTH(cm.invDate) = @month
        GROUP BY cm.PaymentMethodID, pm.PaymentMethod
        ORDER BY SUM(cm.GrandTolal) DESC
      `);

    const topPaymentMethod = topPaymentResult.recordset.length > 0
      ? {
          PaymentMethodID: topPaymentResult.recordset[0].PaymentMethodID,
          PaymentMethod: topPaymentResult.recordset[0].PaymentMethod,
          Amount: topPaymentResult.recordset[0].Amount,
          Percentage: totalExpenses > 0 ? (topPaymentResult.recordset[0].Amount / totalExpenses) * 100 : 0,
        }
      : null;

    // ═══════ 5. Category Breakdown ═══════
    const categoryResult = await db.request()
      .input('year', sql.Int, year)
      .input('month', sql.Int, month)
      .query(`
        SELECT 
          cm.ExpINID,
          ISNULL(cat.CatName, N'غير مصنف') AS CatName,
          SUM(cm.GrandTolal) AS Amount,
          COUNT(*) AS Count,
          AVG(cm.GrandTolal) AS AvgTransaction
        FROM [dbo].[TblCashMove] cm
        LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
        WHERE cm.invType = N'مصروفات' 
          AND cm.inOut = N'out'
          AND YEAR(cm.invDate) = @year
          AND MONTH(cm.invDate) = @month
        GROUP BY cm.ExpINID, cat.CatName
        ORDER BY SUM(cm.GrandTolal) DESC
      `);

    const categoryBreakdown: CategoryBreakdown[] = categoryResult.recordset.map((row) => ({
      ExpINID: row.ExpINID,
      CatName: row.CatName,
      Amount: row.Amount,
      Count: row.Count,
      AvgTransaction: row.AvgTransaction,
      Percentage: totalExpenses > 0 ? (row.Amount / totalExpenses) * 100 : 0,
    }));

    // ═══════ 6. Daily Trend ═══════
    const dailyResult = await db.request()
      .input('year', sql.Int, year)
      .input('month', sql.Int, month)
      .query(`
        SELECT 
          invDate,
          SUM(GrandTolal) AS Amount,
          COUNT(*) AS Count
        FROM [dbo].[TblCashMove]
        WHERE invType = N'مصروفات' 
          AND inOut = N'out'
          AND YEAR(invDate) = @year
          AND MONTH(invDate) = @month
        GROUP BY invDate
        ORDER BY invDate ASC
      `);

    // Fill missing days with 0
    const dailyMap = new Map<string, { Amount: number; Count: number }>();
    dailyResult.recordset.forEach((row) => {
      const dateStr = new Date(row.invDate).toISOString().split('T')[0];
      dailyMap.set(dateStr, { Amount: row.Amount, Count: row.Count });
    });

    const dailyTrend: DailyTrend[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const dateStr = date.toISOString().split('T')[0];
      const dayData = dailyMap.get(dateStr) || { Amount: 0, Count: 0 };
      dailyTrend.push({
        invDate: dateStr,
        Amount: dayData.Amount,
        Count: dayData.Count,
      });
    }

    // ═══════ 7. Detailed Transactions ═══════
    const transactionsResult = await db.request()
      .input('year', sql.Int, year)
      .input('month', sql.Int, month)
      .query(`
        SELECT 
          cm.ID,
          cm.invID,
          cm.invDate,
          cm.invTime,
          cm.ExpINID,
          ISNULL(cat.CatName, N'غير مصنف') AS CatName,
          cm.GrandTolal,
          cm.Notes,
          cm.ShiftMoveID,
          cm.PaymentMethodID,
          ISNULL(pm.PaymentMethod, N'غير محدد') AS PaymentMethod,
          u.UserName
        FROM [dbo].[TblCashMove] cm
        LEFT JOIN [dbo].[TblExpINCat] cat ON cm.ExpINID = cat.ExpINID
        LEFT JOIN [dbo].[TblPaymentMethods] pm ON cm.PaymentMethodID = pm.PaymentID
        LEFT JOIN [dbo].[TblShiftMove] sm ON cm.ShiftMoveID = sm.ID
        LEFT JOIN [dbo].[TblUser] u ON sm.UserID = u.UserID
        WHERE cm.invType = N'مصروفات' 
          AND cm.inOut = N'out'
          AND YEAR(cm.invDate) = @year
          AND MONTH(cm.invDate) = @month
        ORDER BY cm.invDate DESC, cm.invTime DESC
      `);

    // ═══════ 8. Flag Uncategorized Transactions ═══════
    // Helper function to check if expense needs categorization
    // Only flag these specific categories that need proper classification
    const needsCategorization = (catName: string | null) => {
      if (!catName) return false;
      return (
        catName === 'تحويلات' ||
        catName === 'سلف' ||
        catName === 'مرتبات الصنايعية' ||
        catName === 'اقساط'
      );
    };

    // Mark transactions that need categorization
    const transactions = transactionsResult.recordset.map((t: any) => ({
      ...t,
      needsCategorization: needsCategorization(t.CatName),
    }));

    // ═══════ 9. Build Response ═══════
    const report: MonthlyExpensesReport = {
      summary: {
        totalExpenses,
        transactionCount,
        averageTransaction: avgTransaction,
        avgDailyExpense,
        daysInMonth,
        uncategorizedCount,
        uncategorizedAmount,
        topCategory,
        highestSpendDay,
        topPaymentMethod,
      },
      categoryBreakdown,
      dailyTrend,
      transactions,
    };

    return NextResponse.json(report);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/reports/expenses/monthly] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
