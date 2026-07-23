import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { isActiveBranchContext, requireActiveBranchContext } from '@/lib/branch';

// GET /api/sales/recent — returns last 3 sales operations for the active branch
export async function GET() {
  try {
    const branch = await requireActiveBranchContext();
    if (!isActiveBranchContext(branch)) return branch;

    const db = await getPool();
    
    // First, try a simple query to get basic sales data
    const result = await db.request()
      .input('branchId', sql.Int, branch.branchId)
      .query(`
      SELECT TOP 3
        h.invID AS InvID,
        h.invID AS InvNo,
        h.invDate AS InvDate,
        ISNULL(h.GrandTotal, 0) AS TotalPrice,
        ISNULL(h.PayCash, 0) + ISNULL(h.PayVisa, 0) AS PaidAmount,
        CASE 
          WHEN ISNULL(h.GrandTotal, 0) > (ISNULL(h.PayCash, 0) + ISNULL(h.PayVisa, 0)) 
          THEN ISNULL(h.GrandTotal, 0) - (ISNULL(h.PayCash, 0) + ISNULL(h.PayVisa, 0)) 
          ELSE 0 
        END AS RemainingAmount,
        ISNULL(h.DisVal, 0) AS Discount,
        h.PaymentMethodID,
        ISNULL(pm.PaymentMethod, N'نقدي') AS PaymentMethodName,
        h.ClientID,
        ISNULL(c.[Name], N'عميل نقدي') AS ClientName,
        c.Mobile AS Phone,
        COUNT(d.ID) AS ServiceCount
      FROM [dbo].[TblinvServHead] h
      LEFT JOIN [dbo].[TblPaymentMethods] pm 
        ON h.PaymentMethodID = pm.PaymentID
      LEFT JOIN [dbo].[TblClient] c 
        ON h.ClientID = c.ClientID
      LEFT JOIN [dbo].[TblinvServDetail] d 
        ON h.invID = d.invID
       AND h.invType = d.invType
      WHERE h.invType = N'مبيعات'
        AND h.BranchID = @branchId
      GROUP BY 
        h.invID, h.invDate, h.GrandTotal, h.PayCash, h.PayVisa, 
        h.DisVal, h.PaymentMethodID, pm.PaymentMethod, h.ClientID, 
        c.[Name], c.Mobile
      ORDER BY h.invDate DESC, h.invID DESC
    `);

    // Get services for each sale separately to avoid complex aggregation
    const sales = result.recordset;
    
    for (const sale of sales) {
      const servicesResult = await db.request()
        .input('invID', sale.InvID)
        .query(`
          SELECT 
            p.ProName,
            e.EmpName
          FROM [dbo].[TblinvServDetail] d
          LEFT JOIN [dbo].[TblPro] p ON d.ProID = p.ProID
          LEFT JOIN [dbo].[TblEmp] e ON d.EmpID = e.EmpID
          WHERE d.invID = @invID AND d.invType = N'مبيعات'
        `);
      
      const services = servicesResult.recordset;
      sale.ServicesSummary = services.map(s => 
        `${s.ProName || 'خدمة'} (${s.EmpName || 'موظف'})`
      ).join(', ');
      
      sale.EmpID = services[0]?.EmpID || null;
      sale.EmpName = services[0]?.EmpName || null;
    }

    return NextResponse.json(sales);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/sales/recent] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
