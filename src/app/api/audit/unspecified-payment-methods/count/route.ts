import { NextRequest, NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { getSession } from '@/lib/session';

// GET /api/audit/unspecified-payment-methods/count
// Lightweight endpoint for sidebar badge - returns just the count
export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ count: 0 }, { status: 200 });
    }
    
    const db = await getPool();
    
    const result = await db.request().query(`
      SELECT COUNT(*) AS count
      FROM dbo.TblCashMove CM
      LEFT JOIN dbo.TblPaymentMethods PM ON CM.PaymentMethodID = PM.PaymentID
      WHERE CM.PaymentMethodID IS NULL 
        OR PM.PaymentMethod IS NULL 
        OR PM.PaymentMethod = '' 
        OR PM.PaymentMethod = N'غير محدد'
    `);
    
    const count = result.recordset[0]?.count || 0;
    
    return NextResponse.json({ count });
    
  } catch (err: unknown) {
    // Return 0 on error to not break the UI
    console.error('[api/audit/unspecified-payment-methods/count] Error:', err);
    return NextResponse.json({ count: 0 });
  }
}
