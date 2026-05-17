import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import {
  getRateLimitKey,
  checkRateLimit,
  PUBLIC_CORS_HEADERS,
} from '@/lib/publicBookingHelpers';

export const runtime = 'nodejs';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

/**
 * GET /api/public/booking/barbers
 * Returns active bookable barbers — no admin data exposed.
 */
export async function GET(req: NextRequest) {
  const ip = getRateLimitKey(req);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: 'طلبات كثيرة' }, { status: 429, headers: PUBLIC_CORS_HEADERS });
  }

  try {
    const db = await getPool();

    const res = await db.request().query(`
      SELECT
        e.EmpID   AS id,
        e.EmpName AS name,
        e.Job     AS job
      FROM [dbo].[TblEmp] e
      WHERE ISNULL(e.isActive, 1) = 1
        AND e.Job IN (N'حلاق', N'مساعد', N'Barber', N'barber')
      ORDER BY e.EmpName
    `);

    const barbers = res.recordset.map((r: any) => ({
      id:               r.id,
      name:             r.name,
      job:              r.job,
      photoUrl:         null,
      bio:              null,
      isBookableOnline: true,
    }));

    return NextResponse.json({ ok: true, barbers }, { headers: PUBLIC_CORS_HEADERS });
  } catch (err) {
    console.error('[public/booking/barbers]', err);
    return NextResponse.json({ error: 'فشل تحميل الحلاقين' }, { status: 500, headers: PUBLIC_CORS_HEADERS });
  }
}
