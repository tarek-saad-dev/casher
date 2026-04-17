import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';
import type { CreateBudgetMonthPayload } from '@/lib/types';

// GET /api/budget — List all budget months with profit-driven aggregates
export async function GET() {
  try {
    const db = await getPool();

    const result = await db.request().query(`
      SELECT
        bm.BudgetMonthID,
        bm.[Year],
        bm.[Month],
        bm.TargetRevenue,
        bm.TargetNetProfit,
        bm.Status,
        bm.Notes,
        bm.CreatedByUserID,
        bm.CreatedAt,
        bm.UpdatedAt,
        ISNULL(agg.TotalPlanned, 0) AS TotalPlanned,
        ISNULL(agg.LineCount, 0)    AS LineCount
      FROM [dbo].[TblBudgetMonth] bm
      LEFT JOIN (
        SELECT
          BudgetMonthID,
          SUM(PlannedAmount) AS TotalPlanned,
          COUNT(*)           AS LineCount
        FROM [dbo].[TblBudgetMonthLine]
        WHERE IsActive = 1
        GROUP BY BudgetMonthID
      ) agg ON bm.BudgetMonthID = agg.BudgetMonthID
      ORDER BY bm.[Year] DESC, bm.[Month] DESC
    `);

    // For each budget month, fetch actuals: expenses, revenue, other income
    const months = result.recordset;
    for (const m of months) {
      const yr = m.Year;
      const mo = m.Month;

      // Actual expenses
      const expResult = await db.request()
        .input('yr', sql.Int, yr).input('mo', sql.Int, mo)
        .query(`
          SELECT ISNULL(SUM(GrandTolal), 0) AS Total
          FROM [dbo].[TblCashMove]
          WHERE invType = N'مصروفات' AND inOut = N'out'
            AND YEAR(invDate) = @yr AND MONTH(invDate) = @mo
        `);
      m.TotalActualExpenses = expResult.recordset[0]?.Total || 0;

      // Actual revenue (sales)
      const salesResult = await db.request()
        .input('yr', sql.Int, yr).input('mo', sql.Int, mo)
        .query(`
          SELECT ISNULL(SUM(GrandTotal), 0) AS Total
          FROM [dbo].[TblinvServHead]
          WHERE invType = N'مبيعات'
            AND YEAR(invDate) = @yr AND MONTH(invDate) = @mo
        `);
      m.ActualRevenue = salesResult.recordset[0]?.Total || 0;

      // Actual other income
      const incResult = await db.request()
        .input('yr', sql.Int, yr).input('mo', sql.Int, mo)
        .query(`
          SELECT ISNULL(SUM(GrandTolal), 0) AS Total
          FROM [dbo].[TblCashMove]
          WHERE invType = N'ايرادات' AND inOut = N'in'
            AND YEAR(invDate) = @yr AND MONTH(invDate) = @mo
        `);
      m.ActualOtherIncome = incResult.recordset[0]?.Total || 0;

      // Derived metrics
      const targetNP = (m.TargetNetProfit as number) || 0;
      const totalPlanned = (m.TotalPlanned as number) || 0;
      m.DerivedTargetRevenue = targetNP + totalPlanned;
      m.ApproxCurrentNet = m.ActualRevenue - m.TotalActualExpenses + m.ActualOtherIncome;
      m.AchievementPct = targetNP > 0 ? Math.round((m.ApproxCurrentNet / targetNP) * 100) : 0;
    }

    return NextResponse.json(months);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/budget] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST /api/budget — Create a new budget month
export async function POST(req: NextRequest) {
  try {
    const body: CreateBudgetMonthPayload = await req.json();

    if (!body.year || !body.month || body.month < 1 || body.month > 12) {
      return NextResponse.json({ error: 'يجب تحديد سنة وشهر صحيحين' }, { status: 400 });
    }

    const sessionUser = await getSession();
    const userID = sessionUser?.UserID ?? null;

    const db = await getPool();

    // Check uniqueness: one budget per year+month
    const existing = await db.request()
      .input('yr', sql.Int, body.year)
      .input('mo', sql.Int, body.month)
      .query(`
        SELECT BudgetMonthID FROM [dbo].[TblBudgetMonth]
        WHERE [Year] = @yr AND [Month] = @mo
      `);

    if (existing.recordset.length > 0) {
      return NextResponse.json({
        error: `يوجد بالفعل ميزانية لشهر ${body.month}/${body.year}`,
        existingId: existing.recordset[0].BudgetMonthID,
      }, { status: 409 });
    }

    // TargetRevenue will be derived later from planned expenses + target net profit
    const insertReq = db.request()
      .input('yr', sql.Int, body.year)
      .input('mo', sql.Int, body.month)
      .input('targetNetProfit', sql.Decimal(18, 2), body.targetNetProfit ?? 0)
      .input('notes', sql.NVarChar(250), (body.notes || '').substring(0, 250))
      .input('userID', sql.Int, userID);

    const insertResult = await insertReq.query(`
      INSERT INTO [dbo].[TblBudgetMonth]
        ([Year], [Month], TargetRevenue, TargetNetProfit, Status, Notes, CreatedByUserID)
      OUTPUT INSERTED.BudgetMonthID
      VALUES (@yr, @mo, 0, @targetNetProfit, N'draft', @notes, @userID)
    `);

    const newID = insertResult.recordset[0].BudgetMonthID;
    console.log(`[budget] Created BudgetMonth: ID=${newID}, ${body.year}-${body.month}`);

    return NextResponse.json({ BudgetMonthID: newID }, { status: 201 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/budget] POST error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
