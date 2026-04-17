import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

interface SaleDetail {
  serviceName: string;
  barberName: string | null;
}

interface RecentSale {
  invID: number;
  invDate: string;
  invTime: string;
  grandTotal: number;
  daysAgo: number;
  services: SaleDetail[];
}

// GET /api/customers/[id]/history-summary — Customer intelligence summary
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const clientID = parseInt(id);
    if (isNaN(clientID)) {
      return NextResponse.json({ error: 'معرف غير صالح' }, { status: 400 });
    }

    const db = await getPool();

    // ═══════ 1. Customer basic info ═══════
    const customerResult = await db.request()
      .input('clientID', sql.Int, clientID)
      .query(`
        SELECT ClientID, Name, Phone, Mobile
        FROM [dbo].[TblClient]
        WHERE ClientID = @clientID
      `);

    if (customerResult.recordset.length === 0) {
      return NextResponse.json({ error: 'العميل غير موجود' }, { status: 404 });
    }

    const customer = customerResult.recordset[0];

    // ═══════ 2. Last 8 sales for analysis (we'll show 3, use 5-8 for frequency) ═══════
    const salesResult = await db.request()
      .input('clientID', sql.Int, clientID)
      .query(`
        SELECT TOP 8
          invID, invDate, invTime, GrandTotal,
          DATEDIFF(day, invDate, GETDATE()) AS DaysAgo
        FROM [dbo].[TblinvServHead]
        WHERE ClientID = @clientID
          AND invType = N'مبيعات'
        ORDER BY invDate DESC, invTime DESC
      `);

    const allSales = salesResult.recordset;
    const totalVisits = allSales.length;

    // ═══════ 3. Get services for last 3 sales ═══════
    const recentSales: RecentSale[] = [];
    for (let i = 0; i < Math.min(3, allSales.length); i++) {
      const sale = allSales[i];
      
      const detailsResult = await db.request()
        .input('invID', sql.Int, sale.invID)
        .query(`
          SELECT 
            p.ProName AS ServiceName,
            e.EmpName AS BarberName
          FROM [dbo].[TblinvServDetail] d
          LEFT JOIN [dbo].[TblPro] p ON d.ProID = p.ProID
          LEFT JOIN [dbo].[TblEmp] e ON d.EmpID = e.EmpID
          WHERE d.invID = @invID AND d.invType = N'مبيعات'
        `);

      const services: SaleDetail[] = detailsResult.recordset.map((r: Record<string, unknown>) => ({
        serviceName: r.ServiceName as string,
        barberName: r.BarberName as string | null,
      }));

      recentSales.push({
        invID: sale.invID,
        invDate: sale.invDate,
        invTime: sale.invTime || '',
        grandTotal: sale.GrandTotal || 0,
        daysAgo: sale.DaysAgo || 0,
        services,
      });
    }

    // ═══════ 4. Calculate visit frequency (use 5-8 visits) ═══════
    let avgVisitGapDays: number | null = null;
    let daysSinceLastVisit: number | null = null;
    let visitPattern: 'regular' | 'overdue' | 'returning' | 'new' | 'insufficient_data' = 'insufficient_data';

    if (totalVisits >= 2) {
      // Sort ascending by date for gap calculation
      const sortedSales = [...allSales].sort((a, b) => {
        const dateA = new Date(a.invDate + ' ' + (a.invTime || '00:00:00'));
        const dateB = new Date(b.invDate + ' ' + (b.invTime || '00:00:00'));
        return dateA.getTime() - dateB.getTime();
      });

      // Calculate gaps between consecutive visits
      const gaps: number[] = [];
      for (let i = 1; i < sortedSales.length; i++) {
        const prevDate = new Date(sortedSales[i - 1].invDate);
        const currDate = new Date(sortedSales[i].invDate);
        const gapDays = Math.round((currDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
        if (gapDays > 0) gaps.push(gapDays);
      }

      if (gaps.length > 0) {
        avgVisitGapDays = Math.round(gaps.reduce((sum, g) => sum + g, 0) / gaps.length);
      }

      // Days since last visit
      daysSinceLastVisit = allSales[0].DaysAgo || 0;

      // Classify pattern
      if (avgVisitGapDays !== null && daysSinceLastVisit !== null) {
        if (totalVisits < 3) {
          visitPattern = 'new';
        } else if (daysSinceLastVisit > avgVisitGapDays * 2) {
          visitPattern = 'returning';
        } else if (daysSinceLastVisit > avgVisitGapDays * 1.5) {
          visitPattern = 'overdue';
        } else {
          visitPattern = 'regular';
        }
      }
    } else if (totalVisits === 1) {
      daysSinceLastVisit = allSales[0].DaysAgo || 0;
      visitPattern = 'new';
    }

    // ═══════ 5. Calculate average spend ═══════
    const avgSpend = totalVisits > 0
      ? Math.round(allSales.reduce((sum, s) => sum + (s.GrandTotal || 0), 0) / totalVisits)
      : 0;

    // ═══════ 6. Most repeated service ═══════
    const servicesResult = await db.request()
      .input('clientID', sql.Int, clientID)
      .query(`
        SELECT TOP 1
          p.ProName,
          COUNT(*) AS ServiceCount
        FROM [dbo].[TblinvServHead] h
        JOIN [dbo].[TblinvServDetail] d ON h.invID = d.invID AND h.invType = d.invType
        JOIN [dbo].[TblPro] p ON d.ProID = p.ProID
        WHERE h.ClientID = @clientID
          AND h.invType = N'مبيعات'
        GROUP BY p.ProName
        ORDER BY COUNT(*) DESC
      `);

    const mostRepeatedService = servicesResult.recordset.length > 0
      ? servicesResult.recordset[0].ProName as string
      : null;
    const mostRepeatedServiceCount = servicesResult.recordset.length > 0
      ? servicesResult.recordset[0].ServiceCount as number
      : 0;

    // ═══════ 7. Generate recommendation ═══════
    let recommendationType: 'maintenance' | 'winback' | 'premium' | 'repeat_service' | 'welcome' = 'welcome';
    let recommendationMessage = '';
    let recommendationPriority: 'high' | 'medium' | 'low' = 'low';

    if (totalVisits < 3) {
      // Rule 5: New customer
      recommendationType = 'welcome';
      recommendationMessage = 'عميل جديد، مناسب عرض ترحيبي أو حافز للزيارة القادمة';
      recommendationPriority = 'medium';
    } else if (avgVisitGapDays !== null && daysSinceLastVisit !== null) {
      // Rule 2: Overdue (highest priority)
      if (daysSinceLastVisit > avgVisitGapDays * 1.5) {
        recommendationType = 'winback';
        recommendationMessage = `العميل متأخر عن متوسط زيارته (${avgVisitGapDays} يوم)، مناسب عرض استرجاع`;
        recommendationPriority = 'high';
      }
      // Rule 1: Regular customer near return
      else if (daysSinceLastVisit >= avgVisitGapDays * 0.8 && daysSinceLastVisit <= avgVisitGapDays * 1.2) {
        recommendationType = 'maintenance';
        recommendationMessage = `العميل غالبًا بيرجع كل ${avgVisitGapDays} يوم، مناسب تعرض عليه باقة مراجعة سريعة`;
        recommendationPriority = 'medium';
      }
      // Rule 3: High-value customer
      else if (avgSpend > 200) {
        recommendationType = 'premium';
        recommendationMessage = `العميل متوسط صرفه مرتفع (${avgSpend} ج.م)، مناسب عرض إضافة خدمة مميزة`;
        recommendationPriority = 'medium';
      }
      // Rule 4: Repeat service pattern
      else if (mostRepeatedService && mostRepeatedServiceCount >= totalVisits * 0.6) {
        recommendationType = 'repeat_service';
        recommendationMessage = `العميل دايمًا بياخد ${mostRepeatedService}، مناسب عرض باقة متخصصة`;
        recommendationPriority = 'low';
      }
      // Default: maintenance
      else {
        recommendationType = 'maintenance';
        recommendationMessage = `عميل منتظم، مناسب عرض خدمة إضافية أو باقة`;
        recommendationPriority = 'low';
      }
    } else {
      // Insufficient data but has visits
      recommendationMessage = 'لا توجد بيانات كافية لحساب نمط الزيارة';
      recommendationPriority = 'low';
    }

    // ═══════ 8. Build response ═══════
    return NextResponse.json({
      customerID: customer.ClientID,
      customerName: customer.Name,
      customerPhone: customer.Mobile || customer.Phone,

      recentSales,

      summary: {
        totalVisits,
        avgVisitGapDays,
        daysSinceLastVisit,
        avgSpend,
        mostRepeatedService,
        mostRepeatedServiceCount,
        visitPattern,
      },

      recommendation: {
        type: recommendationType,
        message: recommendationMessage,
        priority: recommendationPriority,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/customers/[id]/history-summary] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
