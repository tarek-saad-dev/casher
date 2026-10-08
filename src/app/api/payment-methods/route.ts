import { NextResponse } from 'next/server';
import { getPool, sql } from '@/lib/db';
import { authenticate, isAuthResult } from '@/lib/api-auth';

// GET /api/payment-methods
export async function GET() {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;

  try {
    const db = await getPool();

    // Resolve the clearing method ID from settings (0 if not configured yet)
    let clearingId = 0;
    try {
      const cfgRes = await db.request().query(
        `SELECT CAST(Value AS INT) AS v FROM [dbo].[TblSettingValues] WHERE Name = N'SplitClearingMethodID'`
      );
      if (cfgRes.recordset.length > 0) clearingId = cfgRes.recordset[0].v || 0;
    } catch { /* settings table may not exist yet */ }

    // Exclude the internal clearing account by ID (0 never matches a real ID)
    const result = await db.request()
      .input('clearingId', sql.Int, clearingId)
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .query(`
        SELECT PaymentID, PaymentMethod
        FROM [dbo].[TblPaymentMethods]
        WHERE TenantId = @tenantId AND PaymentID <> @clearingId
        ORDER BY PaymentID
      `);
    const rows = result.recordset.map((r: { PaymentID: number; PaymentMethod: string }) => ({
      ID: r.PaymentID,
      Name: r.PaymentMethod,
    }));
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/payment-methods] GET error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
