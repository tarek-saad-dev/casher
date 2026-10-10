import { NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { requireTenantSession } from '@/lib/api-auth';

// GET /api/shift/definitions — Get all shift definitions from TblShift
export async function GET() {
  const tenantSession = await requireTenantSession();
  if (tenantSession instanceof NextResponse) return tenantSession;
  try {
    const db = await getPool();
    const result = await db.request().query(`
      SELECT ShiftID, ShiftName FROM [dbo].[TblShift] ORDER BY ShiftID
    `);
    return NextResponse.json(result.recordset);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[api/shift/definitions] error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
