import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';

// GET /api/payment-methods
export async function GET() {
  try {
    const db = await getPool();

    // Read from TblPaymentMethods (actual columns: PaymentID, PaymentMethod)
    try {
      const result = await db.request().query(`
        SELECT PaymentID, PaymentMethod FROM [dbo].[TblPaymentMethods] ORDER BY PaymentID
      `);
      const rows = result.recordset.map((r: { PaymentID: number; PaymentMethod: string }) => ({
        ID: r.PaymentID,
        Name: r.PaymentMethod,
      }));
      return NextResponse.json(rows);
    } catch {
      // Table may not exist — return hardcoded defaults
      return NextResponse.json([
        { ID: 1, Name: 'كاش' },
        { ID: 2, Name: 'فيزا' },
      ]);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payment-methods] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
