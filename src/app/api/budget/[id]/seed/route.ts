import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

// POST /api/budget/[id]/seed — Seed budget lines from historical baseline
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const budgetMonthID = parseInt(id);
    if (isNaN(budgetMonthID)) {
      return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
    }

    const db = await getPool();

    // Verify budget month exists
    const bmCheck = await db.request()
      .input('id', sql.Int, budgetMonthID)
      .query(`SELECT BudgetMonthID FROM [dbo].[TblBudgetMonth] WHERE BudgetMonthID = @id`);
    if (bmCheck.recordset.length === 0) {
      return NextResponse.json({ error: 'الميزانية غير موجودة' }, { status: 404 });
    }

    // Fetch historical category averages (last 6 months)
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
      HAVING AVG(sub.monthly_total) >= 100
      ORDER BY AVG(sub.monthly_total) DESC
    `);

    // Category classification (same as historical API)
    function classifyCategory(catName: string): { lineType: string; sortOrder: number } {
      const lower = catName.trim();
      
      // Payroll
      if (lower.includes('مرتب') || lower === 'مرتبات اليوم' || lower === 'مرتبات الصنايعية' || lower === 'مرتبات المساعدين') {
        return { lineType: 'payroll', sortOrder: 1 };
      }
      
      // Advances
      if (lower.includes('سلف') || lower.includes('سلفه') || lower.includes('سلفة')) {
        return { lineType: 'advance', sortOrder: 3 };
      }
      
      // Utilities
      if (lower === 'كهرباء') {
        return { lineType: 'utility', sortOrder: 2 };
      }
      
      // Subscriptions
      if (lower.includes('اشتراك') || lower === 'اشتراكات شهريه') {
        return { lineType: 'subscription', sortOrder: 2 };
      }
      
      // Non-operating
      if (lower === 'اقساط' || lower === 'تحويلات' || lower.includes('جمعي') || 
          lower.includes('صافي') || lower === 'assets') {
        return { lineType: 'non_operating', sortOrder: 4 };
      }
      
      // Default: operating expense
      return { lineType: 'expense_category', sortOrder: 2 };
    }

    // Insert seed lines
    let insertedCount = 0;
    let sortOrder = 1;

    for (const cat of catResult.recordset) {
      const cls = classifyCategory(cat.CatName as string);
      const plannedAmount = Math.round((cat.AvgMonthlyAmount as number) || 0);
      
      if (plannedAmount < 100) continue; // Skip very small amounts

      await db.request()
        .input('bmId', sql.Int, budgetMonthID)
        .input('lineType', sql.NVarChar(50), cls.lineType)
        .input('expINID', sql.Int, cat.ExpINID)
        .input('lineName', sql.NVarChar(100), cat.CatName)
        .input('plannedAmount', sql.Decimal(18, 2), plannedAmount)
        .input('warningThresholdPct', sql.Decimal(5, 2), 80)
        .input('sortOrder', sql.Int, sortOrder)
        .input('isActive', sql.Bit, 1)
        .query(`
          INSERT INTO [dbo].[TblBudgetMonthLine] (
            BudgetMonthID, LineType, ExpINID, EmpID,
            LineName, PlannedAmount, WarningThresholdPct, HardCapAmount,
            SortOrder, Notes, IsActive
          ) VALUES (
            @bmId, @lineType, @expINID, NULL,
            @lineName, @plannedAmount, @warningThresholdPct, NULL,
            @sortOrder, N'مستورد من المعدل التاريخي', @isActive
          )
        `);

      insertedCount++;
      sortOrder++;
    }

    console.log(`[budget/seed] Seeded ${insertedCount} lines for BudgetMonthID=${budgetMonthID}`);
    return NextResponse.json({ insertedCount });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/budget/[id]/seed] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
