import { NextRequest, NextResponse } from 'next/server';
import { authenticate, isAuthResult } from '@/lib/api-auth';
import { getPool, sql } from '@/lib/db';
import {
  isUsableCustomerPhone,
  normalizePublicBookingPhone,
} from '@/lib/publicBookingHelpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Exact, tenant-scoped preview only. The booking transaction is still authoritative. */
export async function GET(req: NextRequest) {
  const auth = await authenticate();
  if (!isAuthResult(auth)) return auth;

  const phone = normalizePublicBookingPhone(req.nextUrl.searchParams.get('phone') ?? '');
  if (!isUsableCustomerPhone(phone)) {
    return NextResponse.json({ status: 'invalid' }, { headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const db = await getPool();
    const found = await db.request()
      .input('tenantId', sql.UniqueIdentifier, auth.tenantId)
      .input('phone', sql.NVarChar(30), phone)
      .query(`
        SELECT TOP (1) ClientID, [Name], Mobile
        FROM dbo.TblClient
        WHERE TenantId = @tenantId AND Mobile = @phone
        ORDER BY ClientID ASC
      `);
    const row = found.recordset[0] as
      | { ClientID: number; Name: string; Mobile: string | null }
      | undefined;

    return NextResponse.json(
      row
        ? { status: 'existing', customer: row }
        : { status: 'new' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('[customers/lookup-phone]', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'تعذر التحقق من رقم العميل' }, { status: 500 });
  }
}
