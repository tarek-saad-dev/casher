import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// Category name → suggested LineType + Group mapping
const CATEGORY_CLASSIFICATION: Record<string, { lineType: string; group: string }> = {
  'مرتبات اليوم': { lineType: 'payroll', group: 'payroll' },
  'مرتبات الصنايعية': { lineType: 'payroll', group: 'payroll' },
  'مرتبات المساعدين': { lineType: 'payroll', group: 'payroll' },
  'كهرباء': { lineType: 'utility', group: 'operating' },
  'بوفيه': { lineType: 'expense_category', group: 'operating' },
  'اشتراكات شهريه': { lineType: 'subscription', group: 'operating' },
  'تنظيف': { lineType: 'expense_category', group: 'operating' },
  'توصيل': { lineType: 'expense_category', group: 'operating' },
  'بضاعة': { lineType: 'expense_category', group: 'operating' },
  'مصاريف قانونيه': { lineType: 'expense_category', group: 'operating' },
  'نسبة ادارة': { lineType: 'expense_category', group: 'operating' },
  'اقساط': { lineType: 'non_operating', group: 'nonOperating' },
  'تحويلات': { lineType: 'non_operating', group: 'nonOperating' },
  'جمعيات': { lineType: 'non_operating', group: 'nonOperating' },
  'جمعية': { lineType: 'non_operating', group: 'nonOperating' },
  'صافي ربح': { lineType: 'non_operating', group: 'nonOperating' },
  'صافي الربح': { lineType: 'non_operating', group: 'nonOperating' },
  'assets': { lineType: 'non_operating', group: 'nonOperating' },
};

function classifyCategory(catName: string): { lineType: string; group: string } {
  // Exact match
  const exact = CATEGORY_CLASSIFICATION[catName];
  if (exact) return exact;

  // Partial match for advances
  const lower = catName.trim();
  if (lower.includes('سلف') || lower.includes('سلفه') || lower.includes('سلفة')) {
    return { lineType: 'advance', group: 'advances' };
  }
  if (lower.includes('مرتب') || lower.includes('راتب')) {
    return { lineType: 'payroll', group: 'payroll' };
  }
  if (lower.includes('اشتراك')) {
    return { lineType: 'subscription', group: 'operating' };
  }

  return { lineType: 'expense_category', group: 'operating' };
}

// GET /api/budget/historical — Historical baseline averages from last 6 months
export async function GET() {
  try {
    const db = await getPool();

    // 1. Monthly sales averages from TblinvServHead
    const salesResult = await db.request().query(`
      SELECT
        AVG(monthly_total)  AS avgMonthlySales,
        AVG(invoice_count)  AS avgMonthlyInvoices,
        AVG(CASE WHEN invoice_count > 0 THEN monthly_total / invoice_count ELSE 0 END) AS avgInvoiceValue
      FROM (
        SELECT
          YEAR(invDate) * 100 + MONTH(invDate) AS yr_mo,
          SUM(GrandTotal) AS monthly_total,
          COUNT(*) AS invoice_count
        FROM [dbo].[TblinvServHead]
        WHERE invType = N'مبيعات'
          AND invDate >= DATEADD(month, -6, GETDATE())
          AND invDate < CAST(GETDATE() AS DATE)
        GROUP BY YEAR(invDate) * 100 + MONTH(invDate)
      ) sub
    `);

    // 2. Monthly expense averages from TblCashMove
    const expenseResult = await db.request().query(`
      SELECT
        AVG(monthly_total) AS avgMonthlyExpenses
      FROM (
        SELECT
          YEAR(invDate) * 100 + MONTH(invDate) AS yr_mo,
          SUM(GrandTolal) AS monthly_total
        FROM [dbo].[TblCashMove]
        WHERE invType = N'مصروفات' AND inOut = N'out'
          AND invDate >= DATEADD(month, -6, GETDATE())
          AND invDate < CAST(GETDATE() AS DATE)
        GROUP BY YEAR(invDate) * 100 + MONTH(invDate)
      ) sub
    `);

    // 3. Monthly other income averages
    const incomeResult = await db.request().query(`
      SELECT
        AVG(monthly_total) AS avgMonthlyOtherIncome
      FROM (
        SELECT
          YEAR(invDate) * 100 + MONTH(invDate) AS yr_mo,
          SUM(GrandTolal) AS monthly_total
        FROM [dbo].[TblCashMove]
        WHERE invType = N'ايرادات' AND inOut = N'in'
          AND invDate >= DATEADD(month, -6, GETDATE())
          AND invDate < CAST(GETDATE() AS DATE)
        GROUP BY YEAR(invDate) * 100 + MONTH(invDate)
      ) sub
    `);

    // 4. Per-category monthly averages
    const catResult = await db.request().query(`
      SELECT
        sub.ExpINID,
        cat.CatName,
        AVG(sub.monthly_total) AS AvgMonthlyAmount,
        COUNT(*) AS MonthsActive
      FROM (
        SELECT
          ExpINID,
          YEAR(invDate) * 100 + MONTH(invDate) AS yr_mo,
          SUM(GrandTolal) AS monthly_total
        FROM [dbo].[TblCashMove]
        WHERE invType = N'مصروفات' AND inOut = N'out'
          AND invDate >= DATEADD(month, -6, GETDATE())
          AND invDate < CAST(GETDATE() AS DATE)
          AND ExpINID IS NOT NULL
        GROUP BY ExpINID, YEAR(invDate) * 100 + MONTH(invDate)
      ) sub
      JOIN [dbo].[TblExpINCat] cat ON sub.ExpINID = cat.ExpINID
      GROUP BY sub.ExpINID, cat.CatName
      ORDER BY AVG(sub.monthly_total) DESC
    `);

    const avgSales = salesResult.recordset[0]?.avgMonthlySales || 0;
    const avgExpenses = expenseResult.recordset[0]?.avgMonthlyExpenses || 0;
    const avgIncome = incomeResult.recordset[0]?.avgMonthlyOtherIncome || 0;

    const categories = catResult.recordset.map((r: Record<string, unknown>) => {
      const cls = classifyCategory(r.CatName as string);
      return {
        ExpINID: r.ExpINID,
        CatName: r.CatName,
        AvgMonthlyAmount: Math.round((r.AvgMonthlyAmount as number) || 0),
        MonthsActive: r.MonthsActive,
        SuggestedLineType: cls.lineType,
        SuggestedGroup: cls.group,
      };
    });

    return NextResponse.json({
      avgMonthlySales: Math.round(avgSales),
      avgMonthlyExpenses: Math.round(avgExpenses),
      avgMonthlyOtherIncome: Math.round(avgIncome),
      avgMonthlyNet: Math.round(avgSales - avgExpenses + avgIncome),
      avgMonthlyInvoices: Math.round(salesResult.recordset[0]?.avgMonthlyInvoices || 0),
      avgInvoiceValue: Math.round(salesResult.recordset[0]?.avgInvoiceValue || 0),
      avgDailySales: Math.round(avgSales / 30),
      categories,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/budget/historical] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
