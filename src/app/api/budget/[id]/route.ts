import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import type { UpdateBudgetMonthPayload, BudgetLineGroup, BudgetBlocker } from '@/lib/types';

// ── Line group classification ──
function getLineGroup(lineType: string, empID: unknown): BudgetLineGroup {
  if (lineType === 'payroll') return 'payroll';
  if (lineType === 'advance' || (empID != null && lineType !== 'payroll')) return 'advances';
  if (lineType === 'non_operating' || lineType === 'target') return 'nonOperating';
  return 'operating';
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

// GET /api/budget/[id] — Full profit-planning dashboard
export async function GET(
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

    // ═══════ 1. Budget month header ═══════
    const headerResult = await db.request()
      .input('id', sql.Int, budgetMonthID)
      .query(`
        SELECT BudgetMonthID, [Year], [Month],
               TargetRevenue, TargetNetProfit, Status, Notes,
               CreatedByUserID, CreatedAt, UpdatedAt
        FROM [dbo].[TblBudgetMonth]
        WHERE BudgetMonthID = @id
      `);
    if (headerResult.recordset.length === 0) {
      return NextResponse.json({ error: 'الميزانية غير موجودة' }, { status: 404 });
    }
    const h = headerResult.recordset[0];
    const yr = h.Year as number;
    const mo = h.Month as number;
    const targetNetProfit = (h.TargetNetProfit as number) || 0;

    // ═══════ 2. Budget lines + joins ═══════
    const linesResult = await db.request()
      .input('bmId', sql.Int, budgetMonthID)
      .query(`
        SELECT bl.ID, bl.BudgetMonthID, bl.LineType,
               bl.ExpINID, bl.EmpID, bl.LineName, bl.PlannedAmount,
               bl.WarningThresholdPct, bl.HardCapAmount,
               bl.SortOrder, bl.Notes, bl.IsActive,
               cat.CatName, emp.EmpName
        FROM [dbo].[TblBudgetMonthLine] bl
        LEFT JOIN [dbo].[TblExpINCat] cat ON bl.ExpINID = cat.ExpINID
        LEFT JOIN [dbo].[TblEmp] emp ON bl.EmpID = emp.EmpID
        WHERE bl.BudgetMonthID = @bmId
        ORDER BY ISNULL(bl.SortOrder, 9999), bl.LineName
      `);

    // ═══════ 3. Actual expenses by category ═══════
    const expActResult = await db.request()
      .input('yr', sql.Int, yr).input('mo', sql.Int, mo)
      .query(`
        SELECT ExpINID, SUM(GrandTolal) AS Amt
        FROM [dbo].[TblCashMove]
        WHERE invType = N'مصروفات' AND inOut = N'out'
          AND YEAR(invDate) = @yr AND MONTH(invDate) = @mo
        GROUP BY ExpINID
      `);
    const expMap = new Map<number, number>();
    let actualExpenses = 0;
    for (const r of expActResult.recordset) {
      if (r.ExpINID != null) expMap.set(r.ExpINID, r.Amt);
      actualExpenses += r.Amt || 0;
    }

    // ═══════ 4. Actual revenue (sales) ═══════
    const salesResult = await db.request()
      .input('yr', sql.Int, yr).input('mo', sql.Int, mo)
      .query(`
        SELECT ISNULL(SUM(GrandTotal), 0) AS Total,
               COUNT(*) AS Cnt
        FROM [dbo].[TblinvServHead]
        WHERE invType = N'مبيعات'
          AND YEAR(invDate) = @yr AND MONTH(invDate) = @mo
      `);
    const actualRevenue = salesResult.recordset[0]?.Total || 0;
    const invoiceCount = salesResult.recordset[0]?.Cnt || 0;

    // ═══════ 5. Actual other income ═══════
    const incResult = await db.request()
      .input('yr', sql.Int, yr).input('mo', sql.Int, mo)
      .query(`
        SELECT ISNULL(SUM(GrandTolal), 0) AS Total
        FROM [dbo].[TblCashMove]
        WHERE invType = N'ايرادات' AND inOut = N'in'
          AND YEAR(invDate) = @yr AND MONTH(invDate) = @mo
      `);
    const actualOtherIncome = incResult.recordset[0]?.Total || 0;

    // ═══════ 6. Historical averages (last 6 months, for blocker comparison) ═══════
    const histResult = await db.request().query(`
      SELECT
        AVG(s.monthly_sales) AS avgSales,
        AVG(s.inv_count) AS avgInvoices,
        AVG(CASE WHEN s.inv_count > 0 THEN s.monthly_sales / s.inv_count ELSE 0 END) AS avgInvValue
      FROM (
        SELECT YEAR(invDate)*100+MONTH(invDate) AS ym,
               SUM(GrandTotal) AS monthly_sales,
               COUNT(*) AS inv_count
        FROM [dbo].[TblinvServHead]
        WHERE invType = N'مبيعات'
          AND invDate >= DATEADD(month, -6, GETDATE())
          AND invDate < CAST(GETDATE() AS DATE)
        GROUP BY YEAR(invDate)*100+MONTH(invDate)
      ) s
    `);
    const histAvgRevenue = histResult.recordset[0]?.avgSales || 0;
    const histAvgInvoices = histResult.recordset[0]?.avgInvoices || 0;
    const histAvgInvValue = histResult.recordset[0]?.avgInvValue || 0;
    const histAvgDaily = histAvgRevenue / 30;

    // ═══════ 7. Enrich lines + compute groups ═══════
    const groupTotals: Record<BudgetLineGroup, { planned: number; actual: number; variance: number; lineCount: number }> = {
      operating:    { planned: 0, actual: 0, variance: 0, lineCount: 0 },
      payroll:      { planned: 0, actual: 0, variance: 0, lineCount: 0 },
      advances:     { planned: 0, actual: 0, variance: 0, lineCount: 0 },
      nonOperating: { planned: 0, actual: 0, variance: 0, lineCount: 0 },
    };
    let totalPlannedExpenses = 0;
    let overBudgetCount = 0;
    let topOverBudgetLine: string | null = null;
    let topOverAmount = 0;

    const lines = linesResult.recordset.map((line: Record<string, unknown>) => {
      const planned = (line.PlannedAmount as number) || 0;
      const lineType = line.LineType as string;
      const group = getLineGroup(lineType, line.EmpID);
      let actual = 0;
      if (line.ExpINID != null) {
        actual = expMap.get(line.ExpINID as number) || 0;
      }
      const remaining = planned - actual;
      const burnPct = planned > 0 ? Math.round((actual / planned) * 100) : (actual > 0 ? 100 : 0);
      const warnPct = (line.WarningThresholdPct as number) || 80;
      let warningState: 'ok' | 'warning' | 'over' = 'ok';
      if (burnPct >= 100 && actual > 0) {
        warningState = 'over';
        if (line.IsActive) {
          overBudgetCount++;
          const overAmt = actual - planned;
          if (overAmt > topOverAmount) {
            topOverAmount = overAmt;
            topOverBudgetLine = line.LineName as string;
          }
        }
      } else if (burnPct >= warnPct) {
        warningState = 'warning';
      }

      if (line.IsActive) {
        totalPlannedExpenses += planned;
        const g = groupTotals[group];
        g.planned += planned;
        g.actual += actual;
        g.variance += (actual - planned);
        g.lineCount++;
      }

      return {
        ...line,
        ActualAmount: actual,
        Remaining: remaining,
        BurnPct: burnPct,
        WarningState: warningState,
        Group: group,
      };
    });

    // ═══════ 8. KPI calculations ═══════
    const derivedTargetRevenue = targetNetProfit + totalPlannedExpenses;
    const approxCurrentNet = actualRevenue - actualExpenses + actualOtherIncome;
    const remainingToTarget = targetNetProfit - approxCurrentNet;
    const achievementPct = targetNetProfit > 0
      ? Math.round((approxCurrentNet / targetNetProfit) * 100)
      : (approxCurrentNet > 0 ? 100 : 0);

    const dim = daysInMonth(yr, mo);
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === yr && (now.getMonth() + 1) === mo;
    const daysElapsed = isCurrentMonth ? now.getDate() : dim;
    const daysRemaining = isCurrentMonth ? Math.max(dim - now.getDate() + 1, 1) : 0;

    const revenueStillNeeded = Math.max(derivedTargetRevenue - actualRevenue, 0);
    const requiredDailyRevenue = daysRemaining > 0 ? Math.round(revenueStillNeeded / daysRemaining) : 0;
    const requiredDailyNet = daysRemaining > 0 ? Math.round(Math.max(remainingToTarget, 0) / daysRemaining) : 0;
    const currentDailyPace = daysElapsed > 0 ? Math.round(actualRevenue / daysElapsed) : 0;
    const avgInvoiceValue = invoiceCount > 0 ? Math.round(actualRevenue / invoiceCount) : 0;

    // ═══════ 9. Blocker detection ═══════
    const blockers: BudgetBlocker[] = [];

    if (totalPlannedExpenses > 0 && actualExpenses > totalPlannedExpenses) {
      const overPct = Math.round(((actualExpenses - totalPlannedExpenses) / totalPlannedExpenses) * 100);
      blockers.push({
        type: 'expense_over_plan',
        severity: 'high',
        message: `المصروفات تجاوزت الخطة بنسبة ${overPct}%`,
        detail: `فعلي ${actualExpenses.toLocaleString()} مقابل مخطط ${totalPlannedExpenses.toLocaleString()}`,
      });
    }

    if (daysRemaining > 0 && currentDailyPace < requiredDailyRevenue && requiredDailyRevenue > 0) {
      blockers.push({
        type: 'sales_pace_low',
        severity: 'high',
        message: 'وتيرة المبيعات أقل من المطلوب',
        detail: `الحالي ${currentDailyPace.toLocaleString()}/يوم — المطلوب ${requiredDailyRevenue.toLocaleString()}/يوم`,
      });
    }

    if (daysElapsed > 0 && histAvgInvoices > 0) {
      const currentDailyInvoices = invoiceCount / daysElapsed;
      const histDailyInvoices = histAvgInvoices / 30;
      if (currentDailyInvoices < histDailyInvoices * 0.85) {
        blockers.push({
          type: 'invoice_count_low',
          severity: 'medium',
          message: 'عدد الفواتير أقل من المعتاد',
          detail: `الحالي ${Math.round(currentDailyInvoices)}/يوم — المعدل ${Math.round(histDailyInvoices)}/يوم`,
        });
      }
    }

    if (avgInvoiceValue > 0 && histAvgInvValue > 0 && avgInvoiceValue < histAvgInvValue * 0.9) {
      blockers.push({
        type: 'avg_invoice_low',
        severity: 'medium',
        message: 'متوسط الفاتورة أقل من المعتاد',
        detail: `الحالي ${avgInvoiceValue.toLocaleString()} — المعدل ${Math.round(histAvgInvValue).toLocaleString()}`,
      });
    }

    const advancesGroup = groupTotals.advances;
    if (advancesGroup.planned > 0 && advancesGroup.actual > advancesGroup.planned * 1.2) {
      blockers.push({
        type: 'advances_high',
        severity: 'medium',
        message: 'السلف تستهلك سيولة أكبر من المخطط',
        detail: `فعلي ${advancesGroup.actual.toLocaleString()} مقابل مخطط ${advancesGroup.planned.toLocaleString()}`,
      });
    }

    if (overBudgetCount > 0 && topOverBudgetLine) {
      blockers.push({
        type: 'category_over_budget',
        severity: 'low',
        message: `${overBudgetCount} بنود تجاوزت الميزانية`,
        detail: `أكبر تجاوز: ${topOverBudgetLine} (+${topOverAmount.toLocaleString()})`,
      });
    }

    // ═══════ 10. Response ═══════
    return NextResponse.json({
      BudgetMonthID: h.BudgetMonthID,
      Year: yr,
      Month: mo,
      TargetNetProfit: targetNetProfit,
      TargetRevenue: h.TargetRevenue,
      Status: h.Status,
      Notes: h.Notes,
      CreatedAt: h.CreatedAt,
      UpdatedAt: h.UpdatedAt,

      TotalPlannedExpenses: totalPlannedExpenses,
      DerivedTargetRevenue: derivedTargetRevenue,

      ActualRevenue: actualRevenue,
      ActualExpenses: actualExpenses,
      ActualOtherIncome: actualOtherIncome,
      ApproxCurrentNet: approxCurrentNet,
      RemainingToTarget: remainingToTarget,
      AchievementPct: achievementPct,

      DaysInMonth: dim,
      DaysElapsed: daysElapsed,
      DaysRemaining: daysRemaining,
      RequiredDailyRevenue: requiredDailyRevenue,
      RequiredDailyNet: requiredDailyNet,
      CurrentDailyRevenuePace: currentDailyPace,

      InvoiceCount: invoiceCount,
      AverageInvoiceValue: avgInvoiceValue,
      HistAvgMonthlyRevenue: Math.round(histAvgRevenue),
      HistAvgDailyRevenue: Math.round(histAvgDaily),
      HistAvgInvoiceValue: Math.round(histAvgInvValue),
      HistAvgMonthlyInvoices: Math.round(histAvgInvoices),

      lines,
      groupTotals,
      OverBudgetCount: overBudgetCount,
      TopOverBudgetLine: topOverBudgetLine,

      blockers,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/budget/[id]] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PUT /api/budget/[id] — Update budget month header
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const budgetMonthID = parseInt(id);
    if (isNaN(budgetMonthID)) {
      return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
    }

    const body: UpdateBudgetMonthPayload = await req.json();
    const db = await getPool();

    // Derive TargetRevenue from planned expenses + target net profit
    const linesAgg = await db.request()
      .input('bmId', sql.Int, budgetMonthID)
      .query(`
        SELECT ISNULL(SUM(PlannedAmount), 0) AS TotalPlanned
        FROM [dbo].[TblBudgetMonthLine]
        WHERE BudgetMonthID = @bmId AND IsActive = 1
      `);
    const totalPlanned = linesAgg.recordset[0]?.TotalPlanned || 0;
    const targetNP = body.targetNetProfit ?? 0;
    const derivedRevenue = targetNP + totalPlanned;

    await db.request()
      .input('id', sql.Int, budgetMonthID)
      .input('targetRevenue', sql.Decimal(18, 2), derivedRevenue)
      .input('targetNetProfit', sql.Decimal(18, 2), targetNP)
      .input('status', sql.NVarChar(20), body.status || 'draft')
      .input('notes', sql.NVarChar(250), (body.notes || '').substring(0, 250))
      .query(`
        UPDATE [dbo].[TblBudgetMonth]
        SET TargetRevenue = @targetRevenue,
            TargetNetProfit = @targetNetProfit,
            Status = @status,
            Notes = @notes,
            UpdatedAt = GETDATE()
        WHERE BudgetMonthID = @id
      `);

    console.log(`[budget] Updated BudgetMonth: ID=${budgetMonthID}, TargetNP=${targetNP}, DerivedRev=${derivedRevenue}`);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/budget/[id]] PUT error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
