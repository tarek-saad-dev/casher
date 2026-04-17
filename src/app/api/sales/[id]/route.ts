import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';

// GET /api/sales/[id] — Get sale by invID for printing
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const invID = parseInt(id);
    if (isNaN(invID)) {
      return NextResponse.json({ error: 'Invalid invID' }, { status: 400 });
    }

    const db = await getPool();

    // Fetch header
    const head = await db.request()
      .input('invID', sql.Int, invID)
      .query(`
        SELECT
          h.invID, h.invType, h.invDate, h.invTime,
          h.ClientID, h.SubTotal, h.Dis, h.DisVal,
          h.Tax, h.TaxVal, h.GrandTotal, h.TotalBonus,
          h.PayCash, h.PayVisa, h.PaymentMethodID,
          h.invNotes, h.Notes,
          c.[Name] AS customerName,
          c.Mobile AS customerPhone
        FROM [dbo].[TblinvServHead] h
        LEFT JOIN [dbo].[TblClient] c ON h.ClientID = c.ClientID
        WHERE h.invID = @invID AND h.invType = N'مبيعات'
      `);

    if (head.recordset.length === 0) {
      return NextResponse.json({ error: 'الفاتورة غير موجودة' }, { status: 404 });
    }

    const header = head.recordset[0];

    // Fetch details
    const details = await db.request()
      .input('invID', sql.Int, invID)
      .query(`
        SELECT
          d.ProID, d.EmpID, d.SPrice, d.SValue, d.SPriceAfterDis,
          d.Qty, d.Bonus, d.Notes,
          p.ProName,
          e.EmpName
        FROM [dbo].[TblinvServDetail] d
        LEFT JOIN [dbo].[TblPro] p ON d.ProID = p.ProID
        LEFT JOIN [dbo].[TblEmp] e ON d.EmpID = e.EmpID
        WHERE d.invID = @invID AND d.invType = N'مبيعات'
      `);

    return NextResponse.json({
      ...header,
      items: details.recordset,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/sales/id] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
